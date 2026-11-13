import {decrypt} from '../auth/crypto.js';
import { MOCK_SCOPE,stagingTarget } from '../staging/guard.js';
import { Router } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { requirePlatform } from './service.js';
import { billingState } from '../billing/entitlements.js';
import {activateProviderPayment,activateManualPayment,manualPaymentSchema} from '../billing/manual.js';
import { ApiError,validateBody } from '../errors.js';
export function platformBillingRouter(auth:AuthService,scope?:string){
 const mock=process.env.MOCK_DATA_ENABLED==='true';if(mock){stagingTarget(process.env);scope=MOCK_SCOPE;}
 const router=Router(),{origin,attach,full,csrf,ctx}=authHttp(auth);
 router.use(origin,attach,full,(_q,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.get('/revenue',async(req,res)=>{
  const q=z.object({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).default(new Date().toISOString().slice(0,7)),page:z.coerce.number().int().min(1).max(10000).default(1)}).strict().safeParse(req.query);
  if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid month or page');const {month,page}=q.data;
  const start=new Date(month+'-01T00:00:00Z'),end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
  res.json(await auth.transaction(async tx=>{
   await requirePlatform(auth,tx,ctx(res));
   const where={scope:scope??'__unconfigured__',paidAt:{gte:start,lt:end}},manualWhere={paidAt:{gte:start,lt:end}};
   const groups=await tx.billingReceipt.groupBy({by:['currency'],where,_sum:{amountMinor:true},_count:true});
   const manualGroups=await tx.manualSubscriptionPayment.groupBy({by:['currency'],where:manualWhere,_sum:{amountMinor:true},_count:true});
   const totals=new Map<string,{currency:string;amountMinor:number;count:number}>();
   for(const t of [...groups,...manualGroups]){const previous=totals.get(t.currency);totals.set(t.currency,{currency:t.currency,amountMinor:(previous?.amountMinor??0)+(t._sum.amountMinor??0),count:(previous?.count??0)+t._count});}
   const receipts=await tx.billingReceipt.findMany({where,take:page*25,orderBy:[{paidAt:'desc'},{id:'desc'}],include:{checkout:{select:{business:{select:{name:true}},plan:{select:{name:true,nameAr:true}}}}}});
   const manual=await tx.manualSubscriptionPayment.findMany({where:manualWhere,take:page*25,orderBy:[{paidAt:'desc'},{id:'desc'}],include:{business:{select:{name:true}},plan:{select:{name:true,nameAr:true}}}});
   const items=[...receipts.map(r=>({id:r.id,paidAt:r.paidAt,amountMinor:r.amountMinor,currency:r.currency,businessName:r.checkout.business.name,plan:r.checkout.plan,reference:r.transactionId})),...manual.map(r=>({id:r.id,paidAt:r.paidAt,amountMinor:r.amountMinor,currency:r.currency,businessName:r.business.name,plan:r.plan,reference:r.reference}))].sort((a,b)=>b.paidAt.getTime()-a.paidAt.getTime()||b.id.localeCompare(a.id)).slice((page-1)*25,page*25);
   return {configured:!!scope||manual.length>0,mode:mock?'mock':scope?(process.env.B2B_PAYPAL_MODE==='live'?'live':'sandbox'):'manual',month,page,pageSize:25,total:await tx.billingReceipt.count({where})+await tx.manualSubscriptionPayment.count({where:manualWhere}),totals:[...totals.values()],items};
  }));
 });
 router.post('/subscribers/:businessId/activate',csrf,validateBody(z.object({revision:z.number().int().nonnegative(),transactionId:z.string().min(1).max(200),confirmed:z.literal(true)}).strict()),async(req,res)=>{const id=String(req.params.businessId);if(!z.uuid().safeParse(id).success)throw new ApiError(400,'INVALID_ID','Invalid business');res.json(await activateProviderPayment(auth,ctx(res),id,req.body));});
 router.get('/activation-plans',async(_req,res)=>res.json(await auth.transaction(async tx=>{await requirePlatform(auth,tx,ctx(res));return tx.billingPlan.findMany({where:{published:true,priceMinor:{not:null}},orderBy:{createdAt:'asc'}});})));
 router.post('/subscribers/:businessId/payments',csrf,validateBody(manualPaymentSchema),async(req,res)=>{const id=String(req.params.businessId);if(!z.uuid().safeParse(id).success)throw new ApiError(400,'INVALID_ID','Invalid business');res.status(201).json(await activateManualPayment(auth,ctx(res),id,req.body));});
 router.get('/subscribers',async(req,res)=>{
  const q=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),q:z.string().trim().max(100).default('')}).strict().safeParse(req.query);if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid query');
  res.json(await auth.transaction(async tx=>{await requirePlatform(auth,tx,ctx(res));const match={contains:q.data.q,mode:'insensitive' as const};const where=q.data.q?{OR:[{name:match},{memberships:{some:{role:'OWNER' as const,user:{OR:[{name:match},{email:match}]}}}}]}:{};const now=new Date();
   const rows=await tx.business.findMany({where,take:25,skip:(q.data.page-1)*25,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,name:true,suspendedAt:true,createdAt:true}});
   const items=[];for(const b of rows){
    const s=await billingState(tx,b.id,now),checkout=await tx.billingCheckout.findUnique({where:{businessId:b.id},include:{plan:true}});
    const owners=await tx.membership.findMany({where:{businessId:b.id,role:'OWNER'},orderBy:{userId:'asc'},select:{disabledAt:true,user:{select:{id:true,name:true,email:true,phone:true,pendingPhone:true,phoneVerifiedAt:true,createdAt:true,disabledAt:true}}}});
    const trial=await tx.businessSubscription.findUnique({where:{businessId:b.id},select:{trialStartedAt:true,trialEndsAt:true}});
    const manual=await tx.manualSubscriptionPayment.findFirst({where:{businessId:b.id},orderBy:{paidAt:'desc'}});
    const receipt=checkout?await tx.billingReceipt.findFirst({where:{checkoutId:checkout.id,scope:checkout.scope},orderBy:[{paidAt:'desc'},{id:'desc'}]}):null;const last=manual&&(!receipt||manual.paidAt>receipt.paidAt)?manual:receipt;
    const paymentStatus=checkout?.accessHold||checkout?.reconciliationError?'PAYMENT_REVIEW':last?'PAYMENT_RECEIVED':checkout?'AWAITING_PAYMENT':'NO_PAYMENTS';
    items.push({...b,hasProviderCheckout:!!checkout,activation:checkout?.paidTransaction&&checkout.activatedTransaction!==checkout.paidTransaction&&checkout.paidUntil&&checkout.paidUntil>now&&!checkout.accessHold?{revision:checkout.revision,transactionId:checkout.paidTransaction,paidUntil:checkout.paidUntil}:null,status:s.status,owners:owners.map(({user,disabledAt})=>({id:user.id,name:user.name,email:user.email,phone:user.phone??(user.pendingPhone?decrypt(auth.settings.key,user.pendingPhone,'registration-phone'):null),phoneVerified:!!user.phoneVerifiedAt,registeredAt:user.createdAt,disabled:!!(disabledAt||user.disabledAt)})),trialStartedAt:trial?.trialStartedAt??null,trialEndsAt:trial?.trialEndsAt??null,trialDaysRemaining:s.status==='TRIAL'&&trial?Math.max(0,Math.ceil((trial.trialEndsAt.getTime()-now.getTime())/86400000)):null,plan:s.subscription?.plan??checkout?.plan??null,endsAt:s.paidUntil??s.subscription?.trialEndsAt??null,
     renewalAt:checkout?.providerStatus==='ACTIVE'&&!checkout.accessHold?checkout.nextBillingAt:null,providerStatus:checkout?.providerStatus??null,paymentStatus,
     lastPayment:last?{amountMinor:last.amountMinor,currency:last.currency,paidAt:last.paidAt}:null});
   }
   return {asOf:now,page:q.data.page,pageSize:25,total:await tx.business.count({where}),items};
  }));
 });return router;
}
