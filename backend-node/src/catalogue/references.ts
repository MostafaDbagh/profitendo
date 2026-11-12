import { z } from 'zod';
import type { AuthContext, AuthService, Tx } from '../auth/service.js';
import { requireBusiness } from '../businesses/access.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
export const baseUnits=['PIECE','BOX','CARTON','KG','LITRE','METRE'];
export const referenceSchema=z.object({kind:z.enum(['CATEGORY','UNIT']),code:z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,31}$/),name:z.string().trim().min(2).max(80)}).strict();
export async function validateReferences(tx:Tx,businessId:string,input:{unit?:string;category?:string},previousCategory?:string){
 if(input.unit&&!baseUnits.includes(input.unit)&&!await tx.catalogueReference.findFirst({where:{businessId,kind:'UNIT',code:input.unit,active:true}}))throw new ApiError(422,'UNIT_UNAVAILABLE','Choose an active unit');
 if(input.category&&input.category!==previousCategory){
  const ref=await tx.catalogueReference.findFirst({where:{businessId,kind:'CATEGORY',name:input.category}});
  if(ref&&!ref.active)throw new ApiError(422,'CATEGORY_UNAVAILABLE','Choose an active category');
 }
}
export class ReferenceService {
 constructor(readonly auth:AuthService){}
 async list(ctx:AuthContext,businessId:string){return this.auth.transaction(async tx=>{
  await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.view');
  return {baseUnits,items:await tx.catalogueReference.findMany({where:{businessId},orderBy:[{kind:'asc'},{name:'asc'}],take:500})};
 });}
 async create(ctx:AuthContext,businessId:string,input:z.infer<typeof referenceSchema>){try{return await this.auth.transaction(async tx=>{
  await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.manage');
  if(!(await billingState(tx,businessId)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','Active subscription required');
  if(input.kind==='UNIT'&&baseUnits.includes(input.code))throw new ApiError(409,'REFERENCE_EXISTS','This base unit already exists');
  if(await tx.catalogueReference.findFirst({where:{businessId,kind:input.kind,name:input.name}}))throw new ApiError(409,'REFERENCE_EXISTS','Name already exists');
  if(await tx.catalogueReference.count({where:{businessId}})>=500)throw new ApiError(409,'REFERENCE_LIMIT','Maximum 500 definitions');
  const row=await tx.catalogueReference.create({data:{businessId,...input}});
  await tx.authAudit.create({data:{userId:ctx.user.id,businessId,action:'catalogue.reference_created',targetId:row.id}});return row;
 });}catch(e){if((e as {code?:string}).code==='P2002')throw new ApiError(409,'REFERENCE_EXISTS','Code already exists');throw e;}}
 async state(ctx:AuthContext,businessId:string,id:string,revision:number,active:boolean){return this.auth.transaction(async tx=>{
  await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.manage');
  if(!active)await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.delete');
  if(active&&!(await billingState(tx,businessId)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','Active subscription required');
  const row=await tx.catalogueReference.findFirst({where:{id,businessId}});if(!row)throw new ApiError(404,'NOT_FOUND','Definition not found');
  const result=await tx.catalogueReference.updateMany({where:{id,businessId,revision},data:{active,revision:{increment:1}}});
  if(!result.count)throw new ApiError(409,'REVISION_CONFLICT','Reload before saving');
  await tx.authAudit.create({data:{userId:ctx.user.id,businessId,action:'catalogue.reference_status',targetId:id,changes:{active}}});return {ok:true};
 });}
}
