import { MOCK_SCOPE,stagingTarget } from '../staging/guard.js';
import { Router } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { requirePlatform } from './service.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
export function platformBillingRouter(auth:AuthService,scope?:string){
 const mock=process.env.MOCK_DATA_ENABLED==='true';if(mock){stagingTarget(process.env);scope=MOCK_SCOPE;}
 const router=Router(),{origin,attach,full,ctx}=authHttp(auth);
 router.use(origin,attach,full,(_q,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.get('/revenue',async(req,res)=>{
  const q=z.object({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).default(new Date().toISOString().slice(0,7)),page:z.coerce.number().int().min(1).max(10000).default(1)}).strict().safeParse(req.query);
  if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid month or page');const {month,page}=q.data;
  const start=new Date(month+'-01T00:00:00Z'),end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
  res.json(await auth.transaction(async tx=>{
   await requirePlatform(auth,tx,ctx(res));if(!scope)return {configured:false,month,page,pageSize:25,total:0,totals:[],items:[]};
   const where={scope,paidAt:{gte:start,lt:end}},totals=await tx.billingReceipt.groupBy({by:['currency'],where,_sum:{amountMinor:true},_count:true});
   const rows=await tx.billingReceipt.findMany({where,skip:(page-1)*25,take:25,orderBy:[{paidAt:'desc'},{id:'desc'}],include:{checkout:{select:{business:{select:{name:true}},plan:{select:{name:true,nameAr:true}}}}}});
   return {configured:true,mode:mock?'mock':process.env.B2B_PAYPAL_MODE==='live'?'live':'sandbox',month,page,pageSize:25,total:await tx.billingReceipt.count({where}),totals:totals.map(t=>({currency:t.currency,amountMinor:t._sum.amountMinor,count:t._count})),items:rows.map(r=>({id:r.id,paidAt:r.paidAt,amountMinor:r.amountMinor,currency:r.currency,businessName:r.checkout.business.name,plan:r.checkout.plan,reference:r.transactionId}))};
  }));
 });
 router.get('/subscribers',async(req,res)=>{
  const q=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),q:z.string().trim().max(100).default('')}).strict().safeParse(req.query);if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid query');
  res.json(await auth.transaction(async tx=>{await requirePlatform(auth,tx,ctx(res));const where=q.data.q?{name:{contains:q.data.q,mode:'insensitive' as const}}:{};
   const rows=await tx.business.findMany({where,take:25,skip:(q.data.page-1)*25,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,name:true,suspendedAt:true}});
   const items=[];for(const b of rows){
    const s=await billingState(tx,b.id),checkout=await tx.billingCheckout.findUnique({where:{businessId:b.id},include:{plan:true,receipts:{orderBy:[{paidAt:'desc'},{id:'desc'}],take:1}}});
    const owners=await tx.membership.findMany({where:{businessId:b.id,role:'OWNER',disabledAt:null},select:{user:{select:{name:true,email:true}}}});
    const last=checkout?.receipts[0];
    const paymentStatus=checkout?.accessHold||checkout?.reconciliationError?'PAYMENT_REVIEW':last?'PAYMENT_RECEIVED':checkout?'AWAITING_PAYMENT':'NO_PAYMENTS';
    items.push({...b,status:s.status,owners:owners.map(m=>m.user),plan:s.subscription?.plan??checkout?.plan??null,endsAt:s.paidUntil??s.subscription?.trialEndsAt??null,
     renewalAt:checkout?.providerStatus==='ACTIVE'&&!checkout.accessHold?checkout.nextBillingAt:null,providerStatus:checkout?.providerStatus??null,paymentStatus,
     lastPayment:last?{amountMinor:last.amountMinor,currency:last.currency,paidAt:last.paidAt}:null});
   }
   return {page:q.data.page,pageSize:25,total:await tx.business.count({where}),items};
  }));
 });return router;
}
