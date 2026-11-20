import { ownerPinStatus, requireOwnerPin } from '../businesses/access.js';
import {costOf,type CostSlice} from '../operations/fifo.js';
import type {Prisma} from '../generated/prisma/client.js';
import type {AuthService,AuthContext,Tx} from '../auth/service.js';
import {requireLocation} from '../locations/access.js';
import {locationScope,fail} from '../workflows/shared.js';
import {credit} from '../workflows/service.js';
import {fixed,scaled} from '../operations/decimal.js';
import {currencyDigits,lineGross} from '../sales/money.js';
export type ReportQuery={from:string;to:string;locationId?:string;view:'summary'|'stock'|'sales'|'purchases'|'returns'|'payments'|'expenses'|'profit'|'cash'|'balances'|'refunds';page:number;lowStock:boolean;export:boolean};
export function csvCell(v:unknown){let s=v==null?'':String(v);if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export class ReportService{
 constructor(readonly auth:AuthService){}
 async read(ctx:AuthContext,bid:string,q:ReportQuery){return this.auth.transaction(async tx=>{
  const {where,access}=await locationScope(this.auth,tx,ctx,bid,'reports.view');if(q.locationId)await requireLocation(this.auth,tx,ctx,bid,q.locationId,'reports.view',false);
  const scoped={...where,...(q.locationId?{locationId:q.locationId}:{})},cost=access.permissions['catalogue.cost'],purchase=cost&&access.permissions['purchasing.view'],currency=access.business.baseCurrency,digits=currencyDigits(currency);
  if (['profit','payments','expenses','cash','balances','refunds'].includes(q.view)) requireOwnerPin(access);
  const pin = ownerPinStatus(access);
  const financeVisible = !pin.enabled || Boolean(pin.unlockedUntil && pin.unlockedUntil.getTime() > Date.now());
  const calendarDays=(new Date(q.to).getTime()-new Date(q.from).getTime())/86400000+1;
  if(calendarDays<1||calendarDays>366)fail('REPORT_RANGE',422);
  const bounds=await tx.$queryRaw<{start:Date;end:Date}[]>`SELECT (${q.from}::date)::timestamp AT TIME ZONE ${access.business.timezone} AS start,(${q.to}::date+1)::timestamp AT TIME ZONE ${access.business.timezone} AS end`;
  const range={gte:bounds[0]!.start,lt:bounds[0]!.end};
  const base={currency,currencyDigits:digits,from:q.from,to:q.to,timeBasis:access.business.timezone};
  const limit=10000;
  if (q.view === 'profit') {
   if (!cost || !access.permissions['payments.view']) fail('FORBIDDEN',403);
   const totals = await summaryTotals(tx,bid,range,scoped,digits);
   const { sales, customerReturns, netSales, expenses, grossProfit, estimatedProfit, estimatedCost,
     damageCost, transferLossCost, supplierReturnAdjustment, countAdjustmentValue, unvaluedTransferLosses } = totals;
   const metrics = {sales, customerReturns, netSales, expenses, grossProfit, estimatedProfit, estimatedCost,
     damageCost, transferLossCost, supplierReturnAdjustment, countAdjustmentValue};
   if (q.export) {
    const csv = ['"metric","amount","currency"', ...Object.entries(metrics).map(([key,value]) =>
      [key,value,currency].map(csvCell).join(','))].join('\r\n');
    await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'report.exported',changes:{view:q.view,rowCount:Object.keys(metrics).length}}});
    return {...base,filename:`profit-${q.from}-${q.to}.csv`,csv,total:Object.keys(metrics).length};
   }
   return {...base,...metrics,unvaluedTransferLosses};
  }
  if(q.view==='summary'){
   const totals=await summaryTotals(tx,bid,range,{...(q.locationId?{locationId:q.locationId}:{}),...(where.location?{location:where.location}:{})},digits);
   const {expenses,estimatedProfit,grossProfit,netTax,transferLossCost,unvaluedTransferLosses,estimatedCost,damageCost,supplierReturnAdjustment,countAdjustmentValue,...publicTotals}=totals;
   const received=purchase?await tx.purchaseDocument.findMany({where:{...scoped,kind:'RECEIPT',status:'COMPLETED',completedAt:range},include:{lines:true},take:limit+1}):null;
   if(received&&received.length>limit)fail('REPORT_TOO_LARGE',422);
   return {...base,...publicTotals,...(received?{purchases:fixed(received.reduce((sum,r)=>sum+r.lines.reduce((a,l)=>a+scaled(lineGross(l.baseQuantity.toFixed(4),l.unitCost.toFixed(4),digits)),0n),0n))}:{}),...(financeVisible&&access.permissions['payments.view']?{expenses}:{}),...(financeVisible&&cost&&access.permissions['payments.view']?{estimatedProfit,grossProfit,netTax,transferLossCost,unvaluedTransferLosses,estimatedCost,damageCost,supplierReturnAdjustment,countAdjustmentValue}:{})};
  }
  if((q.view==='purchases'||q.view==='balances')&&!purchase)fail('FORBIDDEN',403);if(['payments','expenses','refunds','cash'].includes(q.view)&&!access.permissions['payments.view'])fail('FORBIDDEN',403);
  if(q.view==='cash'&&!access.permissions['cash.close'])fail('FORBIDDEN',403);
  let rows:Record<string,unknown>[]=[];
  let pagedTotal:number|undefined;
  const paging={skip:q.export?0:(q.page-1)*25,take:q.export?limit+1:25};
  if(q.view==='stock'){
   if(!q.export&&!q.lowStock)pagedTotal=await tx.stockBalance.count({where:scoped});
   const data=await tx.stockBalance.findMany({where:scoped,include:{product:{include:{barcodes:{select:{value:true}}}},location:{select:{name:true}}},orderBy:[{locationId:'asc'},{productId:'asc'}],...(q.lowStock?{skip:0,take:limit+1}:paging)});if(data.length>limit)fail('REPORT_TOO_LARGE',422);
   const fifoValues=new Map<string,string>();
   if(cost&&access.business.fifoStartedAt&&data.length){
    const layers=await tx.fifoLayer.findMany({where:{businessId:bid,remaining:{gt:0},OR:data.map(r=>({locationId:r.locationId,productId:r.productId}))},take:100001});if(layers.length>100000)fail('REPORT_TOO_LARGE',422);
    const groups=new Map<string,CostSlice[]>();for(const l of layers){const key=`${l.locationId}:${l.productId}`;const group=groups.get(key)??[];group.push({quantity:l.remaining.toFixed(4),amount:l.remainingCost.toFixed(4),unitCost:l.unitCost.toFixed(4),acquiredAt:l.acquiredAt.toISOString(),originId:l.originId});groups.set(key,group);}
    for(const r of data){const group=groups.get(`${r.locationId}:${r.productId}`)??[];if(group.reduce((n,l)=>n+scaled(l.quantity),0n)!==scaled(r.onHand.toFixed(4)))fail('FIFO_REVIEW_REQUIRED');fifoValues.set(r.id,costOf(group,digits));}
   }
   rows=data.filter(r=>!q.lowStock||r.onHand.minus(r.reserved).lte(r.product.minimumStock)).map(r=>({location:r.location.name,sku:r.product.sku,barcodes:r.product.barcodes.map(b=>b.value).join(' | '),product:r.product.name,unit:r.product.unit,onHand:r.onHand.toFixed(4),reserved:r.reserved.toFixed(4),available:fixed(scaled(r.onHand.toFixed(4))-scaled(r.reserved.toFixed(4))),minimum:r.product.minimumStock.toFixed(4),...(cost?{estimatedValue:fifoValues.get(r.id)??lineGross(r.onHand.toFixed(4),r.product.purchasePrice.toFixed(4),digits)}:{})}));
  }else if(q.view==='sales'){
   const where={...scoped,status:'COMPLETED' as const,completedAt:range};
   if(!q.export)pagedTotal=await tx.sale.count({where});
   rows=(await tx.sale.findMany({where,orderBy:[{completedAt:'desc'},{id:'asc'}],...paging})).map(r=>({reference:r.reference,location:r.locationName,date:r.completedAt?.toISOString(),customer:r.customerName,total:r.total.toFixed(digits),currency:r.currency}));
  }else if(q.view==='returns'){
   const where={...scoped,status:'COMPLETED',completedAt:range,kind:{in:purchase?['CUSTOMER_RETURN','SUPPLIER_RETURN']:['CUSTOMER_RETURN']}};
   if(!q.export)pagedTotal=await tx.adjustment.count({where});
   rows=(await tx.adjustment.findMany({where,orderBy:[{completedAt:'desc'},{id:'asc'}],...paging})).map(r=>({reference:r.reference,location:r.locationName,kind:r.kind,source:r.sourceReference,date:r.completedAt?.toISOString(),credit:r.total.toFixed(digits),currency:r.currency}));
  } else if (q.view === 'cash') {
   const where = {...scoped,day:{gte:q.from,lte:q.to}};
   if (!q.export) pagedTotal = await tx.cashClose.count({where});
   const closes = await tx.cashClose.findMany({where,include:{location:{select:{name:true}}},orderBy:[{day:'desc'},{id:'asc'}],...paging});
   rows = closes.map(r => {
    const precision = currencyDigits(r.currency);
    return {day:r.day,location:r.location.name,opening:r.opening.toFixed(precision),inflow:r.inflow.toFixed(precision),
     outflow:r.outflow.toFixed(precision),expected:r.expected.toFixed(precision),counted:r.counted.toFixed(precision),
     variance:r.variance.toFixed(precision),currency:r.currency,reason:r.reason};
   });
  } else if (q.view === 'payments' || q.view === 'expenses') {
   const where = {...scoped,createdAt:range,...(q.view==='expenses'?{kind:'EXPENSE'}:!purchase?{kind:{notIn:['SUPPLIER_PAYMENT','SUPPLIER_REFUND']}}:{})};
   if (!q.export) pagedTotal = await tx.moneyEntry.count({where});
   const entries = await tx.moneyEntry.findMany({where,include:{location:{select:{name:true}}},orderBy:[{createdAt:'desc'},{id:'asc'}],...paging});
   rows = entries.map(r => ({reference:r.reference,location:r.location.name,kind:r.kind,reversalOfId:r.reversalOfId??'',
    method:r.method,date:r.createdAt.toISOString(),amount:r.amount.toFixed(currencyDigits(r.currency)),currency:r.currency,reason:r.reason}));
  }
  else if(q.view==='refunds'){
   const refundWhere={...scoped,kind:'CUSTOMER_RETURN',status:'COMPLETED'};
   if(!q.export)pagedTotal=await tx.adjustment.count({where:refundWhere});
   const returns=await tx.adjustment.findMany({where:refundWhere,orderBy:[{completedAt:'desc'},{id:'asc'}],...paging});if(returns.length>limit)fail('REPORT_TOO_LARGE',422);
   const paid=await tx.moneyEntry.groupBy({by:['sourceId'],where:{businessId:bid,sourceId:{in:returns.map(r=>r.id)},kind:'CUSTOMER_REFUND'},_sum:{amount:true}});
   const paidBySource=new Map(paid.map(p=>[p.sourceId,p._sum.amount?.toFixed(4)??'0']));
   rows=returns.map(r=>{const refund=scaled(paidBySource.get(r.id)??'0');return {reference:r.reference,source:r.sourceReference,location:r.locationName,credit:r.total.toFixed(digits),paid:fixed(refund),outstanding:fixed(scaled(r.total.toFixed(4))-refund),currency:r.currency};});
  }
  else{
   const receiptWhere={...scoped,kind:'RECEIPT',status:'COMPLETED',...(q.view==='purchases'?{completedAt:range}:{})};
   if(!q.export)pagedTotal=await tx.purchaseDocument.count({where:receiptWhere});
   const receipts=await tx.purchaseDocument.findMany({where:receiptWhere,include:{lines:true},orderBy:[{completedAt:'desc'},{id:'asc'}],...paging});if(receipts.length>limit)fail('REPORT_TOO_LARGE',422);
   const receiptIds=receipts.map(r=>r.id);const credits=q.view==='balances'?await tx.adjustment.groupBy({by:['sourceId'],where:{businessId:bid,sourceId:{in:receiptIds},status:'COMPLETED',kind:'SUPPLIER_RETURN'},_sum:{total:true}}):[],payments=q.view==='balances'?await tx.moneyEntry.groupBy({by:['sourceId','kind'],where:{businessId:bid,sourceId:{in:receiptIds},kind:{in:['SUPPLIER_PAYMENT','SUPPLIER_REFUND']}},_sum:{amount:true}}):[];
   const creditsBySource=new Map(credits.map(c=>[c.sourceId,c._sum.total?.toFixed(4)??'0'])),paymentsBySource=new Map(payments.map(p=>[`${p.sourceId}:${p.kind}`,p._sum.amount?.toFixed(4)??'0']));
   for(const r of receipts){const total=r.lines.reduce((s,l)=>s+scaled(lineGross(l.baseQuantity.toFixed(4),l.unitCost.toFixed(4),digits)),0n);if(q.view==='balances'){const credit=scaled(creditsBySource.get(r.id)??'0'),paid=scaled(paymentsBySource.get(`${r.id}:SUPPLIER_PAYMENT`)??'0'),refunded=scaled(paymentsBySource.get(`${r.id}:SUPPLIER_REFUND`)??'0'),remaining=total-credit-paid+refunded;rows.push({reference:r.reference,supplier:r.supplierName,location:r.locationName,total:fixed(total),credit:fixed(credit),paid:fixed(paid),refundReceived:fixed(refunded),outstanding:fixed(remaining>0n?remaining:0n),refundDue:fixed(remaining<0n?-remaining:0n),currency:r.currency});}else rows.push({reference:r.reference,supplier:r.supplierName,location:r.locationName,date:r.completedAt?.toISOString(),total:fixed(total),currency:r.currency});}
  }
  if(rows.length>limit)fail('REPORT_TOO_LARGE',422);
  if(q.export){const headers=Object.keys(rows[0]??{}),csv=[headers.map(csvCell).join(','),...rows.map(r=>headers.map(h=>csvCell(r[h])).join(','))].join('\r\n');await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'report.exported',changes:{view:q.view,rowCount:rows.length}}});return {...base,filename:`${q.view}-${q.from}-${q.to}.csv`,csv,total:rows.length};}
  return {...base,headers:Object.keys(rows[0]??{}),page:q.page,pageSize:25,total:pagedTotal??rows.length,items:pagedTotal===undefined?rows.slice((q.page-1)*25,q.page*25):rows};
 });}
}

