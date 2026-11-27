import {Router,type Request} from 'express';
import {z} from 'zod';
import type {AuthService} from '../auth/service.js';
import {authHttp} from '../auth/http.js';
import {ApiError,validateBody} from '../errors.js';
import {requireBusiness,requireOwnerPin} from '../businesses/access.js';
import {requireLocation} from '../locations/access.js';
import {billingState} from '../billing/entitlements.js';
import {postStock} from '../operations/inventory.js';
import {customerPhone,profile,programOf,programSchema} from './service.js';

export function loyaltyRouter(auth:AuthService){
 const r=Router({mergeParams:true}),{ctx}=authHttp(auth);
 const pageNumber=z.coerce.number().int().min(1).max(100000).default(1);
 const phone=z.string().trim().min(1).max(40);
 r.get('/customers',async(req,res)=>{
  const bid=String((req as Request).params.businessId),q=String(req.query.search??'').trim().slice(0,150);
  const page=pageNumber.safeParse(req.query.page);
  if(!page.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid page');
  res.json(await auth.transaction(async tx=>{
   const {business}=await requireBusiness(auth,tx,ctx(res),bid,'customers.view');
   const canonical=customerPhone(q,business.countryCode);
   const where={businessId:bid,...(q?{OR:[{name:{contains:q,mode:'insensitive' as const}},{phone:{contains:canonical??q}}]}:{})};
   return {items:await tx.customer.findMany({where,orderBy:[{name:'asc'},{id:'asc'}],take:25,skip:(page.data-1)*25}),page:page.data,pageSize:25,total:await tx.customer.count({where})};
  }));
 });
 r.get('/customers/:customerId',async(req,res)=>{
  const bid=String((req as Request).params.businessId),id=String(req.params.customerId);
  const page=pageNumber.safeParse(req.query.page);
  if(!page.success||!z.uuid().safeParse(id).success)throw new ApiError(422,'VALIDATION_ERROR','Invalid customer or page');
  res.json(await auth.transaction(async tx=>{
   const {business}=await requireBusiness(auth,tx,ctx(res),bid,'customers.view');
   return profile(tx,bid,id,business.timezone,programOf(business.loyaltyProgram),page.data);
  }));
 });
 for(const register of [false,true]){
  r.post(register?'/customers':'/customers/lookup',validateBody(register?z.object({phone,name:z.string().trim().min(1).max(150)}).strict():z.object({phone}).strict()),async(req,res)=>{
   const bid=String((req as Request).params.businessId);
   res.json(await auth.transaction(async tx=>{
    const {business,permissions}=await requireBusiness(auth,tx,ctx(res),bid,'sales.create');
    if(!permissions['customers.view'])throw new ApiError(403,'FORBIDDEN','Customer access required');
    const canonical=customerPhone(req.body.phone,business.countryCode);
    if(!canonical)throw new ApiError(422,'INVALID_PHONE','Invalid phone number');
    const where={businessId_phone:{businessId:bid,phone:canonical}};
    if(register&&!(await billingState(tx,bid)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','Subscription required');
    const row=register?await tx.customer.upsert({where,update:{phone:canonical},create:{businessId:bid,phone:canonical,name:req.body.name}}):await tx.customer.findUnique({where});
    return {customer:row?{id:row.id,name:row.name,phone:row.phone}:null};
   }));
  });
 }
 r.put('/program',validateBody(z.object({revision:z.number().int().nonnegative(),program:programSchema}).strict()),async(req,res)=>{
  const bid=String((req as Request).params.businessId),program=programSchema.parse(req.body.program);
  res.json(await auth.transaction(async tx=>{
   const access=await requireBusiness(auth,tx,ctx(res),bid,'business.edit');requireOwnerPin(access);
   if(!(await billingState(tx,bid)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','Subscription required');
   const ids=[...new Set(program.stages.flatMap(s=>s.productId?[s.productId]:[]))];
   if(await tx.product.count({where:{businessId:bid,active:true,id:{in:ids}}})!==ids.length)throw new ApiError(422,'PRODUCT_INACTIVE','Invalid gift product');
   const changed=await tx.business.updateMany({where:{id:bid,revision:req.body.revision},data:{loyaltyProgram:program,revision:{increment:1}}});
   if(!changed.count)throw new ApiError(409,'REVISION_CONFLICT','Reload settings');
   await tx.authAudit.create({data:{businessId:bid,userId:ctx(res).user.id,action:'loyalty.program_updated',targetId:bid,changes:{program}}});
   return {ok:true};
  }));
 });
 r.post('/rewards/:rewardId/redeem',validateBody(z.object({locationId:z.uuid()}).strict()),async(req,res)=>{
  const bid=String((req as Request).params.businessId),id=String(req.params.rewardId),locationId=req.body.locationId;
  if(!z.uuid().safeParse(id).success)throw new ApiError(422,'VALIDATION_ERROR','Invalid reward');
  res.json(await auth.transaction(async tx=>{
   const {user,permissions}=await requireLocation(auth,tx,ctx(res),bid,locationId,'loyalty.redeem');
   if(!permissions['customers.view'])throw new ApiError(403,'FORBIDDEN','Customer access required');
   if(!(await billingState(tx,bid)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','Subscription required');
   const reward=await tx.loyaltyReward.findFirst({where:{id,businessId:bid}});
   if(!reward)throw new ApiError(404,'NOT_FOUND','Reward not found');
   if(reward.redeemedAt)return {ok:true};
   if(!(await tx.loyaltyReward.updateMany({where:{id,businessId:bid,redeemedAt:null,voided:false},data:{redeemedAt:new Date(),redeemedBy:user.id}})).count)throw new ApiError(409,'REVISION_CONFLICT','Reward unavailable');
   if(reward.productId)await postStock(tx,{businessId:bid,locationId,productId:reward.productId,delta:'-1',type:'LOYALTY_GIFT',sourceId:id,sourceLineId:id,reference:reward.name.slice(0,40),actorId:user.id,notes:'Loyalty reward'});
   await tx.authAudit.create({data:{businessId:bid,userId:user.id,action:'loyalty.reward_redeemed',targetId:id,changes:{locationId}}});
   return {ok:true};
  }));
 });
 return r;
}
