import {queueClosingReports} from '../reports/delivery.js';
import {randomUUID} from 'node:crypto';
import type {AuthService,AuthContext,Tx} from '../auth/service.js';
import {requireLocation} from '../locations/access.js';
import {scaled,fixed} from '../operations/decimal.js';
import {checked,exactMoney,currencyDigits,lineGross} from '../sales/money.js';
import {fail,hash,entitled,locationScope} from '../workflows/shared.js';
import {businessDay,lockCash} from './cash.js';
import type {PaymentInput,CloseInput} from './contracts.js';
export const incoming=(kind:string)=>kind==='SUPPLIER_REFUND'||kind==='CASH_IN';
export async function supplierBalance(tx:Tx,bid:string,id:string){
 const d=await tx.purchaseDocument.findFirst({where:{businessId:bid,id,kind:'RECEIPT',status:'COMPLETED'},include:{lines:true}});if(!d)fail('NOT_FOUND',404);
 const digits=currencyDigits(d.currency),gross=d.lines.reduce((s,l)=>s+scaled(lineGross(l.baseQuantity.toFixed(4),l.unitCost.toFixed(4),digits)),0n);
 const credits=(await tx.adjustment.findMany({where:{businessId:bid,sourceId:id,kind:'SUPPLIER_RETURN',status:'COMPLETED'}})).reduce((s,r)=>s+scaled(r.total.toFixed(4)),0n);
 const entries=await tx.moneyEntry.findMany({where:{businessId:bid,sourceId:id,kind:{in:['SUPPLIER_PAYMENT','SUPPLIER_REFUND']}}}),paid=entries.filter(e=>e.kind==='SUPPLIER_PAYMENT').reduce((s,e)=>s+scaled(e.amount.toFixed(4)),0n),refunded=entries.filter(e=>e.kind==='SUPPLIER_REFUND').reduce((s,e)=>s+scaled(e.amount.toFixed(4)),0n),net=gross-credits,remaining=net-paid+refunded;
 return {doc:d,gross,credits,paid,refunded,outstanding:remaining>0n?remaining:0n,refundDue:remaining<0n?-remaining:0n,net};
}
export async function refundBalance(tx:Tx,bid:string,id:string){const d=await tx.adjustment.findFirst({where:{businessId:bid,id,kind:'CUSTOMER_RETURN',status:'COMPLETED'}});if(!d)fail('NOT_FOUND',404);const paid=(await tx.moneyEntry.findMany({where:{businessId:bid,sourceId:id,kind:'CUSTOMER_REFUND'}})).reduce((s,e)=>s+scaled(e.amount.toFixed(4)),0n);return {doc:d,paid,remaining:scaled(d.total.toFixed(4))-paid};}
export class FinanceService{
 constructor(readonly auth:AuthService){}
 async balance(ctx:AuthContext,bid:string,kind:string,id:string){return this.auth.transaction(async tx=>{
  if(kind==='SUPPLIER'){const b=await supplierBalance(tx,bid,id),a=await requireLocation(this.auth,tx,ctx,bid,b.doc.locationId,'payments.view',false);if(!a.permissions['catalogue.cost']||!a.permissions['purchasing.view'])fail('FORBIDDEN',403);return {id,locationId:b.doc.locationId,reference:b.doc.reference,currency:b.doc.currency,currencyDigits:currencyDigits(b.doc.currency),gross:checked(b.gross),credit:checked(b.credits),paid:checked(b.paid),refunded:checked(b.refunded),outstanding:checked(b.outstanding),refundDue:checked(b.refundDue)};}
  const b=await refundBalance(tx,bid,id);await requireLocation(this.auth,tx,ctx,bid,b.doc.locationId,'payments.view',false);return {id,locationId:b.doc.locationId,reference:b.doc.reference,currency:b.doc.currency,currencyDigits:b.doc.currencyDigits,total:b.doc.total,paid:checked(b.paid),outstanding:checked(b.remaining)};
 });}
 async list(ctx:AuthContext,bid:string,page:number,locationId?:string,kind?:'EXPENSE'){return this.auth.transaction(async tx=>{
  const {where,access}=await locationScope(this.auth,tx,ctx,bid,'payments.view');if(locationId)await requireLocation(this.auth,tx,ctx,bid,locationId,'payments.view',false);
  const filter={...where,...(kind?{kind}:{}),...(locationId?{locationId}:{}),...(!kind&&(!access.permissions['catalogue.cost']||!access.permissions['purchasing.view'])?{kind:{notIn:['SUPPLIER_PAYMENT','SUPPLIER_REFUND']}}:{})};
  return {page,pageSize:25,total:await tx.moneyEntry.count({where:filter}),items:(await tx.moneyEntry.findMany({where:filter,skip:(page-1)*25,take:25,orderBy:[{createdAt:'desc'},{id:'desc'}],include:{location:{select:{name:true}}}})).map(({clientKey,requestHash,...e})=>e)};
 });}
 async create(ctx:AuthContext,bid:string,input:PaymentInput,retry=true):Promise<{id:string}>{try{return await this.auth.transaction(async tx=>{
  const a=await requireLocation(this.auth,tx,ctx,bid,input.locationId,'payments.manage',false);if(!a.permissions['payments.view'])fail('FORBIDDEN',403);
  if(input.kind.startsWith('SUPPLIER')&&(!a.permissions['catalogue.cost']||!a.permissions['purchasing.manage']))fail('FORBIDDEN',403);
  const requestHash=hash(input),prior=await tx.moneyEntry.findUnique({where:{businessId_clientKey:{businessId:bid,clientKey:input.clientKey}}});if(prior){if(prior.requestHash!==requestHash)fail('IDEMPOTENCY_CONFLICT');return {id:prior.id};}
  if(a.location.archivedAt)fail('LOCATION_ARCHIVED');await entitled(tx,bid);const amount=exactMoney(input.amount,currencyDigits(a.business.baseCurrency));
  if(input.kind.startsWith('SUPPLIER')){const b=await supplierBalance(tx,bid,input.sourceId!);if(b.doc.locationId!==input.locationId)fail('SOURCE_LOCATION_MISMATCH',422);if(amount>(input.kind==='SUPPLIER_PAYMENT'?b.outstanding:b.refundDue))fail('PAYMENT_EXCEEDS_BALANCE');}
  if(input.kind==='CUSTOMER_REFUND'){const b=await refundBalance(tx,bid,input.sourceId!);if(b.doc.locationId!==input.locationId)fail('SOURCE_LOCATION_MISMATCH',422);if(amount>b.remaining)fail('PAYMENT_EXCEEDS_BALANCE');}
  const postedAt=input.method==='CASH'?(await lockCash(tx,bid,input.locationId,a.business.timezone)).at:new Date();
  await tx.business.update({where:{id:bid},data:{currencyLockedAt:a.business.currencyLockedAt??new Date()}});
  const entry=await tx.moneyEntry.create({data:{id:randomUUID(),businessId:bid,locationId:input.locationId,kind:input.kind,createdAt:postedAt,sourceId:input.sourceId??null,clientKey:input.clientKey,requestHash,method:input.method,amount:input.amount,currency:a.business.baseCurrency,reference:input.reference,reason:input.reason,actorId:ctx.user.id,actorName:ctx.user.name}});
  await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'payment.recorded',targetId:entry.id,changes:{kind:input.kind}}});return {id:entry.id};
 });}catch(e){if(retry&&(e as {code?:string}).code==='P2002')return this.create(ctx,bid,input,false);throw e;}}
 async cashTotals(tx:Tx,bid:string,locationId:string,day:string){
  // SQL uses the business timezone, including DST, and includes all cash sources.
  const rows=await tx.$queryRaw<{inflow:string;outflow:string}[]>`
   SELECT COALESCE(SUM(inflow),0)::text AS inflow,COALESCE(SUM(outflow),0)::text AS outflow FROM (
    SELECT p.amount AS inflow,0::numeric AS outflow FROM sale_payments p JOIN sales s ON s.id=p.sale_id AND s.business_id=p.business_id JOIN businesses b ON b.id=s.business_id WHERE s.business_id=${bid}::uuid AND s.location_id=${locationId}::uuid AND p.method='CASH' AND to_char(p.created_at AT TIME ZONE b.timezone,'YYYY-MM-DD')=${day}
    UNION ALL SELECT CASE WHEN e.kind IN ('SUPPLIER_REFUND','CASH_IN') THEN e.amount ELSE 0 END,CASE WHEN e.kind IN ('SUPPLIER_REFUND','CASH_IN') THEN 0 ELSE e.amount END FROM money_entries e JOIN businesses b ON b.id=e.business_id WHERE e.business_id=${bid}::uuid AND e.location_id=${locationId}::uuid AND e.method='CASH' AND to_char(e.created_at AT TIME ZONE b.timezone,'YYYY-MM-DD')=${day}
   ) flows`;
  return {inflow:scaled(rows[0]!.inflow),outflow:scaled(rows[0]!.outflow)};
 }
 async cash(ctx:AuthContext,bid:string,locationId:string,day:string){return this.auth.transaction(async tx=>{
  const a=await requireLocation(this.auth,tx,ctx,bid,locationId,'cash.close',false);
  const totals=await this.cashTotals(tx,bid,locationId,day),closed=await tx.cashClose.findUnique({where:{businessId_locationId_day:{businessId:bid,locationId,day}}});return {day,today:businessDay(new Date(),a.business.timezone),currency:a.business.baseCurrency,currencyDigits:currencyDigits(a.business.baseCurrency),inflow:checked(totals.inflow),outflow:checked(totals.outflow),closed};
 });}
 async close(ctx:AuthContext,bid:string,input:CloseInput){return this.auth.transaction(async tx=>{
  const a=await requireLocation(this.auth,tx,ctx,bid,input.locationId,'cash.close',false);
  await tx.$queryRaw`SELECT id FROM businesses WHERE id=${bid}::uuid FOR UPDATE`;
  const prior=await tx.cashClose.findUnique({where:{businessId_locationId_day:{businessId:bid,locationId:input.locationId,day:input.day}}});if(prior){if(prior.opening.equals(input.opening)&&prior.counted.equals(input.counted)&&prior.expected.equals(input.expected)&&prior.reason===input.reason)return prior;fail('CASH_DAY_CLOSED');}
  if(input.day>businessDay(new Date(),a.business.timezone))fail('FUTURE_DAY',422);await entitled(tx,bid);
  const digits=currencyDigits(a.business.baseCurrency),opening=exactMoney(input.opening,digits),counted=exactMoney(input.counted,digits),totals=await this.cashTotals(tx,bid,input.locationId,input.day),expected=opening+totals.inflow-totals.outflow,variance=counted-expected;
  if(scaled(input.expected)!==expected)fail('CASH_TOTAL_CHANGED');if(variance!==0n&&input.reason.length<5)fail('VARIANCE_REASON_REQUIRED',422);if(expected>999999999999999999n||expected< -999999999999999999n||variance>999999999999999999n||variance< -999999999999999999n)fail('MONEY_OVERFLOW',422);
  await tx.business.update({where:{id:bid},data:{currencyLockedAt:a.business.currencyLockedAt??new Date()}});
  const entry=await tx.cashClose.create({data:{businessId:bid,locationId:input.locationId,day:input.day,opening:input.opening,counted:input.counted,inflow:checked(totals.inflow),outflow:checked(totals.outflow),expected:fixed(expected),variance:fixed(variance),reason:input.reason,currency:a.business.baseCurrency,actorId:ctx.user.id,actorName:ctx.user.name}});await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'cash.closed',targetId:entry.id,changes:{day:input.day}}});await queueClosingReports(tx,entry);return entry;
 });}
}
