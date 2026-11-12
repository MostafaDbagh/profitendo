import { lockCash } from '../finance/cash.js';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthContext, AuthService, Tx } from '../auth/service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { requireLocation } from '../locations/access.js';
import { requireBusiness } from '../businesses/access.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
import { postStock } from '../operations/inventory.js';
import { fixed, scaled } from '../operations/decimal.js';
import { convertPack } from '../catalogue/packs.js';
import { checked, exactMoney, lineGross, currencyDigits } from './money.js';
import type { SaleInput, SalePatch, Checkout } from './contracts.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fail(code:string,status=409):never{throw new ApiError(status,code,code);}
const include={lines:true,payment:true} as const;
type Sale=Prisma.SaleGetPayload<{include:typeof include}>;
type Access=Awaited<ReturnType<typeof requireLocation>>;
function present(doc:Sale,access:Access){
 const {requestHash,clientKey,checkoutKey,checkoutHash,...data}=doc;
 const edit=doc.status==='DRAFT'&&access.permissions['sales.create']&&(doc.actorId===access.user.id||access.permissions['sales.manage']);
 return {...data,lines:doc.lines.map(({unitCost,...line})=>line),capabilities:{edit,cancel:edit,checkout:edit}};
}
async function entitled(tx:Tx,bid:string){if(!(await billingState(tx,bid)).active)fail('SUBSCRIPTION_REQUIRED',402);}
export class SalesService{
 constructor(readonly auth:AuthService){}
 private async document(tx:Tx,ctx:AuthContext,bid:string,id:string,lock=false){
  await requireBusiness(this.auth,tx,ctx,bid,'sales.view');
  const found=await tx.sale.findFirst({where:{businessId:bid,id}});if(!found)fail('NOT_FOUND',404);
  const access=await requireLocation(this.auth,tx,ctx,bid,found.locationId,'sales.view',false);
  if(lock)await tx.$queryRaw`SELECT id FROM sales WHERE id=${id}::uuid AND business_id=${bid}::uuid FOR UPDATE`;
  return {doc:await tx.sale.findUniqueOrThrow({where:{id},include}),access};
 }
 private edit(doc:Sale,access:Access,revision:number){
  if(!access.permissions['sales.create']||(doc.actorId!==access.user.id&&!access.permissions['sales.manage']))fail('FORBIDDEN',403);
  if(doc.status!=='DRAFT')fail('SALE_STATE');if(doc.revision!==revision)fail('REVISION_CONFLICT');
 }
 private async price(tx:Tx,bid:string,input:SalePatch['lines'],access:Access){
  const digits=currencyDigits(access.business.baseCurrency),lines=[];let subtotal=0n,discount=0n;
  for(const entry of input){
   const p=await tx.product.findFirst({where:{businessId:bid,id:entry.productId,active:true},include:{barcodes:true,packs:true}});if(!p)fail('PRODUCT_INACTIVE');
   const pack=entry.packId?p.packs.find(p=>p.id===entry.packId&&!p.retiredAt):null;if(entry.packId&&!pack)fail('PACK_NOT_FOUND',404);
   const factor=pack?.baseQuantity.toFixed(4)??'1.0000',baseQuantity=convertPack(entry.quantity,factor),gross=lineGross(baseQuantity,p.sellingPrice.toFixed(4),digits),reduction=exactMoney(entry.discount,digits);
   if(reduction>0n){if(!access.permissions['sales.discount'])fail('FORBIDDEN',403);if(entry.discountReason.length<5)fail('DISCOUNT_REASON_REQUIRED',422);}
   if(reduction>scaled(gross))fail('DISCOUNT_EXCEEDED',422);
   subtotal+=scaled(gross);discount+=reduction;
   lines.push({businessId:bid,productId:p.id,packId:entry.packId,unitKey:entry.packId??'BASE',sku:p.sku,name:p.name,unit:p.unit,barcodes:p.barcodes.map(b=>b.value),packName:pack?.name??null,factor,quantity:entry.quantity,baseQuantity,unitPrice:p.sellingPrice.toFixed(4),unitCost:p.purchasePrice.toFixed(4),gross,discount:checked(reduction),discountReason:entry.discountReason,total:checked(scaled(gross)-reduction)});
  }
  return {lines,subtotal:checked(subtotal),discount:checked(discount),total:checked(subtotal-discount),currency:access.business.baseCurrency,currencyDigits:digits,expiresAt:new Date(Date.now()+15*60*1000)};
 }
 async products(ctx:AuthContext,bid:string,q:{locationId:string;page:number;search:string;barcode?:string}){
  return this.auth.transaction(async tx=>{
   const access=await requireLocation(this.auth,tx,ctx,bid,q.locationId,'sales.create');if(access.location.kind!=='SHOP')fail('SHOP_REQUIRED',422);
   const where={businessId:bid,active:true,...(q.barcode?{barcodes:{some:{value:q.barcode}}}:q.search?{OR:[{name:{contains:q.search,mode:'insensitive' as const}},{sku:{contains:q.search,mode:'insensitive' as const}},{barcodes:{some:{value:q.search}}}]}:{})};
   const products=await tx.product.findMany({where,skip:(q.page-1)*25,take:25,orderBy:[{name:'asc'},{id:'asc'}],select:{id:true,name:true,sku:true,unit:true,sellingPrice:true,barcodes:{select:{value:true}},packs:{where:{retiredAt:null},select:{id:true,name:true,baseQuantity:true}},balances:{where:{locationId:q.locationId},select:{onHand:true,reserved:true}}}});
   return {page:q.page,pageSize:25,total:await tx.product.count({where}),items:products.map(({balances,...p})=>({...p,available:fixed(balances.reduce((sum,b)=>sum+scaled(b.onHand.toFixed(4))-scaled(b.reserved.toFixed(4)),0n))}))};
  });
 }
 async list(ctx:AuthContext,bid:string,q:{page:number;locationId?:string;status?:string}){
  return this.auth.transaction(async tx=>{
   const access=await requireBusiness(this.auth,tx,ctx,bid,'sales.view');if(!access.permissions['locations.view'])fail('FORBIDDEN',403);
   if(q.locationId)await requireLocation(this.auth,tx,ctx,bid,q.locationId,'sales.view',false);
   const where={businessId:bid,...(q.locationId?{locationId:q.locationId}:{}),...(q.status?{status:q.status}:{}),...(access.permissions['locations.all']?{}:{location:{assignments:{some:{businessId:bid,membershipId:access.membership.id}}}})};
   const items=await tx.sale.findMany({where,skip:(q.page-1)*25,take:25,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,reference:true,status:true,locationName:true,customerName:true,total:true,currency:true,currencyDigits:true,actorName:true,createdAt:true}});
   return {items,page:q.page,pageSize:25,total:await tx.sale.count({where})};
  });
 }
 async read(ctx:AuthContext,bid:string,id:string){return this.auth.transaction(async tx=>{const {doc,access}=await this.document(tx,ctx,bid,id);return present(doc,access);});}
 async create(ctx:AuthContext,bid:string,input:SaleInput,retry=true):Promise<ReturnType<typeof present>>{
  try{return await this.auth.transaction(async tx=>{
   await requireBusiness(this.auth,tx,ctx,bid,'sales.view');const access=await requireLocation(this.auth,tx,ctx,bid,input.locationId,'sales.create',false);
   const prior=await tx.sale.findUnique({where:{businessId_clientKey:{businessId:bid,clientKey:input.clientKey}},include}),requestHash=hash(input);
   if(prior){if(prior.actorId!==ctx.user.id&&!access.permissions['sales.manage'])fail('FORBIDDEN',403);if(prior.requestHash!==requestHash)fail('IDEMPOTENCY_CONFLICT');return present(prior,access);}
   if(access.location.archivedAt)fail('LOCATION_ARCHIVED');if(access.location.kind!=='SHOP')fail('SHOP_REQUIRED',422);await entitled(tx,bid);
   const {lines,...pricing}=await this.price(tx,bid,input.lines,access),id=randomUUID();
   await tx.sale.create({data:{id,businessId:bid,locationId:input.locationId,clientKey:input.clientKey,requestHash,reference:`SALE-${id.slice(0,8).toUpperCase()}`,businessName:access.business.name,locationName:access.location.name,locationCode:access.location.code,timezone:access.business.timezone,customerName:input.customerName,notes:input.notes,actorId:ctx.user.id,actorName:ctx.user.name,pricedBy:ctx.user.id,pricedName:ctx.user.name,...pricing}});
   await tx.saleLine.createMany({data:lines.map(l=>({...l,saleId:id}))});
   await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'sale.created',targetId:id,changes:{}}});
   return present(await tx.sale.findUniqueOrThrow({where:{id},include}),access);
  });}catch(e){if(retry&&(e as {code?:string}).code==='P2002')return this.create(ctx,bid,input,false);throw e;}
 }
 async update(ctx:AuthContext,bid:string,id:string,input:SalePatch){return this.auth.transaction(async tx=>{
  const {doc,access}=await this.document(tx,ctx,bid,id,true);this.edit(doc,access,input.revision);await requireLocation(this.auth,tx,ctx,bid,doc.locationId,'sales.create');await entitled(tx,bid);
  const {lines,...pricing}=await this.price(tx,bid,input.lines,access);await tx.saleLine.deleteMany({where:{businessId:bid,saleId:id}});await tx.saleLine.createMany({data:lines.map(l=>({...l,saleId:id}))});
  await tx.sale.update({where:{id},data:{...pricing,customerName:input.customerName,notes:input.notes,pricedBy:ctx.user.id,pricedName:ctx.user.name,revision:{increment:1}}});
  await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'sale.repriced',targetId:id,changes:{}}});return present(await tx.sale.findUniqueOrThrow({where:{id},include}),access);
 });}
 async cancel(ctx:AuthContext,bid:string,id:string,revision:number){return this.auth.transaction(async tx=>{const {doc,access}=await this.document(tx,ctx,bid,id,true);this.edit(doc,access,revision);await tx.sale.update({where:{id},data:{status:'CANCELLED',revision:{increment:1}}});await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'sale.cancelled',targetId:id,changes:{}}});return present(await tx.sale.findUniqueOrThrow({where:{id},include}),access);});}
 async checkout(ctx:AuthContext,bid:string,id:string,input:Checkout){return this.auth.transaction(async tx=>{
  const {doc,access}=await this.document(tx,ctx,bid,id,true),requestHash=hash(input);
  if(!access.permissions['sales.create']||(doc.actorId!==ctx.user.id&&!access.permissions['sales.manage']))fail('FORBIDDEN',403);
  if(doc.status==='COMPLETED'){if(doc.checkoutKey!==input.clientKey||doc.checkoutHash!==requestHash)fail('IDEMPOTENCY_CONFLICT');return present(doc,access);}
  this.edit(doc,access,input.revision);await requireLocation(this.auth,tx,ctx,bid,doc.locationId,'sales.create');await entitled(tx,bid);
  if(await tx.sale.findUnique({where:{businessId_checkoutKey:{businessId:bid,checkoutKey:input.clientKey}}}))fail('IDEMPOTENCY_CONFLICT');
  if(doc.expiresAt<=new Date())fail('QUOTE_EXPIRED');if(exactMoney(input.expectedTotal,doc.currencyDigits)!==scaled(doc.total.toFixed(4)))fail('TOTAL_CHANGED');
  if(doc.discount.gt(0)&&!access.permissions['sales.discount'])fail('FORBIDDEN',403);
  const received=exactMoney(input.payment.received,doc.currencyDigits),total=scaled(doc.total.toFixed(4));
  if(received<total||(input.payment.method!=='CASH'&&(received!==total||!input.payment.reference)))fail('PAYMENT_INVALID',422);
  const postedAt=input.payment.method==='CASH'?(await lockCash(tx,bid,doc.locationId,access.business.timezone)).at:new Date();
  for(const line of [...doc.lines].sort((a,b)=>a.productId.localeCompare(b.productId)||a.id.localeCompare(b.id))){
   const p=await tx.product.findFirst({where:{businessId:bid,id:line.productId,active:true}});if(!p)fail('PRODUCT_INACTIVE');if(!p.sellingPrice.equals(line.unitPrice))fail('PRICE_CHANGED');
   await postStock(tx,{businessId:bid,locationId:doc.locationId,productId:line.productId,delta:fixed(-scaled(line.baseQuantity.toFixed(4))),type:'SALE',sourceId:id,sourceLineId:line.id,reference:doc.reference,actorId:ctx.user.id,notes:doc.notes});
  }
  await tx.salePayment.create({data:{businessId:bid,saleId:id,method:input.payment.method,createdAt:postedAt,amount:doc.total,received:input.payment.received,change:checked(received-total),reference:input.payment.reference,actorId:ctx.user.id,actorName:ctx.user.name}});
  await tx.sale.update({where:{id},data:{status:'COMPLETED',revision:{increment:1},checkoutKey:input.clientKey,checkoutHash:requestHash,completedBy:ctx.user.id,completedName:ctx.user.name,completedAt:postedAt}});
  await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'sale.completed',targetId:id,changes:{}}});return present(await tx.sale.findUniqueOrThrow({where:{id},include}),access);
 }).catch(error=>{if((error as {code?:string}).code==='P2002')fail('IDEMPOTENCY_CONFLICT');throw error;});}
}
