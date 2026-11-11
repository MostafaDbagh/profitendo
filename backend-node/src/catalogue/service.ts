import type { AuthService, AuthContext } from '../auth/service.js';
import { requireBusiness } from '../businesses/access.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
import type { ProductInput, ProductPatch } from './contracts.js';
import type { Prisma } from '../generated/prisma/client.js';
type Row=Prisma.ProductGetPayload<{include:{barcodes:true}}>;
const conflict=()=>new ApiError(409,'REVISION_CONFLICT','Reload before saving');
function present(row:Row,cost:boolean){
  const {purchasePrice,sellingPrice,minimumStock,barcodes,...rest}=row;
  return {...rest,sellingPrice:sellingPrice.toFixed(4),minimumStock:minimumStock.toFixed(4),
    ...(cost?{purchasePrice:purchasePrice.toFixed(4)}:{}),barcodes:barcodes.map(b=>b.value).sort()};
}
function unique(error:unknown):never {
  if((error as {code?:string}).code==='P2002')throw new ApiError(409,'PRODUCT_IDENTIFIER_EXISTS','SKU or barcode already belongs to a product in this business');
  throw error;
}
export class CatalogueService {
  constructor(readonly auth:AuthService){}
  async list(ctx:AuthContext,businessId:string,query:{page:number;search?:string;state:'active'|'inactive'|'all'}){
    return this.auth.transaction(async tx=>{
      const access=await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.view');
      const where:Prisma.ProductWhereInput={businessId,...(query.state==='all'?{}:{active:query.state==='active'}),
        ...(query.search?{OR:[{name:{contains:query.search,mode:'insensitive'}},{sku:{contains:query.search,mode:'insensitive'}},{barcodes:{some:{value:query.search}}}]}:{})};
      const items=await tx.product.findMany({where,skip:(query.page-1)*25,take:25,orderBy:[{name:'asc'},{id:'asc'}],include:{barcodes:true}});
      return {page:query.page,pageSize:25,total:await tx.product.count({where}),currency:access.business.baseCurrency,items:items.map(row=>present(row,access.permissions['catalogue.cost']))};
    });
  }
  async get(ctx:AuthContext,businessId:string,selector:{id:string}|{barcode:string}){
    return this.auth.transaction(async tx=>{
      const access=await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.view');
      const row=await tx.product.findFirst({where:{businessId,...('id' in selector?{id:selector.id}:{barcodes:{some:{value:selector.barcode}}})},include:{barcodes:true}});
      if(!row)throw new ApiError(404,'PRODUCT_NOT_FOUND','Product not found');
      // Scanner lookup must distinguish an inactive item from an unknown barcode.
      if('barcode' in selector && !row.active)throw new ApiError(409,'PRODUCT_INACTIVE','This product is inactive');
      return {currency:access.business.baseCurrency,product:present(row,access.permissions['catalogue.cost'])};
    });
  }
  async create(ctx:AuthContext,businessId:string,input:ProductInput){
    try{return await this.auth.transaction(async tx=>{
      const access=await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.manage');
      if(!access.permissions['catalogue.cost'])throw new ApiError(403,'FORBIDDEN','Purchase-cost permission is required');
      if(!(await billingState(tx,businessId)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','An active subscription is required to add products');
      const {barcodes,...data}=input;
      const created=await tx.product.create({data:{businessId,...data}});
      await tx.productBarcode.createMany({data:barcodes.map(value=>({businessId,productId:created.id,value}))});
      const row=await tx.product.findUniqueOrThrow({where:{id:created.id},include:{barcodes:true}});
      // A base-currency change would silently relabel saved price amounts.
      if(!access.business.currencyLockedAt)await tx.business.update({where:{id:businessId},data:{currencyLockedAt:new Date(),revision:{increment:1}}});
      await tx.authAudit.create({data:{userId:ctx.user.id,businessId,action:'product.created',targetId:row.id,changes:{sku:row.sku}}});
      return present(row,true);
    });}catch(error){return unique(error);}
  }
  async update(ctx:AuthContext,businessId:string,id:string,input:ProductPatch){
    try{return await this.auth.transaction(async tx=>{
      const access=await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.manage');
      if(input.purchasePrice!==undefined && !access.permissions['catalogue.cost'])throw new ApiError(403,'FORBIDDEN','Purchase-cost permission is required');
      const current=await tx.product.findFirst({where:{id,businessId}});
      if(!current)throw new ApiError(404,'PRODUCT_NOT_FOUND','Product not found');
      if(current.revision!==input.revision)throw conflict();
      if(input.active && !current.active && !(await billingState(tx,businessId)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','An active subscription is required to reactivate products');
      const {revision,barcodes,...data}=input;
      const changed=await tx.product.updateMany({where:{id,businessId,revision},data:{...data,revision:{increment:1}}});if(!changed.count)throw conflict();
      if(barcodes!==undefined){await tx.productBarcode.deleteMany({where:{businessId,productId:id}});await tx.productBarcode.createMany({data:barcodes.map(value=>({businessId,productId:id,value}))});}
      // The general business audit must not leak confidential price values.
      await tx.authAudit.create({data:{userId:ctx.user.id,businessId,action:'product.updated',targetId:id,changes:{fields:Object.keys(input).filter(key=>key!=='revision')}}});
      return present(await tx.product.findUniqueOrThrow({where:{id},include:{barcodes:true}}),access.permissions['catalogue.cost']);
    });}catch(error){return unique(error);}
  }
}
