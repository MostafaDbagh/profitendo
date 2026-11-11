import type { z } from 'zod';
import type { AuthContext, AuthService } from '../auth/service.js';
import { requireBusiness } from '../businesses/access.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
import { supplierSchema, supplierPatch } from './contracts.js';
export class SupplierService {
 constructor(readonly auth:AuthService){}
 async list(ctx:AuthContext,businessId:string,page:number,search:string,state:string){
  return this.auth.transaction(async tx=>{
   await requireBusiness(this.auth,tx,ctx,businessId,'suppliers.view');
   const where={businessId,...(state==='all'?{}:{active:state==='active'}),...(search?{OR:[{name:{contains:search,mode:'insensitive' as const}},{code:{contains:search,mode:'insensitive' as const}}]}:{})};
   return {page,pageSize:25,total:await tx.supplier.count({where}),items:await tx.supplier.findMany({where,skip:(page-1)*25,take:25,orderBy:[{name:'asc'},{id:'asc'}]})};
  });
 }
 async save(ctx:AuthContext,businessId:string,input:z.infer<typeof supplierSchema>|z.infer<typeof supplierPatch>,id?:string){
  try{return await this.auth.transaction(async tx=>{
   await requireBusiness(this.auth,tx,ctx,businessId,'suppliers.manage');
   if(id){
    const row=await tx.supplier.findFirst({where:{businessId,id}});
    if(!row)throw new ApiError(404,'NOT_FOUND','Supplier not found');
    const {revision,...data}=input as z.infer<typeof supplierPatch>;
    if(row.revision!==revision)throw new ApiError(409,'REVISION_CONFLICT','Reload before saving');
    if(data.active&&!row.active&&!(await billingState(tx,businessId)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','Active subscription required');
    const changed=await tx.supplier.updateMany({where:{id,businessId,revision},data:{...data,revision:{increment:1}}});
    if(!changed.count)throw new ApiError(409,'REVISION_CONFLICT','Reload before saving');
    await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:'supplier.updated',targetId:id,changes:{fields:Object.keys(data)}}});
    return tx.supplier.findUniqueOrThrow({where:{id}});
   }
   if(!(await billingState(tx,businessId)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','Active subscription required');
   const row=await tx.supplier.create({data:{businessId,...input as z.infer<typeof supplierSchema>}});
   await tx.authAudit.create({data:{businessId,userId:ctx.user.id,action:'supplier.created',targetId:row.id,changes:{code:row.code}}});return row;
  });}catch(error){if((error as {code?:string}).code==='P2002')throw new ApiError(409,'SUPPLIER_CODE_EXISTS','Supplier code is already used');throw error;}
 }
}
