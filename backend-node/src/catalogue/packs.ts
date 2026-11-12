import { z } from 'zod';
import type { AuthContext, AuthService } from '../auth/service.js';
import { requireBusiness } from '../businesses/access.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
import { decimal } from './contracts.js';

const scaled=(value:string)=>{const [whole,fraction='']=value.split('.');return BigInt(whole!)*10000n+BigInt(fraction.padEnd(4,'0'));};
export const packSchema=z.object({
  name:z.string().trim().min(2).max(80),
  baseQuantity:decimal.refine(value=>decimal.safeParse(value).success && scaled(value)>0n),
}).strict();
export const conversionSchema=z.object({quantity:decimal.refine(value=>decimal.safeParse(value).success && scaled(value)>0n)}).strict();

// Reject quantities that stock's numeric(18,4) cannot represent; never round.
export function convertPack(quantity:string,factor:string){
  const product=scaled(quantity)*scaled(factor);
  if(product%10000n!==0n)throw new ApiError(422,'QUANTITY_PRECISION','Result needs more than four decimal places');
  const result=product/10000n;
  if(result>999999999999999999n)throw new ApiError(422,'QUANTITY_OVERFLOW','Result exceeds the stock quantity limit');
  return `${result/10000n}.${String(result%10000n).padStart(4,'0')}`;
}
export class PackService {
  constructor(readonly auth:AuthService){}
  async list(ctx:AuthContext,businessId:string,productId:string){
    return this.auth.transaction(async tx=>{
      await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.view');
      const product=await tx.product.findFirst({where:{businessId,id:productId}});
      if(!product)throw new ApiError(404,'PRODUCT_NOT_FOUND','Product not found');
      const rows=await tx.productPack.findMany({where:{businessId,productId},orderBy:{name:'asc'}});
      return {baseUnit:product.unit,items:rows.map(row=>({...row,baseQuantity:row.baseQuantity.toFixed(4)}))};
    });
  }
  async create(ctx:AuthContext,businessId:string,productId:string,input:z.infer<typeof packSchema>){
    try{return await this.auth.transaction(async tx=>{
      await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.edit');
      const product=await tx.product.findFirst({where:{businessId,id:productId}});
      if(!product)throw new ApiError(404,'PRODUCT_NOT_FOUND','Product not found');
      if(!product.active)throw new ApiError(409,'PRODUCT_INACTIVE','Product is inactive');
      if(!(await billingState(tx,businessId)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','An active subscription is required');
      if(await tx.productPack.count({where:{businessId,productId,retiredAt:null}})>=20)throw new ApiError(409,'PACK_LIMIT','Maximum twenty packs per product');
      const row=await tx.productPack.create({data:{businessId,productId,...input}});
      await tx.authAudit.create({data:{userId:ctx.user.id,businessId,action:'product.pack_created',targetId:productId,changes:{packId:row.id,name:row.name,baseQuantity:row.baseQuantity.toFixed(4)}}});
      return {...row,baseQuantity:row.baseQuantity.toFixed(4)};
    });}catch(error){
      if((error as {code?:string}).code==='P2002')throw new ApiError(409,'PACK_EXISTS','Pack name already exists for this product');
      throw error;
    }
  }
  async retire(ctx:AuthContext,businessId:string,productId:string,id:string){
    return this.auth.transaction(async tx=>{
      await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.edit');
      await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.delete');
      const pack=await tx.productPack.findFirst({where:{id,businessId,productId}});
      if(!pack)throw new ApiError(404,'PACK_NOT_FOUND','Pack not found');
      if(pack.retiredAt)return {ok:true};
      await tx.productPack.update({where:{id},data:{retiredAt:new Date()}});
      await tx.authAudit.create({data:{userId:ctx.user.id,businessId,action:'product.pack_retired',targetId:productId,changes:{packId:id}}});
      return {ok:true};
    });
  }
  async convert(ctx:AuthContext,businessId:string,productId:string,id:string,quantity:string){
    return this.auth.transaction(async tx=>{
      await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.view');
      const pack=await tx.productPack.findFirst({where:{id,businessId,productId},include:{product:true}});
      if(!pack)throw new ApiError(404,'PACK_NOT_FOUND','Pack not found');
      if(!pack.product.active)throw new ApiError(409,'PRODUCT_INACTIVE','Product is inactive');
      return {packId:id,quantity,baseUnit:pack.product.unit,baseQuantity:convertPack(quantity,pack.baseQuantity.toFixed(4))};
    });
  }
}
