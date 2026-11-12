import {randomUUID} from 'node:crypto';
import type {AuthService,AuthContext,Tx} from '../auth/service.js';
import type {Prisma} from '../generated/prisma/client.js';
import {requireLocation} from '../locations/access.js';
import {requireBusiness} from '../businesses/access.js';
import {postStock} from '../operations/inventory.js';
import {scaled,fixed} from '../operations/decimal.js';
import {checked,currencyDigits,lineGross} from '../sales/money.js';
import {fail,hash,entitled,permission,isReturn,locationScope,stockSnapshot} from './shared.js';
import type {AdjustmentInput} from './contracts.js';
type Doc=Prisma.AdjustmentGetPayload<{include:{lines:true}}>;
type Access=Awaited<ReturnType<typeof requireLocation>>;
const present=(d:Doc,a:Access)=>({...d,clientKey:undefined,requestHash:undefined,total:d.kind==='SUPPLIER_RETURN'&&!a.permissions['catalogue.cost']?undefined:d.total,lines:d.lines.map(({unitCost,amount,...l})=>({...l,...(d.kind==='SUPPLIER_RETURN'&&!a.permissions['catalogue.cost']?{}:{amount}),...(a.permissions['catalogue.cost']?{unitCost}:{})})),capabilities:{confirm:d.status==='DRAFT'&&a.permissions[permission(d.kind,'approve')]&&(d.kind!=='SUPPLIER_RETURN'||a.permissions['purchasing.manage']),cancel:d.status==='DRAFT'&&a.permissions[permission(d.kind,'delete')]&&(d.actorId===a.user.id&&a.permissions[permission(d.kind,'create')]||a.permissions[permission(d.kind,'approve')])}});
// Cumulative proportional credit means the final return receives exactly the
// original discounted line amount, without rounding drift over partial returns.
export function credit(total:string,qty:string,returned:bigint,credited:bigint,next:bigint,digits:number){const step=10n**BigInt(4-digits),units=scaled(total)/step,den=scaled(qty);const cumulative=(units*(returned+next)*2n+den)/(2n*den);return checked(cumulative*step-credited);}
export class WorkflowService{
 constructor(readonly auth:AuthService){}
 async snapshot(ctx:AuthContext,bid:string,locationId:string,productId:string){return this.auth.transaction(async tx=>{await requireLocation(this.auth,tx,ctx,bid,locationId,'counts.create');if(!await tx.product.findFirst({where:{businessId:bid,id:productId}}))fail('NOT_FOUND',404);const balance=await tx.stockBalance.findFirst({where:{businessId:bid,locationId,productId}});return {expected:balance?.onHand.toFixed(4)??'0.0000',snapshotToken:await stockSnapshot(tx,bid,locationId,productId)};});}
 async source(tx:Tx,ctx:AuthContext,bid:string,kind:string,id:string){
  if(kind==='CUSTOMER_RETURN'){
   const d=await tx.sale.findFirst({where:{id,businessId:bid,status:'COMPLETED'},include:{lines:true}});if(!d)fail('NOT_FOUND',404);
   await requireLocation(this.auth,tx,ctx,bid,d.locationId,'returns.view',false);
   return {locationId:d.locationId,reference:d.reference,currency:d.currency,digits:d.currencyDigits,lines:d.lines.map(l=>({id:l.id,productId:l.productId,name:l.name,sku:l.sku,unit:l.unit,quantity:l.baseQuantity.toFixed(4),total:l.total.toFixed(4),unitCost:l.unitCost.toFixed(4)}))};
  }
  const d=await tx.purchaseDocument.findFirst({where:{id,businessId:bid,kind:'RECEIPT',status:'COMPLETED'},include:{lines:true}});if(!d)fail('NOT_FOUND',404);
  await requireLocation(this.auth,tx,ctx,bid,d.locationId,'purchasing.view',false);const digits=currencyDigits(d.currency);
  return {locationId:d.locationId,reference:d.reference,currency:d.currency,digits,lines:d.lines.map(l=>({id:l.id,productId:l.productId,name:l.name,sku:l.sku,unit:l.unit,quantity:l.baseQuantity.toFixed(4),total:lineGross(l.baseQuantity.toFixed(4),l.unitCost.toFixed(4),digits),unitCost:l.unitCost.toFixed(4)}))};
 }
 async sourceView(ctx:AuthContext,bid:string,kind:string,id:string){return this.auth.transaction(async tx=>{
  await requireBusiness(this.auth,tx,ctx,bid,'returns.view');const source=await this.source(tx,ctx,bid,kind,id),a=await requireLocation(this.auth,tx,ctx,bid,source.locationId,'returns.view',false);
  const lines=[];for(const l of source.lines){const used=await this.used(tx,bid,l.id);lines.push({id:l.id,productId:l.productId,name:l.name,sku:l.sku,unit:l.unit,quantity:l.quantity,remaining:fixed(scaled(l.quantity)-used.quantity),...(kind==='CUSTOMER_RETURN'||a.permissions['catalogue.cost']?{total:l.total}:{})});}return {...source,lines};
 });}
 private async used(tx:Tx,bid:string,lineId:string){const rows=await tx.adjustmentLine.findMany({where:{businessId:bid,sourceLineId:lineId,document:{status:'COMPLETED',kind:{in:['CUSTOMER_RETURN','SUPPLIER_RETURN']}}}});return {quantity:rows.reduce((s,l)=>s+scaled(l.quantity.toFixed(4)),0n),amount:rows.reduce((s,l)=>s+scaled(l.amount.toFixed(4)),0n)};}
 private async doc(tx:Tx,ctx:AuthContext,bid:string,id:string,lock=false){
  const d=await tx.adjustment.findFirst({where:{businessId:bid,id},include:{lines:true}});if(!d)fail('NOT_FOUND',404);
  const access=await requireLocation(this.auth,tx,ctx,bid,d.locationId,permission(d.kind,'view'),false);
  if(d.kind==='SUPPLIER_RETURN'&&!access.permissions['purchasing.view'])fail('FORBIDDEN',403);
  if(lock)await tx.$queryRaw`SELECT id FROM adjustments WHERE id=${id}::uuid AND business_id=${bid}::uuid FOR UPDATE`;
  return {doc:lock?await tx.adjustment.findUniqueOrThrow({where:{id},include:{lines:true}}):d,access};
 }
 async read(ctx:AuthContext,bid:string,id:string){return this.auth.transaction(async tx=>{const {doc,access}=await this.doc(tx,ctx,bid,id);return present(doc,access);});}
 async list(ctx:AuthContext,bid:string,kind:string,page:number,locationId?:string,status?:string,supplierId?:string){return this.auth.transaction(async tx=>{const {where,access}=await locationScope(this.auth,tx,ctx,bid,permission(kind,'view'));if(kind==='SUPPLIER_RETURN'&&!access.permissions['purchasing.view'])fail('FORBIDDEN',403);if(locationId)await requireLocation(this.auth,tx,ctx,bid,locationId,permission(kind,'view'),false);let sourceIds:string[]|undefined;if(supplierId){if(kind!=='SUPPLIER_RETURN')fail('VALIDATION_ERROR',422);if(!await tx.supplier.findFirst({where:{id:supplierId,businessId:bid}}))fail('NOT_FOUND',404);sourceIds=(await tx.purchaseDocument.findMany({where:{businessId:bid,supplierId,kind:'RECEIPT'},select:{id:true}})).map(r=>r.id);}
 const filter={...where,kind,...(sourceIds?{sourceId:{in:sourceIds}}:{}),...(locationId?{locationId}:{}),...(status?{status}:{})};return {page,pageSize:25,total:await tx.adjustment.count({where:filter}),items:(await tx.adjustment.findMany({where:filter,skip:(page-1)*25,take:25,orderBy:[{createdAt:'desc'},{id:'desc'}]})).map(({clientKey,requestHash,total,...d})=>({...d,...(kind==='SUPPLIER_RETURN'&&!access.permissions['catalogue.cost']?{}:{total})}))};});}
 async create(ctx:AuthContext,bid:string,input:AdjustmentInput,retry=true):Promise<ReturnType<typeof present>>{
  try{return await this.auth.transaction(async tx=>{
   const a=await requireLocation(this.auth,tx,ctx,bid,input.locationId,permission(input.kind,'create'),false);if(!a.permissions[permission(input.kind,'view')])fail('FORBIDDEN',403);
   if(input.kind==='SUPPLIER_RETURN'&&!a.permissions['purchasing.view'])fail('FORBIDDEN',403);
   const prior=await tx.adjustment.findUnique({where:{businessId_clientKey:{businessId:bid,clientKey:input.clientKey}},include:{lines:true}});if(prior){if(prior.requestHash!==hash(input))fail('IDEMPOTENCY_CONFLICT');return present(prior,a);}
   if(a.location.archivedAt)fail('LOCATION_ARCHIVED');await entitled(tx,bid);
   const source=input.sourceId?await this.source(tx,ctx,bid,input.kind,input.sourceId):null;if(source&&source.locationId!==input.locationId)fail('SOURCE_LOCATION_MISMATCH',422);
   const lines=[];let total=0n;const digits=source?.digits??currencyDigits(a.business.baseCurrency);
   for(const entry of input.lines){
    const p=await tx.product.findFirst({where:{businessId:bid,id:entry.productId}});if(!p)fail('PRODUCT_NOT_FOUND',404);
    const origin=source?.lines.find(l=>l.id===entry.sourceLineId&&l.productId===entry.productId);if(source&&!origin)fail('SOURCE_LINE_INVALID',422);
    const balance=await tx.stockBalance.findFirst({where:{businessId:bid,locationId:input.locationId,productId:p.id}}),expected=balance?.onHand.toFixed(4)??'0.0000',snapshotToken=await stockSnapshot(tx,bid,input.locationId,p.id);
    if(input.kind==='COUNT'&&(entry.snapshotToken!==snapshotToken||scaled(entry.expected!)!==scaled(expected)))fail('COUNT_STALE');
    if(input.kind==='OPENING'&&snapshotToken)fail('OPENING_STOCK_EXISTS');
    let amount='0.0000';if(origin){const used=await this.used(tx,bid,origin.id);if(used.quantity+scaled(entry.quantity)>scaled(origin.quantity))fail('RETURN_QUANTITY_EXCEEDED');amount=credit(origin.total,origin.quantity,used.quantity,used.amount,scaled(entry.quantity),digits);}
    const delta=input.kind==='COUNT'?scaled(entry.quantity)-scaled(expected):input.kind==='DAMAGE'||input.kind==='SUPPLIER_RETURN'?-scaled(entry.quantity):entry.condition==='DAMAGED'?0n:scaled(entry.quantity);total+=scaled(amount);
    lines.push({businessId:bid,productId:p.id,sourceLineId:entry.sourceLineId??null,name:origin?.name??p.name,sku:origin?.sku??p.sku,unit:origin?.unit??p.unit,quantity:entry.quantity,condition:entry.condition,expected,snapshotToken,delta:fixed(delta),amount,unitCost:origin?.unitCost??p.purchasePrice.toFixed(4)});
   }
   const id=randomUUID();await tx.adjustment.create({data:{id,businessId:bid,locationId:input.locationId,kind:input.kind,sourceId:input.sourceId??null,sourceReference:source?.reference??'',reference:`${input.kind}-${id.slice(0,8).toUpperCase()}`,locationName:a.location.name,clientKey:input.clientKey,requestHash:hash(input),reason:input.reason,currency:source?.currency??a.business.baseCurrency,currencyDigits:digits,total:checked(total),actorId:ctx.user.id,actorName:ctx.user.name}});
   await tx.adjustmentLine.createMany({data:lines.map(l=>({...l,documentId:id}))});await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'adjustment.created',targetId:id,changes:{kind:input.kind}}});return present(await tx.adjustment.findUniqueOrThrow({where:{id},include:{lines:true}}),a);
  });}catch(e){if(retry&&(e as {code?:string}).code==='P2002')return this.create(ctx,bid,input,false);throw e;}
 }
 async transition(ctx:AuthContext,bid:string,id:string,input:{revision:number;action:'confirm'|'cancel'}){return this.auth.transaction(async tx=>{
  const {doc:d,access:a}=await this.doc(tx,ctx,bid,id,true);
  if(input.action==='cancel'&&!a.permissions[permission(d.kind,'delete')])fail('FORBIDDEN',403);
  if(input.action==='confirm'){await requireLocation(this.auth,tx,ctx,bid,d.locationId,permission(d.kind,'approve'),false);if(d.kind==='SUPPLIER_RETURN'&&!a.permissions['purchasing.manage'])fail('FORBIDDEN',403);}else if(!(d.actorId===a.user.id&&a.permissions[permission(d.kind,'create')]||a.permissions[permission(d.kind,'approve')]))fail('FORBIDDEN',403);
  if(input.action==='confirm'&&d.status==='COMPLETED'||input.action==='cancel'&&d.status==='CANCELLED')return present(d,a);
  if(d.status!=='DRAFT')fail('DOCUMENT_STATE');if(d.revision!==input.revision)fail('REVISION_CONFLICT');
  if(input.action==='confirm'){
   if(a.location.archivedAt)fail('LOCATION_ARCHIVED');await entitled(tx,bid);
   const source=d.sourceId?await this.source(tx,ctx,bid,d.kind,d.sourceId):null;let total=0n;
   for(const l of [...d.lines].sort((a,b)=>a.productId.localeCompare(b.productId)||a.id.localeCompare(b.id))){
    let amount=l.amount.toFixed(4);
    if(source){const origin=source.lines.find(x=>x.id===l.sourceLineId)!;const used=await this.used(tx,bid,origin.id);if(used.quantity+scaled(l.quantity.toFixed(4))>scaled(origin.quantity))fail('RETURN_QUANTITY_EXCEEDED');amount=credit(origin.total,origin.quantity,used.quantity,used.amount,scaled(l.quantity.toFixed(4)),d.currencyDigits);if(scaled(amount)!==scaled(l.amount.toFixed(4)))fail('RETURN_VALUE_CHANGED');}
    if(d.kind==='COUNT'||d.kind==='OPENING'){const latest=await stockSnapshot(tx,bid,d.locationId,l.productId);if(latest!==l.snapshotToken)fail('COUNT_STALE');const b=await tx.stockBalance.findFirst({where:{businessId:bid,locationId:d.locationId,productId:l.productId}});if((b?.onHand.toFixed(4)??'0.0000')!==l.expected.toFixed(4))fail('COUNT_STALE');}
    if(!l.delta.isZero())await postStock(tx,{businessId:bid,locationId:d.locationId,productId:l.productId,delta:l.delta.toFixed(4),type:d.kind,sourceId:id,sourceLineId:l.id,reference:d.reference,actorId:ctx.user.id,notes:d.reason});
    await tx.adjustmentLine.update({where:{id:l.id},data:{amount}});total+=scaled(amount);
   }
   await tx.adjustment.update({where:{id},data:{total:checked(total),status:'COMPLETED',revision:{increment:1},completedBy:ctx.user.id,completedName:ctx.user.name,completedAt:new Date()}});
  }else await tx.adjustment.update({where:{id},data:{status:'CANCELLED',revision:{increment:1}}});
  await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:`adjustment.${input.action}`,targetId:id,changes:{kind:d.kind}}});return present(await tx.adjustment.findUniqueOrThrow({where:{id},include:{lines:true}}),a);
 });}
}
