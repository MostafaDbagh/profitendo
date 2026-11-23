import { createHash, randomUUID } from 'node:crypto';
import type { AuthContext, AuthService, Tx } from '../auth/service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { requireBusiness } from '../businesses/access.js';
import { requireLocation } from '../locations/access.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
import { convertPack } from '../catalogue/packs.js';
import type { DocumentInput, DocumentPatch, InventoryDocumentInput } from './contracts.js';
import { fixed, scaled } from './decimal.js';
import { postStock } from './inventory.js';
const details={lines:true,plannedItems:{orderBy:{position:'asc' as const}}} as const;
type Doc=Prisma.PurchaseDocumentGetPayload<{include:typeof details}>;
type PlanInput=Extract<DocumentInput,{plannedItems:unknown}>;
type PlanPatch=Extract<DocumentPatch,{plannedItems:unknown}>;
type BusinessAccess=Awaited<ReturnType<typeof requireBusiness>>;
const conflict=()=>new ApiError(409,'REVISION_CONFLICT','Reload before saving');
const stateError=()=>new ApiError(409,'DOCUMENT_STATE','This action is not available for the current document status');
const present=(doc:Doc,cost:boolean)=>({
 ...doc,requestHash:undefined,clientKey:undefined,
 documentDate:doc.documentDate.toISOString().slice(0,10),
 ...(cost&&doc.locationId?{totalValue:fixed(doc.lines.reduce((sum,l)=>sum+scaled(l.baseQuantity.toFixed(4))*scaled(l.unitCost.toFixed(4)),0n),8)}:{}),
 plannedItems:doc.plannedItems.map(item=>({...item,quantity:item.quantity.toFixed(4),receivedQuantity:item.receivedQuantity.toFixed(4)})),
 lines:doc.lines.map(({unitCost,...l})=>({...l,factor:l.factor.toFixed(4),quantity:l.quantity.toFixed(4),baseQuantity:l.baseQuantity.toFixed(4),receivedQuantity:l.receivedQuantity.toFixed(4),...(cost?{unitCost:unitCost.toFixed(4),lineTotal:fixed(scaled(l.baseQuantity.toFixed(4))*scaled(unitCost.toFixed(4)),8)}:{})}))
});
async function entitled(tx:Tx,businessId:string){if(!(await billingState(tx,businessId)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','Active subscription required');}
function checkPlanAccess(access:BusinessAccess,doc:{actorId:string}){
 if(!access.permissions['locations.all']&&access.user.id!==doc.actorId)throw new ApiError(404,'NOT_FOUND','Purchase order not found');
}
export class PurchasingService{
 constructor(readonly auth:AuthService){}
 async read(ctx:AuthContext,businessId:string,id:string){
  return this.auth.transaction(async tx=>{
   const businessAccess=await requireBusiness(this.auth,tx,ctx,businessId,'purchasing.view');
   const doc=await tx.purchaseDocument.findFirst({where:{businessId,id},include:details});
   if(!doc)throw new ApiError(404,'NOT_FOUND','Document not found');
   if(!doc.locationId)checkPlanAccess(businessAccess,doc);
   const access=doc.locationId?await requireLocation(this.auth,tx,ctx,businessId,doc.locationId,'purchasing.view',false):businessAccess;
   return present(doc,access.permissions['catalogue.cost']);
  });
 }
 async list(ctx:AuthContext,businessId:string,query:{page:number;kind:'ORDER'|'RECEIPT';locationId?:string;supplierId?:string;status?:string}){
  return this.auth.transaction(async tx=>{
   const access=await requireBusiness(this.auth,tx,ctx,businessId,'purchasing.view');
   if(!access.permissions['locations.view'])throw new ApiError(403,'FORBIDDEN','Location access required');
   if(query.locationId)await requireLocation(this.auth,tx,ctx,businessId,query.locationId,'purchasing.view',false);
   const where:Prisma.PurchaseDocumentWhereInput={businessId,kind:query.kind,...(query.locationId?{locationId:query.locationId}:{}),...(query.supplierId?{supplierId:query.supplierId}:{}),...(query.status?{status:query.status}:{}),...(access.permissions['locations.all']?{}:{OR:[{location:{assignments:{some:{businessId,membershipId:access.membership.id}}}},{locationId:null,actorId:access.user.id}]} )};
   const rows=await tx.purchaseDocument.findMany({where,skip:(query.page-1)*25,take:25,orderBy:[{createdAt:'desc'},{id:'desc'}]});
   return {page:query.page,pageSize:25,total:await tx.purchaseDocument.count({where}),items:rows.map(({requestHash,clientKey,...row})=>({...row,documentDate:row.documentDate.toISOString().slice(0,10)}))};
  });
 }
 private async lines(tx:Tx,businessId:string,input:InventoryDocumentInput['lines'],cost:boolean,existing?:Doc){
  const output=[];
  for(const line of input){
   const product=await tx.product.findFirst({where:{businessId,id:line.productId},include:{barcodes:true}});
   if(!product)throw new ApiError(404,'PRODUCT_NOT_FOUND','Product not found');
   if(!product.active)throw new ApiError(409,'PRODUCT_INACTIVE','Product inactive');
   if(line.unitCost!==undefined&&!cost)throw new ApiError(403,'FORBIDDEN','Cost permission required');
   const pack=line.packId?await tx.productPack.findFirst({where:{id:line.packId,businessId,productId:product.id,retiredAt:null}}):null;
   if(line.packId&&!pack)throw new ApiError(404,'PACK_NOT_FOUND','Pack not found');
   const factor=pack?.baseQuantity.toFixed(4)??'1.0000';
   const old=existing?.lines.find(l=>l.productId===line.productId);
   output.push({businessId,plannedItemId:line.plannedItemId,productId:product.id,sku:product.sku,name:product.name,unit:product.unit,barcodes:product.barcodes.map(b=>b.value),
    packName:pack?.name??null,factor,quantity:line.quantity,baseQuantity:convertPack(line.quantity,factor),
    unitCost:line.unitCost??old?.unitCost.toFixed(4)??product.purchasePrice.toFixed(4)});
  }
  return output;
 }
 private async order(tx:Tx,businessId:string,orderId:string|undefined|null,supplierId:string,locationId:string,lines:{productId:string;baseQuantity:string;plannedItemId?:string|null}[],access:BusinessAccess){
  if(!orderId){
   if(lines.some(line=>line.plannedItemId))throw new ApiError(422,'ORDER_MISMATCH','Link planned items to their purchase order');
   return null;
  }
  const order=await tx.purchaseDocument.findFirst({where:{id:orderId,businessId,kind:'ORDER'},include:details});
  if(!order)throw new ApiError(404,'NOT_FOUND','Purchase order not found');
  if(!order.locationId)checkPlanAccess(access,order);
  if((order.supplierId&&order.supplierId!==supplierId)||(order.locationId&&order.locationId!==locationId))
   throw new ApiError(422,'ORDER_MISMATCH','Supplier and location must match the order');
  if(!['OPEN','PARTIAL'].includes(order.status))throw stateError();
  const used=new Set<string>();
  for(const line of lines){
   const planned=order.locationId
    ?order.lines.find(l=>l.productId===line.productId&&!line.plannedItemId)
    :order.plannedItems.find(item=>item.id===line.plannedItemId);
   const quantity=planned&&('baseQuantity' in planned?planned.baseQuantity:planned.quantity);
   if(!planned||!quantity||used.has(planned.id)||scaled(line.baseQuantity)>scaled(quantity.toFixed(4))-scaled(planned.receivedQuantity.toFixed(4)))
    throw new ApiError(409,'ORDER_QUANTITY_EXCEEDED','Receipt exceeds remaining order quantity');
   used.add(planned.id);
  }
  return order;
 }
 private async savePlan(tx:Tx,ctx:AuthContext,businessId:string,input:PlanInput|PlanPatch,doc?:Doc){
  const access=await requireBusiness(this.auth,tx,ctx,businessId,'purchasing.manage');
  if(!access.permissions['purchasing.view'])throw new ApiError(403,'FORBIDDEN','Purchasing view permission required');
  const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  if('clientKey' in input){
   const prior=await tx.purchaseDocument.findUnique({where:{businessId_clientKey:{businessId,clientKey:input.clientKey}},include:details});
   if(prior){
    if(prior.locationId||prior.requestHash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Request key already used');
    checkPlanAccess(access,prior);
    return present(prior,false);
   }
  }
  if(doc){
   checkPlanAccess(access,doc);
   if(doc.status!=='DRAFT')throw stateError();
   if(!('revision' in input)||doc.revision!==input.revision)throw conflict();
  }
  await entitled(tx,businessId);
  const supplier=input.supplierId?await tx.supplier.findFirst({where:{id:input.supplierId,businessId,active:true}}):null;
  if(input.supplierId&&!supplier)throw new ApiError(409,'SUPPLIER_INACTIVE','Choose an active supplier');
  const id=doc?.id??randomUUID();
  const fields={supplierId:supplier?.id??null,supplierName:supplier?.name??'',documentDate:new Date(input.documentDate),notes:input.notes};
  if(doc&&'revision' in input){
   const updated=await tx.purchaseDocument.updateMany({where:{id,businessId,revision:input.revision,status:'DRAFT'},data:{...fields,revision:{increment:1}}});
   if(!updated.count)throw conflict();
   await tx.purchasePlanItem.deleteMany({where:{businessId,documentId:id}});
  }else if('clientKey' in input){
   await tx.purchaseDocument.create({data:{...fields,id,businessId,kind:'ORDER',reference:`PO-${id}`,clientKey:input.clientKey,requestHash:hash,
    locationName:'',currency:access.business.baseCurrency,actorId:ctx.user.id,actorName:ctx.user.name}});
  }
  await tx.purchasePlanItem.createMany({data:input.plannedItems.map((item,position)=>({...item,position,businessId,documentId:id}))});
  await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:doc?'purchase.updated':'purchase.created',targetId:id,changes:{kind:'ORDER'}}});
  return present(await tx.purchaseDocument.findUniqueOrThrow({where:{id},include:details}),false);
 }
 async create(ctx:AuthContext,businessId:string,input:DocumentInput,retry=true):Promise<ReturnType<typeof present>>{
  try{return await this.auth.transaction(async tx=>{
   if('plannedItems' in input)return this.savePlan(tx,ctx,businessId,input);
   const access=await requireLocation(this.auth,tx,ctx,businessId,input.locationId,input.kind==='ORDER'?'purchasing.manage':'receiving.create');
   if(!access.permissions['purchasing.view'])throw new ApiError(403,'FORBIDDEN','Purchasing view permission required');
   const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
   const previous=await tx.purchaseDocument.findUnique({where:{businessId_clientKey:{businessId,clientKey:input.clientKey}},include:details});
   if(previous){
    // Do not return another location's record through a reused request key.
    if(previous.locationId)await requireLocation(this.auth,tx,ctx,businessId,previous.locationId,'purchasing.view',false);
    else checkPlanAccess(access,previous);
    if(previous.requestHash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Request key already used');
    return present(previous,access.permissions['catalogue.cost']);
   }
   await entitled(tx,businessId);
   const supplier=await tx.supplier.findFirst({where:{id:input.supplierId,businessId,active:true}});
   if(!supplier)throw new ApiError(409,'SUPPLIER_INACTIVE','Choose an active supplier');
   const lines=await this.lines(tx,businessId,input.lines,access.permissions['catalogue.cost']);
   const order=await this.order(tx,businessId,input.orderId,input.supplierId,input.locationId,lines,access);
   if(order?.locationId)for(const line of lines){if(input.lines.find(l=>l.productId===line.productId)?.unitCost===undefined)line.unitCost=order.lines.find(l=>l.productId===line.productId)!.unitCost.toFixed(4);}
   const id=randomUUID(),{lines:ignored,...data}=input;
   const doc=await tx.purchaseDocument.create({data:{...data,id,businessId,requestHash:hash,reference:`${input.kind==='ORDER'?'PO':'RCV'}-${id}`,supplierName:supplier.name,locationName:access.location.name,currency:access.business.baseCurrency,
    documentDate:new Date(input.documentDate),actorId:ctx.user.id,actorName:ctx.user.name}});
   await tx.purchaseLine.createMany({data:lines.map(l=>({...l,documentId:id}))});
   if(!access.business.currencyLockedAt)await tx.business.update({where:{id:businessId},data:{currencyLockedAt:new Date(),revision:{increment:1}}});
   await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:'purchase.created',targetId:id,changes:{kind:doc.kind,reference:doc.reference}}});
   return present(await tx.purchaseDocument.findUniqueOrThrow({where:{id},include:details}),access.permissions['catalogue.cost']);
  });}catch(error){
   if(retry&&(error as {code?:string}).code==='P2002')return this.create(ctx,businessId,input,false);
   throw error;
  }
 }
 async update(ctx:AuthContext,businessId:string,id:string,input:DocumentPatch){
  return this.auth.transaction(async tx=>{
   await requireBusiness(this.auth,tx,ctx,businessId,'purchasing.view');
   const doc=await tx.purchaseDocument.findFirst({where:{id,businessId},include:details});
   if(!doc)throw new ApiError(404,'NOT_FOUND','Document not found');
   if('plannedItems' in input){
    if(doc.kind!=='ORDER'||doc.locationId)throw stateError();
    return this.savePlan(tx,ctx,businessId,input,doc);
   }
   if(!doc.locationId||!doc.supplierId)throw stateError();
   const access=await requireLocation(this.auth,tx,ctx,businessId,doc.locationId,doc.kind==='ORDER'?'purchasing.manage':'receiving.create');
   if(doc.revision!==input.revision)throw conflict();
   if(doc.status!=='DRAFT')throw stateError();
   await entitled(tx,businessId);
   const lines=await this.lines(tx,businessId,input.lines,access.permissions['catalogue.cost'],doc);
   const order=await this.order(tx,businessId,doc.orderId,doc.supplierId,doc.locationId,lines,access);
   // Newly added receipt lines inherit the approved order price, just as on
   // creation. Preserve existing receipt snapshots and explicit authorized edits.
   if(order?.locationId)for(const line of lines){
    if(!doc.lines.some(old=>old.productId===line.productId)&&input.lines.find(l=>l.productId===line.productId)?.unitCost===undefined)
     line.unitCost=order.lines.find(l=>l.productId===line.productId)!.unitCost.toFixed(4);
   }
   const changed=await tx.purchaseDocument.updateMany({where:{id,businessId,revision:input.revision,status:'DRAFT'},data:{documentDate:new Date(input.documentDate),notes:input.notes,supplierReference:input.supplierReference,revision:{increment:1}}});
   if(!changed.count)throw conflict();
   await tx.purchaseLine.deleteMany({where:{businessId,documentId:id}});
   await tx.purchaseLine.createMany({data:lines.map(l=>({...l,documentId:id}))});
   await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:'purchase.updated',targetId:id,changes:{revision:input.revision+1}}});
   return present(await tx.purchaseDocument.findUniqueOrThrow({where:{id},include:details}),access.permissions['catalogue.cost']);
  });
 }
 async transition(ctx:AuthContext,businessId:string,id:string,input:{revision:number;action:'submit'|'reopen'|'confirm'|'receive'|'cancel'}){
  return this.auth.transaction(async tx=>{
   await requireBusiness(this.auth,tx,ctx,businessId,'purchasing.view');
   await tx.$queryRaw`SELECT id FROM purchase_documents WHERE business_id=${businessId}::uuid AND id=${id}::uuid FOR UPDATE`;
   const doc=await tx.purchaseDocument.findFirst({where:{id,businessId},include:details});
   if(!doc)throw new ApiError(404,'NOT_FOUND','Document not found');
   const locationId=doc.locationId;
   const supplierId=doc.supplierId;
   if(input.action==='receive'&&doc.kind!=='RECEIPT')throw stateError();
   const actionPermission=doc.kind==='ORDER'?'purchasing.manage':['confirm','receive'].includes(input.action)?'receiving.confirm':'receiving.create';
   const locationAccess=locationId?await requireLocation(this.auth,tx,ctx,businessId,locationId,actionPermission,false):null;
   const access=locationAccess??await requireBusiness(this.auth,tx,ctx,businessId,actionPermission);
   if(!locationId)checkPlanAccess(access,doc);
   // Direct receiving combines preparation and approval; neither permission is optional.
   if(input.action==='receive'&&!access.permissions['receiving.create'])throw new ApiError(403,'FORBIDDEN','Receiving preparation permission required');
   // Durable confirm replay is authorized but independent of current trial/status revision.
   if(['confirm','receive'].includes(input.action)&&doc.kind==='RECEIPT'&&doc.status==='COMPLETED')return present(doc,access.permissions['catalogue.cost']);
   if(doc.revision!==input.revision)throw conflict();
   let status:string;
   if(input.action==='cancel'){
    if(!access.permissions[doc.kind==='ORDER'?'purchasing.delete':'receiving.delete'])throw new ApiError(403,'FORBIDDEN','Cancellation permission required');
    if(!['DRAFT','PENDING','OPEN','PARTIAL'].includes(doc.status))throw stateError();
    if(doc.kind==='ORDER'&&await tx.purchaseDocument.count({where:{businessId,orderId:id,status:{in:['DRAFT','PENDING']}}}))throw new ApiError(409,'OPEN_RECEIPTS','Cancel outstanding receipts first');
    status='CANCELLED';
   }else if(input.action==='reopen'){
    if(doc.kind!=='RECEIPT'||doc.status!=='PENDING')throw stateError();status='DRAFT';
   }else{
    if(locationAccess?.location.archivedAt)throw new ApiError(409,'LOCATION_ARCHIVED','Location archived');
    await entitled(tx,businessId);
    if(supplierId&&!(await tx.supplier.findFirst({where:{id:supplierId,businessId,active:true}})))throw new ApiError(409,'SUPPLIER_INACTIVE','Supplier inactive');
    if(await tx.product.count({where:{businessId,id:{in:doc.lines.map(l=>l.productId)},active:true}})!==doc.lines.length)throw new ApiError(409,'PRODUCT_INACTIVE','Product inactive');
    if(input.action==='submit'){if(doc.status!=='DRAFT')throw stateError();status=doc.kind==='ORDER'?'OPEN':'PENDING';}
    else{
     if(doc.kind!=='RECEIPT'||doc.status!==(input.action==='receive'?'DRAFT':'PENDING')||!locationId||!supplierId)throw stateError();
     const order=await this.order(tx,businessId,doc.orderId,supplierId,locationId,doc.lines.map(l=>({productId:l.productId,plannedItemId:l.plannedItemId,baseQuantity:l.baseQuantity.toFixed(4)})),access);
     // Consistent product ordering reduces lock contention between documents.
     for(const line of [...doc.lines].sort((a,b)=>a.productId.localeCompare(b.productId))){
      await postStock(tx,{businessId,locationId,productId:line.productId,delta:line.baseQuantity.toFixed(4),unitCost:line.unitCost.toFixed(4),type:'PURCHASE_RECEIPT',sourceId:id,sourceLineId:line.id,reference:doc.reference,actorId:ctx.user.id,notes:doc.notes});
      if(line.plannedItemId)await tx.purchasePlanItem.update({where:{id:line.plannedItemId},data:{receivedQuantity:{increment:line.baseQuantity}}});
      else if(order){const planned=order.lines.find(l=>l.productId===line.productId)!;await tx.purchaseLine.update({where:{id:planned.id},data:{receivedQuantity:{increment:line.baseQuantity}}});}
     }
     if(order){
      const complete=order.locationId
       ?(await tx.purchaseLine.findMany({where:{businessId,documentId:order.id}})).every(l=>l.receivedQuantity.equals(l.baseQuantity))
       :(await tx.purchasePlanItem.findMany({where:{businessId,documentId:order.id}})).every(l=>l.receivedQuantity.equals(l.quantity));
      await tx.purchaseDocument.update({where:{id:order.id},data:{status:complete?'RECEIVED':'PARTIAL',revision:{increment:1}}});
     }
     status='COMPLETED';
    }
   }
   await tx.purchaseDocument.update({where:{id},data:{status,revision:{increment:1},...(status==='COMPLETED'?{completedAt:new Date(),completedBy:ctx.user.id,completedName:ctx.user.name}:{})}});
   await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:'purchase.status_changed',targetId:id,changes:{from:doc.status,to:status}}});
   return present(await tx.purchaseDocument.findUniqueOrThrow({where:{id},include:details}),access.permissions['catalogue.cost']);
  });
 }
}