/** Pure tenant-scoped totals shared by interactive reports and durable delivery jobs. */
export async function summaryTotals(tx:Tx,bid:string,range:{gte:Date;lt:Date},scope:{locationId?:string;location?:Prisma.LocationWhereInput},digits:number){
 const scoped={businessId:bid,...scope},limit=10000;
   // A transaction uses one connection; finish each query before starting the next.
   const sales=await tx.sale.findMany({where:{...scoped,status:'COMPLETED',completedAt:range},include:{lines:true},take:limit+1});
   const returns=await tx.adjustment.findMany({where:{...scoped,status:'COMPLETED',completedAt:range,kind:{in:['CUSTOMER_RETURN','SUPPLIER_RETURN','DAMAGE','COUNT']}},include:{lines:true},take:limit+1});
   const entries=await tx.moneyEntry.findMany({where:{...scoped,createdAt:range},take:limit+1});
   const losses=await tx.transferEvent.findMany({where:{businessId:bid,kind:'LOSS',createdAt:range,transfer:{...(scope.locationId?{sourceId:scope.locationId}:{}),...(scope.location?{source:scope.location}:{})}},include:{lines:true},take:limit+1});
   if([sales,returns,entries,losses].some(r=>r.length>limit))fail('REPORT_TOO_LARGE',422);
   const sold=sales.reduce((s,d)=>s+scaled(d.total.toFixed(4)),0n),customerReturns=returns.filter(d=>d.kind==='CUSTOMER_RETURN').reduce((s,d)=>s+scaled(d.total.toFixed(4)),0n),expenses=entries.filter(e=>e.kind==='EXPENSE').reduce((s,e)=>s+scaled(e.amount.toFixed(4)),0n);
   const collectedTax=sales.reduce((s,d)=>s+scaled(d.tax.toFixed(4)),0n),returnedTax=returns.filter(d=>d.kind==='CUSTOMER_RETURN').reduce((s,d)=>s+d.lines.reduce((a,l)=>a+scaled(l.tax.toFixed(4)),0n),0n);
   const saleCost=sales.reduce((s,d)=>s+d.lines.reduce((a,l)=>a+scaled((l.costAmount?.toFixed(4)??lineGross(l.baseQuantity.toFixed(4),l.unitCost.toFixed(4),digits))),0n),0n),recoveredCost=await recoveredReturnCost(tx,bid,returns.filter(d=>d.kind==='CUSTOMER_RETURN').flatMap(d=>d.lines),digits),damageCost=returns.filter(d=>d.kind==='DAMAGE').reduce((s,d)=>s+d.lines.reduce((a,l)=>a+scaled(l.costAmount?.toFixed(4)??lineGross(l.quantity.toFixed(4),l.unitCost.toFixed(4),digits)),0n),0n);
   // FIFO returns credit the source receipt but remove the oldest carrying cost.
   // Historical returns have no stored FIFO cost; preserve their existing treatment.
   const supplierReturnAdjustment=returns.filter(d=>d.kind==='SUPPLIER_RETURN').reduce((sum,d)=>sum+d.lines.reduce((value,l)=>value+(l.costAmount===null?0n:scaled(l.amount.toFixed(4))-scaled(l.costAmount.toFixed(4))),0n),0n);
   const countAdjustmentValue=returns.filter(d=>d.kind==='COUNT').reduce((sum,d)=>sum+d.lines.reduce((value,l)=>{
    const delta=scaled(l.delta.toFixed(4));
    const amount=scaled(l.costAmount?.toFixed(4)??lineGross(fixed(delta<0n?-delta:delta),l.unitCost.toFixed(4),digits));
    return value+(delta<0n?-amount:amount);
   },0n),0n);
   const lossLines=losses.flatMap(event=>event.lines),unvaluedTransferLosses=lossLines.filter(line=>line.unitCost===null&&line.costAmount===null).length;
   const transferLossCost=lossLines.reduce((sum,line)=>sum+(line.costAmount!==null?scaled(line.costAmount.toFixed(4)):line.unitCost===null?0n:scaled(lineGross(line.quantity.toFixed(4),line.unitCost.toFixed(4),digits))),0n);
   const low=await tx.stockBalance.count({where:{...scoped,onHand:{lte:0}}});
 return {saleCount:sales.length,sales:fixed(sold),customerReturns:fixed(customerReturns),netSales:fixed(sold-customerReturns),netTax:fixed(collectedTax-returnedTax),expenses:fixed(expenses),zeroStockProducts:low,grossProfit:fixed(sold-customerReturns-collectedTax+returnedTax-saleCost+recoveredCost),estimatedProfit:unvaluedTransferLosses?null:fixed(sold-customerReturns-collectedTax+returnedTax-saleCost+recoveredCost-damageCost-transferLossCost-expenses+countAdjustmentValue+supplierReturnAdjustment),transferLossCost:fixed(transferLossCost),unvaluedTransferLosses,estimatedCost:fixed(saleCost-recoveredCost),damageCost:fixed(damageCost),supplierReturnAdjustment:fixed(supplierReturnAdjustment),countAdjustmentValue:fixed(countAdjustmentValue)};
}


