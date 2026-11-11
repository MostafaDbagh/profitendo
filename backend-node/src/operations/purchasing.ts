import { createHash, randomUUID } from 'node:crypto';
import type { AuthContext, AuthService, Tx } from '../auth/service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { requireBusiness } from '../businesses/access.js';
import { requireLocation } from '../locations/access.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
import { convertPack } from '../catalogue/packs.js';
import type { DocumentInput, DocumentPatch } from './contracts.js';
import { fixed, scaled } from './decimal.js';
import { postStock } from './inventory.js';
type Doc=Prisma.PurchaseDocumentGetPayload<{include:{lines:true}}>;
const conflict=()=>new ApiError(409,'REVISION_CONFLICT','Reload before saving');
const stateError=()=>new ApiError(409,'DOCUMENT_STATE','This action is not available for the current document status');
const present=(doc:Doc,cost:boolean)=>({
 ...doc,requestHash:undefined,clientKey:undefined,
 documentDate:doc.documentDate.toISOString().slice(0,10),
 ...(cost?{totalValue:fixed(doc.lines.reduce((sum,l)=>sum+scaled(l.baseQuantity.toFixed(4))*scaled(l.unitCost.toFixed(4)),0n),8)}:{}),
 lines:doc.lines.map(({unitCost,...l})=>({...l,factor:l.factor.toFixed(4),quantity:l.quantity.toFixed(4),baseQuantity:l.baseQuantity.toFixed(4),receivedQuantity:l.receivedQuantity.toFixed(4),...(cost?{unitCost:unitCost.toFixed(4),lineTotal:fixed(scaled(l.baseQuantity.toFixed(4))*scaled(unitCost.toFixed(4)),8)}:{})}))
});
async function entitled(tx:Tx,businessId:string){if(!(await billingState(tx,businessId)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','Active subscription required');}
export class PurchasingService{
 constructor(readonly auth:AuthService){}
 async read(ctx:AuthContext,businessId:string,id:string){
  return this.auth.transaction(async tx=>{
   await requireBusiness(this.auth,tx,ctx,businessId,'purchasing.view');
   const doc=await tx.purchaseDocument.findFirst({where:{businessId,id},include:{lines:true}});
   if(!doc)throw new ApiError(404,'NOT_FOUND','Document not found');
   const access=await requireLocation(this.auth,tx,ctx,businessId,doc.locationId,'purchasing.view',false);
   return present(doc,access.permissions['catalogue.cost']);
  });
 }
 async list(ctx:AuthContext,businessId:string,query:{page:number;kind:'ORDER'|'RECEIPT';locationId?:string;supplierId?:string;status?:string}){
  return this.auth.transaction(async tx=>{
   const access=await requireBusiness(this.auth,tx,ctx,businessId,'purchasing.view');
   if(!access.permissions['locations.view'])throw new ApiError(403,'FORBIDDEN','Location access required');
   if(query.locationId)await requireLocation(this.auth,tx,ctx,businessId,query.locationId,'purchasing.view',false);
   const where:Prisma.PurchaseDocumentWhereInput={businessId,kind:query.kind,...(query.locationId?{locationId:query.locationId}:{}),...(query.supplierId?{supplierId:query.supplierId}:{}),...(query.status?{status:query.status}:{}),...(access.permissions['locations.all']?{}:{location:{assignments:{some:{businessId,membershipId:access.membership.id}}}})};
   const rows=await tx.purchaseDocument.findMany({where,skip:(query.page-1)*25,take:25,orderBy:[{createdAt:'desc'},{id:'desc'}]});
   return {page:query.page,pageSize:25,total:await tx.purchaseDocument.count({where}),items:rows.map(({requestHash,clientKey,...row})=>({...row,documentDate:row.documentDate.toISOString().slice(0,10)}))};
  });
 }
 private async lines(tx:Tx,businessId:string,input:DocumentInput['lines'],cost:boolean,existing?:Doc){
  const output=[];
  for(const line of input){
   const product=await tx.product.findFirst({where:{businessId,id:line.productId},include:{barcodes:true}});
   if(!product)throw new ApiError(404,'PRODUCT_NOT_FOUND','Product not found');
   if(!product.active)throw new ApiError(409,'PRODUCT_INACTIVE','Product inactive');
   if(line.unitCost!==undefined&&!cost)throw new ApiError(403,'FORBIDDEN','Cost permission required');
   const pack=line.packId?await tx.productPack.findFirst({where:{id:line.packId,businessId,productId:product.id}}):null;
   if(line.packId&&!pack)throw new ApiError(404,'PACK_NOT_FOUND','Pack not found');
   const factor=pack?.baseQuantity.toFixed(4)??'1.0000';
   const old=existing?.lines.find(l=>l.productId===line.productId);
   output.push({businessId,productId:product.id,sku:product.sku,name:product.name,unit:product.unit,barcodes:product.barcodes.map(b=>b.value),
    packName:pack?.name??null,factor,quantity:line.quantity,baseQuantity:convertPack(line.quantity,factor),
    unitCost:line.unitCost??old?.unitCost.toFixed(4)??product.purchasePrice.toFixed(4)});
  }
  return output;
 }
 private async order(tx:Tx,businessId:string,orderId:string|undefined|null,supplierId:string,locationId:string,lines:{productId:string;baseQuantity:string}[]){
  if(!orderId)return null;
  const order=await tx.purchaseDocument.findFirst({where:{id:orderId,businessId,kind:'ORDER'},include:{lines:true}});
  if(!order)throw new ApiError(404,'NOT_FOUND','Purchase order not found');
  if(order.supplierId!==supplierId||order.locationId!==locationId)throw new ApiError(422,'ORDER_MISMATCH','Supplier and location must match the order');
  if(!['OPEN','PARTIAL'].includes(order.status))throw stateError();
  for(const line of lines){
   const planned=order.lines.find(l=>l.productId===line.productId);
   if(!planned||scaled(line.baseQuantity)>scaled(planned.baseQuantity.toFixed(4))-scaled(planned.receivedQuantity.toFixed(4)))throw new ApiError(409,'ORDER_QUANTITY_EXCEEDED','Receipt exceeds remaining order quantity');
  }
  return order;
 }
 async create(ctx:AuthContext,businessId:string,input:DocumentInput,retry=true):Promise<ReturnType<typeof present>>{
  try{return await this.auth.transaction(async tx=>{
   const access=await requireLocation(this.auth,tx,ctx,businessId,input.locationId,input.kind==='ORDER'?'purchasing.manage':'receiving.create');
   if(!access.permissions['purchasing.view'])throw new ApiError(403,'FORBIDDEN','Purchasing view permission required');
   const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
   const previous=await tx.purchaseDocument.findUnique({where:{businessId_clientKey:{businessId,clientKey:input.clientKey}},include:{lines:true}});
   if(previous){
    // Do not return another location's record through a reused request key.
    await requireLocation(this.auth,tx,ctx,businessId,previous.locationId,'purchasing.view',false);
    if(previous.requestHash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Request key already used');
    return present(previous,access.permissions['catalogue.cost']);
   }
   await entitled(tx,businessId);
   const supplier=await tx.supplier.findFirst({where:{id:input.supplierId,businessId,active:true}});
   if(!supplier)throw new ApiError(409,'SUPPLIER_INACTIVE','Choose an active supplier');
   const lines=await this.lines(tx,businessId,input.lines,access.permissions['catalogue.cost']);
   const order=await this.order(tx,businessId,input.orderId,input.supplierId,input.locationId,lines);
   if(order)for(const line of lines){if(input.lines.find(l=>l.productId===line.productId)?.unitCost===undefined)line.unitCost=order.lines.find(l=>l.productId===line.productId)!.unitCost.toFixed(4);}
   const id=randomUUID(),{lines:ignored,...data}=input;
   const doc=await tx.purchaseDocument.create({data:{...data,id,businessId,requestHash:hash,reference:`${input.kind==='ORDER'?'PO':'RCV'}-${id}`,supplierName:supplier.name,locationName:access.location.name,currency:access.business.baseCurrency,
    documentDate:new Date(input.documentDate),actorId:ctx.user.id,actorName:ctx.user.name}});
   await tx.purchaseLine.createMany({data:lines.map(l=>({...l,documentId:id}))});
   if(!access.business.currencyLockedAt)await tx.business.update({where:{id:businessId},data:{currencyLockedAt:new Date(),revision:{increment:1}}});
   await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:'purchase.created',targetId:id,changes:{kind:doc.kind,reference:doc.reference}}});
   return present(await tx.purchaseDocument.findUniqueOrThrow({where:{id},include:{lines:true}}),access.permissions['catalogue.cost']);
  });}catch(error){
   if(retry&&(error as {code?:string}).code==='P2002')return this.create(ctx,businessId,input,false);
   throw error;
  }
 }
 async update(ctx:AuthContext,businessId:string,id:string,input:DocumentPatch){
  return this.auth.transaction(async tx=>{
   await requireBusiness(this.auth,tx,ctx,businessId,'purchasing.view');
   const doc=await tx.purchaseDocument.findFirst({where:{id,businessId},include:{lines:true}});
   if(!doc)throw new ApiError(404,'NOT_FOUND','Document not found');
   const access=await requireLocation(this.auth,tx,ctx,businessId,doc.locationId,doc.kind==='ORDER'?'purchasing.manage':'receiving.create');
   if(doc.revision!==input.revision)throw conflict();
   if(doc.status!=='DRAFT')throw stateError();
   await entitled(tx,businessId);
   const lines=await this.lines(tx,businessId,input.lines,access.permissions['catalogue.cost'],doc);
   await this.order(tx,businessId,doc.orderId,doc.supplierId,doc.locationId,lines);
   const changed=await tx.purchaseDocument.updateMany({where:{id,businessId,revision:input.revision,status:'DRAFT'},data:{documentDate:new Date(input.documentDate),notes:input.notes,supplierReference:input.supplierReference,revision:{increment:1}}});
   if(!changed.count)throw conflict();
   await tx.purchaseLine.deleteMany({where:{businessId,documentId:id}});
   await tx.purchaseLine.createMany({data:lines.map(l=>({...l,documentId:id}))});
   await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:'purchase.updated',targetId:id,changes:{revision:input.revision+1}}});
   return present(await tx.purchaseDocument.findUniqueOrThrow({where:{id},include:{lines:true}}),access.permissions['catalogue.cost']);
  });
 }
 async transition(ctx:AuthContext,businessId:string,id:string,input:{revision:number;action:'submit'|'reopen'|'confirm'|'cancel'}){
  return this.auth.transaction(async tx=>{
   await requireBusiness(this.auth,tx,ctx,businessId,'purchasing.view');
   await tx.$queryRaw`SELECT id FROM purchase_documents WHERE business_id=${businessId}::uuid AND id=${id}::uuid FOR UPDATE`;
   const doc=await tx.purchaseDocument.findFirst({where:{id,businessId},include:{lines:true}});
   if(!doc)throw new ApiError(404,'NOT_FOUND','Document not found');
   const access=await requireLocation(this.auth,tx,ctx,businessId,doc.locationId,doc.kind==='ORDER'?'purchasing.manage':input.action==='confirm'?'receiving.confirm':'receiving.create',false);
   // Durable confirm replay is authorized but independent of current trial/status revision.
   if(input.action==='confirm'&&doc.kind==='RECEIPT'&&doc.status==='COMPLETED')return present(doc,access.permissions['catalogue.cost']);
   if(doc.revision!==input.revision)throw conflict();
   let status:string;
   if(input.action==='cancel'){
    if(!['DRAFT','PENDING','OPEN','PARTIAL'].includes(doc.status))throw stateError();
    if(doc.kind==='ORDER'&&await tx.purchaseDocument.count({where:{businessId,orderId:id,status:{in:['DRAFT','PENDING']}}}))throw new ApiError(409,'OPEN_RECEIPTS','Cancel outstanding receipts first');
    status='CANCELLED';
   }else if(input.action==='reopen'){
    if(doc.kind!=='RECEIPT'||doc.status!=='PENDING')throw stateError();status='DRAFT';
   }else{
    if(access.location.archivedAt)throw new ApiError(409,'LOCATION_ARCHIVED','Location archived');
    await entitled(tx,businessId);
    if(!(await tx.supplier.findFirst({where:{id:doc.supplierId,businessId,active:true}})))throw new ApiError(409,'SUPPLIER_INACTIVE','Supplier inactive');
    if(await tx.product.count({where:{businessId,id:{in:doc.lines.map(l=>l.productId)},active:true}})!==doc.lines.length)throw new ApiError(409,'PRODUCT_INACTIVE','Product inactive');
    if(input.action==='submit'){if(doc.status!=='DRAFT')throw stateError();status=doc.kind==='ORDER'?'OPEN':'PENDING';}
    else{
     if(doc.kind!=='RECEIPT'||doc.status!=='PENDING')throw stateError();
     const order=await this.order(tx,businessId,doc.orderId,doc.supplierId,doc.locationId,doc.lines.map(l=>({productId:l.productId,baseQuantity:l.baseQuantity.toFixed(4)})));
     // Consistent product ordering reduces lock contention between documents.
     for(const line of [...doc.lines].sort((a,b)=>a.productId.localeCompare(b.productId))){
      await postStock(tx,{businessId,locationId:doc.locationId,productId:line.productId,delta:line.baseQuantity.toFixed(4),type:'PURCHASE_RECEIPT',sourceId:id,sourceLineId:line.id,reference:doc.reference,actorId:ctx.user.id,notes:doc.notes});
      if(order){const planned=order.lines.find(l=>l.productId===line.productId)!;await tx.purchaseLine.update({where:{id:planned.id},data:{receivedQuantity:{increment:line.baseQuantity}}});}
     }
     if(order){
      const remaining=await tx.purchaseLine.findMany({where:{businessId,documentId:order.id}});
      await tx.purchaseDocument.update({where:{id:order.id},data:{status:remaining.every(l=>l.receivedQuantity.equals(l.baseQuantity))?'RECEIVED':'PARTIAL',revision:{increment:1}}});
     }
     status='COMPLETED';
    }
   }
   await tx.purchaseDocument.update({where:{id},data:{status,revision:{increment:1},...(status==='COMPLETED'?{completedAt:new Date(),completedBy:ctx.user.id,completedName:ctx.user.name}:{})}});
   await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:'purchase.status_changed',targetId:id,changes:{from:doc.status,to:status}}});
   return present(await tx.purchaseDocument.findUniqueOrThrow({where:{id},include:{lines:true}}),access.permissions['catalogue.cost']);
  });
 }
}
