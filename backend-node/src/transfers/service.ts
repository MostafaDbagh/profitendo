import { createHash, randomUUID } from 'node:crypto';
import type { AuthContext, AuthService, Tx } from '../auth/service.js';
import { requireLocation } from '../locations/access.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
import { postStock } from '../operations/inventory.js';
import { fixed, scaled } from '../operations/decimal.js';
import type { TransferInput, TransferPatch, TransferEventInput } from './contracts.js';
import { transferAccess, scope, present, remaining } from './access.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict=()=>new ApiError(409,'REVISION_CONFLICT','Reload before saving');
const invalidState=()=>new ApiError(409,'TRANSFER_STATE','This action is not available for this transfer');
async function entitled(tx:Tx,businessId:string){if(!(await billingState(tx,businessId)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','Active subscription required');}
export class TransferService{
 constructor(readonly auth:AuthService){}
 private async document(tx:Tx,ctx:AuthContext,businessId:string,id:string,lock=false){
  const access=await transferAccess(this.auth,tx,ctx,businessId);
  let doc=await tx.stockTransfer.findFirst({where:{id,...scope(businessId,access)},include:{lines:true}});
  if(!doc)throw new ApiError(404,'NOT_FOUND','Transfer not found');
  if(lock){await tx.$queryRaw`SELECT id FROM stock_transfers WHERE business_id=${businessId}::uuid AND id=${id}::uuid FOR UPDATE`;doc=await tx.stockTransfer.findUniqueOrThrow({where:{id},include:{lines:true}});}
  return {doc,access};
 }
 private async lines(tx:Tx,businessId:string,input:TransferInput['lines']){
  const result=[];
  for(const line of input){
   const p=await tx.product.findFirst({where:{businessId,id:line.productId,active:true},include:{barcodes:true}});
   if(!p)throw new ApiError(409,'PRODUCT_INACTIVE','Choose active products from this business');
   result.push({businessId,productId:p.id,name:p.name,sku:p.sku,unit:p.unit,barcodes:p.barcodes.map(b=>b.value),quantity:line.quantity});
  }return result;
 }
 async read(ctx:AuthContext,businessId:string,id:string){
  return this.auth.transaction(async tx=>{const {doc,access}=await this.document(tx,ctx,businessId,id);return present(doc,access);});
 }
 async list(ctx:AuthContext,businessId:string,query:{page:number;status?:string;locationId?:string;search:string}){
  return this.auth.transaction(async tx=>{
   const access=await transferAccess(this.auth,tx,ctx,businessId);
   if(query.locationId)await requireLocation(this.auth,tx,ctx,businessId,query.locationId,'transfers.view',false);
   const where={AND:[scope(businessId,access),...(query.status?[{status:query.status}]:[]),...(query.locationId?[{OR:[{sourceId:query.locationId},{destinationId:query.locationId}]}]:[]),
    ...(query.search?[{reference:{contains:query.search,mode:'insensitive' as const}}]:[])]};
   const items=await tx.stockTransfer.findMany({where,skip:(query.page-1)*25,take:25,orderBy:[{createdAt:'desc'},{id:'desc'}]});
   return {page:query.page,pageSize:25,total:await tx.stockTransfer.count({where}),items:items.map(({clientKey,requestHash,...row})=>row)};
  });
 }
 async events(ctx:AuthContext,businessId:string,id:string,page:number){
  return this.auth.transaction(async tx=>{
   await this.document(tx,ctx,businessId,id);
   const where={businessId,transferId:id};
   const rows=await tx.transferEvent.findMany({where,skip:(page-1)*25,take:25,orderBy:[{createdAt:'desc'},{id:'desc'}],include:{lines:{include:{line:{select:{name:true,sku:true,unit:true}}}}}});
   return {page,pageSize:25,total:await tx.transferEvent.count({where}),items:rows.map(({requestHash,clientKey,...row})=>({...row,lines:row.lines.map(l=>({...l,quantity:l.quantity.toFixed(4)}))}))};
  });
 }
 async create(ctx:AuthContext,businessId:string,input:TransferInput,retry=true):Promise<ReturnType<typeof present>>{
  try{return await this.auth.transaction(async tx=>{
   const access=await transferAccess(this.auth,tx,ctx,businessId);
   const source=await requireLocation(this.auth,tx,ctx,businessId,input.sourceId,'transfers.create',false);
   const destination=await requireLocation(this.auth,tx,ctx,businessId,input.destinationId,'transfers.create',false);
   const requestHash=hash(input),prior=await tx.stockTransfer.findUnique({where:{businessId_clientKey:{businessId,clientKey:input.clientKey}},include:{lines:true}});
   if(prior){if(prior.requestHash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Request key used with different data');return present(prior,access);}
   if(source.location.archivedAt||destination.location.archivedAt)throw new ApiError(409,'LOCATION_ARCHIVED','Choose active locations');
   await entitled(tx,businessId);const lines=await this.lines(tx,businessId,input.lines),id=randomUUID();
   await tx.stockTransfer.create({data:{id,businessId,sourceId:input.sourceId,destinationId:input.destinationId,sourceName:source.location.name,destinationName:destination.location.name,
    clientKey:input.clientKey,requestHash,reference:`TR-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${id.slice(0,8).toUpperCase()}`,notes:input.notes,actorId:ctx.user.id,actorName:ctx.user.name}});
   await tx.transferLine.createMany({data:lines.map(l=>({...l,transferId:id}))});
   await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:'transfer.created',targetId:id,changes:{sourceId:input.sourceId,destinationId:input.destinationId}}});
   return present(await tx.stockTransfer.findUniqueOrThrow({where:{id},include:{lines:true}}),access);
  });}catch(error){if(retry&&(error as {code?:string}).code==='P2002')return this.create(ctx,businessId,input,false);throw error;}
 }
 async update(ctx:AuthContext,businessId:string,id:string,input:TransferPatch){
  return this.auth.transaction(async tx=>{
   const {doc,access}=await this.document(tx,ctx,businessId,id,true);
   await requireLocation(this.auth,tx,ctx,businessId,doc.sourceId,'transfers.create');
   await requireLocation(this.auth,tx,ctx,businessId,doc.destinationId,'transfers.create');
   if(doc.revision!==input.revision)throw conflict();if(doc.status!=='DRAFT')throw invalidState();
   await entitled(tx,businessId);const lines=await this.lines(tx,businessId,input.lines);
   await tx.transferLine.deleteMany({where:{businessId,transferId:id}});
   await tx.transferLine.createMany({data:lines.map(l=>({...l,transferId:id}))});
   await tx.stockTransfer.update({where:{id},data:{notes:input.notes,revision:{increment:1}}});
   await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:'transfer.updated',targetId:id,changes:{revision:doc.revision+1}}});
   return present(await tx.stockTransfer.findUniqueOrThrow({where:{id},include:{lines:true}}),access);
  });
 }
 async transition(ctx:AuthContext,businessId:string,id:string,input:{revision:number;action:'dispatch'|'cancel'}){
  return this.auth.transaction(async tx=>{
   const {doc,access}=await this.document(tx,ctx,businessId,id,true);
   const source=await requireLocation(this.auth,tx,ctx,businessId,doc.sourceId,input.action==='dispatch'?'transfers.dispatch':'transfers.create',false);
   if(input.action==='cancel')await requireLocation(this.auth,tx,ctx,businessId,doc.destinationId,'transfers.create',false);
   if(input.action==='dispatch'&&doc.dispatchedAt||input.action==='cancel'&&doc.status==='CANCELLED')return present(doc,access);
   if(doc.revision!==input.revision)throw conflict();if(doc.status!=='DRAFT')throw invalidState();
   if(input.action==='dispatch'){
    // Only the source balance changes. The coordinator already authorized both
    // locations when creating the route; dispatch does not expose destination stock.
    const destination=await tx.location.findFirstOrThrow({where:{businessId,id:doc.destinationId}});
    if(source.location.archivedAt||destination.archivedAt)throw new ApiError(409,'LOCATION_ARCHIVED','Location archived');
    await entitled(tx,businessId);
    if(await tx.product.count({where:{businessId,id:{in:doc.lines.map(l=>l.productId)},active:true}})!==doc.lines.length)throw new ApiError(409,'PRODUCT_INACTIVE','Product inactive');
    for(const line of [...doc.lines].sort((a,b)=>a.productId.localeCompare(b.productId)))await postStock(tx,{businessId,locationId:doc.sourceId,productId:line.productId,delta:fixed(-scaled(line.quantity.toFixed(4))),type:'TRANSFER_OUT',sourceId:id,sourceLineId:line.id,reference:doc.reference,actorId:ctx.user.id,notes:doc.notes});
   }
   await tx.stockTransfer.update({where:{id},data:{status:input.action==='dispatch'?'IN_TRANSIT':'CANCELLED',revision:{increment:1},...(input.action==='dispatch'?{dispatchedBy:ctx.user.id,dispatchedName:ctx.user.name,dispatchedAt:new Date()}:{})}});
   await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:input.action==='dispatch'?'transfer.dispatched':'transfer.cancelled',targetId:id,changes:{}}});
   return present(await tx.stockTransfer.findUniqueOrThrow({where:{id},include:{lines:true}}),access);
  });
 }
 async record(ctx:AuthContext,businessId:string,id:string,input:TransferEventInput){
  return this.auth.transaction(async tx=>{
   const {doc,access}=await this.document(tx,ctx,businessId,id,true);
   // Staff receive only into their assigned destination. Resolving discrepancies
   // requires a manager authorized for BOTH ends of this transfer.
   if(input.kind==='RECEIVE')await requireLocation(this.auth,tx,ctx,businessId,doc.destinationId,'transfers.receive',false);
   else{await requireLocation(this.auth,tx,ctx,businessId,doc.sourceId,'transfers.resolve',false);await requireLocation(this.auth,tx,ctx,businessId,doc.destinationId,'transfers.resolve',false);}
   const requestHash=hash({id,...input}),prior=await tx.transferEvent.findUnique({where:{businessId_clientKey:{businessId,clientKey:input.clientKey}}});
   if(prior){if(prior.transferId!==id||prior.requestHash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Event key used with different data');return {eventId:prior.id,transfer:present(doc,access)};}
   if(doc.revision!==input.revision)throw conflict();if(!['IN_TRANSIT','PARTIAL'].includes(doc.status))throw invalidState();
   // Finishing an already dispatched transfer remains available after trial
   // expiry and product deactivation, so goods cannot be stranded by either.
   const affected=input.kind==='RECEIVE'?doc.destinationId:doc.sourceId;
   if(input.kind!=='LOSS'&&(await tx.location.findFirstOrThrow({where:{businessId,id:affected}})).archivedAt)throw new ApiError(409,'LOCATION_ARCHIVED','Location archived');
   for(const entry of input.lines){const line=doc.lines.find(l=>l.id===entry.lineId);if(!line||scaled(entry.quantity)>remaining(line))throw new ApiError(409,'TRANSFER_QUANTITY_EXCEEDED','Quantity exceeds what remains in transit');}
   const eventId=randomUUID();
   await tx.transferEvent.create({data:{id:eventId,businessId,transferId:id,clientKey:input.clientKey,requestHash,kind:input.kind,reason:input.reason,actorId:ctx.user.id,actorName:ctx.user.name}});
   for(const entry of [...input.lines].sort((a,b)=>doc.lines.find(l=>l.id===a.lineId)!.productId.localeCompare(doc.lines.find(l=>l.id===b.lineId)!.productId))){
    const line=doc.lines.find(l=>l.id===entry.lineId)!,eventLineId=randomUUID();
    await tx.transferEventLine.create({data:{id:eventLineId,businessId,transferId:id,eventId,transferLineId:line.id,quantity:entry.quantity}});
    if(input.kind!=='LOSS')await postStock(tx,{businessId,locationId:affected,productId:line.productId,delta:entry.quantity,type:input.kind==='RECEIVE'?'TRANSFER_IN':'TRANSFER_RETURN',sourceId:id,sourceLineId:eventLineId,reference:doc.reference,actorId:ctx.user.id,notes:input.reason});
    await tx.transferLine.update({where:{id:line.id},data:{[input.kind==='RECEIVE'?'received':input.kind==='RETURN'?'returned':'lost']:{increment:entry.quantity}}});
   }
   const lines=await tx.transferLine.findMany({where:{businessId,transferId:id}}),completed=lines.every(l=>remaining(l)===0n);
   await tx.stockTransfer.update({where:{id},data:{status:completed?'COMPLETED':'PARTIAL',revision:{increment:1},...(completed?{completedAt:new Date()}:{})}});
   await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:'transfer.event_recorded',targetId:id,changes:{eventId,kind:input.kind}}});
   return {eventId,transfer:present(await tx.stockTransfer.findUniqueOrThrow({where:{id},include:{lines:true}}),access)};
  });
 }
}
