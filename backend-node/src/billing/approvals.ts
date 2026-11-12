import { Router } from 'express';
import { z } from 'zod';
import type { AuthService, Tx } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { requireBusiness } from '../businesses/access.js';
import { requireBillingOwner } from './access.js';
import { requirePlatform } from '../platform/service.js';
import { ApiError, validateBody } from '../errors.js';
export async function requirePaidApproval(tx:Tx,businessId:string,planId:string){
 const row=await tx.paidApproval.findUnique({where:{businessId_planId:{businessId,planId}}});
 if(row?.status!=='APPROVED')throw new ApiError(403,'PAID_APPROVAL_REQUIRED','Request administrator approval before paid checkout');
}
const paging=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),status:z.enum(['ALL','PENDING','APPROVED','REJECTED']).default('ALL')}).strict();
export function approvalRouter(auth:AuthService){
 const router=Router(),{origin,attach,full,csrf,ctx}=authHttp(auth);
 router.use(origin,attach,full);router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(req.method==='GET')next();else csrf(req,res,next);});
 for(const k of ['businessId','id'])router.param(k,(_q,_s,next,id)=>{if(!z.uuid().safeParse(id).success)return next(new ApiError(400,'INVALID_ID','Invalid ID'));next();});
 router.get('/businesses/:businessId/approvals',async(req,res)=>res.json(await auth.transaction(async tx=>{
  const businessId=String(req.params.businessId);await requireBillingOwner(auth,tx,ctx(res),businessId);
  return tx.paidApproval.findMany({where:{businessId},include:{plan:true},orderBy:{createdAt:'desc'}});
 })));
 router.post('/businesses/:businessId/approvals',validateBody(z.object({planId:z.uuid()}).strict()),async(req,res)=>{
  const businessId=String(req.params.businessId);await auth.limit('paid-requests',ctx(res).user.id,10,3600);
  res.status(201).json(await auth.transaction(async tx=>{
   await requireBusiness(auth,tx,ctx(res),businessId,'billing.manage');
   const plan=await tx.billingPlan.findUnique({where:{id:req.body.planId}});
   if(!plan?.published||!plan.priceMinor)throw new ApiError(409,'PLAN_UNAVAILABLE','Choose a published paid plan');
   const where={businessId_planId:{businessId,planId:plan.id}},existing=await tx.paidApproval.findUnique({where});
   if(existing&&existing.status!=='REJECTED')return existing;
   const row=await tx.paidApproval.upsert({where,create:{businessId,planId:plan.id,requestedBy:ctx(res).user.id},update:{status:'PENDING',reason:'',decidedAt:null,decidedBy:null,requestedBy:ctx(res).user.id,revision:{increment:1}}});
   await tx.billingAudit.create({data:{actorId:ctx(res).user.id,businessId,planId:plan.id,action:'approval.requested',changes:{approvalId:row.id}}});return row;
  }));
 });
 router.get('/approvals',async(req,res)=>{
  const p=paging.safeParse(req.query);if(!p.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid query');const {page,status}=p.data;
  res.json(await auth.transaction(async tx=>{await requirePlatform(auth,tx,ctx(res));const where=status==='ALL'?{}:{status};
   const rows=await tx.paidApproval.findMany({where,skip:(page-1)*25,take:25,orderBy:[{createdAt:'desc'},{id:'desc'}]});
   const businesses=await tx.business.findMany({where:{id:{in:rows.map(r=>r.businessId)}},select:{id:true,name:true}}),plans=await tx.billingPlan.findMany({where:{id:{in:rows.map(r=>r.planId)}}});
   return {page,pageSize:25,total:await tx.paidApproval.count({where}),items:rows.map(r=>({...r,businessName:businesses.find(b=>b.id===r.businessId)?.name,plan:plans.find(p=>p.id===r.planId)}))};
  }));
 });
 router.patch('/approvals/:id',validateBody(z.object({revision:z.number().int().nonnegative(),status:z.enum(['APPROVED','REJECTED']),reason:z.string().trim().min(5).max(500)}).strict()),async(req,res)=>res.json(await auth.transaction(async tx=>{
  await requirePlatform(auth,tx,ctx(res));const row=await tx.paidApproval.findUnique({where:{id:String(req.params.id)}});
  if(!row)throw new ApiError(404,'NOT_FOUND','Request not found');
  if(row.status!=='PENDING'||row.revision!==req.body.revision)throw new ApiError(409,'REVISION_CONFLICT','Request changed; reload');
  const updated=await tx.paidApproval.updateMany({where:{id:row.id,status:'PENDING',revision:row.revision},data:{status:req.body.status,reason:req.body.reason,decidedBy:ctx(res).user.id,decidedAt:new Date(),revision:{increment:1}}});
  if(!updated.count)throw new ApiError(409,'REVISION_CONFLICT','Request changed; reload');
  await tx.billingAudit.create({data:{actorId:ctx(res).user.id,businessId:row.businessId,planId:row.planId,action:'approval.'+req.body.status.toLowerCase(),changes:{reason:req.body.reason,approvalId:row.id}}});return {ok:true};
 })));
 return router;
}