// Allocate the original rounded sale-line cost cumulatively, just like refund
// credits. Rounding every partial return independently invents or loses cents.
// Include earlier returns and damaged quantities so date-filtered reports remain
// additive and never recover more than the original cost.
async function recoveredReturnCost(tx:Tx,bid:string,current:Prisma.AdjustmentLineGetPayload<{}>[],digits:number){
 const sourceIds=[...new Set(current.flatMap(l=>l.sourceLineId?[l.sourceLineId]:[]))];
 if(!sourceIds.length)return 0n;
 const sources=await tx.saleLine.findMany({where:{businessId:bid,id:{in:sourceIds}}});
 const sourceById=new Map(sources.map(l=>[l.id,l]));
 const history=await tx.adjustmentLine.findMany({where:{businessId:bid,sourceLineId:{in:sourceIds},document:{kind:'CUSTOMER_RETURN',status:'COMPLETED'}},orderBy:[{document:{completedAt:'asc'}},{id:'asc'}],take:10001});
 if(history.length>10000)fail('REPORT_TOO_LARGE',422);
 const selected=new Set(current.filter(l=>l.condition==='RESTOCK').map(l=>l.id));
 const cumulative=new Map<string,{quantity:bigint;cost:bigint}>();let recovered=0n;
 for(const line of history){
  const source=sourceById.get(line.sourceLineId!);if(!source)fail('NOT_FOUND',404);
  const before=cumulative.get(source.id)??{quantity:0n,cost:0n},quantity=scaled(line.quantity.toFixed(4));
  const total=source.costAmount?.toFixed(4)??lineGross(source.baseQuantity.toFixed(4),source.unitCost.toFixed(4),digits);
  const amount=scaled(credit(total,source.baseQuantity.toFixed(4),before.quantity,before.cost,quantity,digits));
  cumulative.set(source.id,{quantity:before.quantity+quantity,cost:before.cost+amount});
  if(selected.has(line.id))recovered+=line.costAmount!==null?scaled(line.costAmount.toFixed(4)):amount;
 }
 return recovered;
}
