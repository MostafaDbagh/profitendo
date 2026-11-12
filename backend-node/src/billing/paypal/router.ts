import { CheckoutService } from './checkout.js';
import { checkoutConfiguration } from './launch.js';
import { reconcileCheckout } from './reconciliation.js';
import { Router } from 'express';
import { z } from 'zod';
import type { AuthService } from '../../auth/service.js';
import { authHttp } from '../../auth/http.js';
import { ApiError, validateBody } from '../../errors.js';
import { requirePlatform } from '../../platform/service.js';
import { requireBillingOwner } from '../access.js';
import { CancellationService } from './cancellation.js';
import type { PayPalProvider, WebhookHeaders } from './client.js';
import { receiveWebhook } from './inbox.js';
const paging = z.object({page:z.coerce.number().int().min(1).max(10000).default(1)}).strict();
export function paypalRouter(auth: AuthService, provider?: PayPalProvider) {
  const router = Router(), { ctx, origin, attach, full, csrf } = authHttp(auth);
  const cancellation = new CancellationService(auth, provider);
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  // Provider delivery is authenticated by signature, never by a customer cookie.
  router.post('/paypal/webhook',async(req,res)=>{
    if(!provider) throw new ApiError(503,'PAYPAL_NOT_CONFIGURED','B2B payment provider is not configured');
    if(!req.is('application/json')) throw new ApiError(415,'JSON_REQUIRED','Use application/json');
    const headers: WebhookHeaders = Object.fromEntries(['paypal-auth-algo','paypal-cert-url','paypal-transmission-id','paypal-transmission-sig','paypal-transmission-time'].map(k=>[k,req.get(k)]));
    res.status(202).json(await receiveWebhook(auth,provider,headers,req.body));
  });
  const signedRead = [origin,attach,full], signedWrite = [origin,attach,full,csrf];
  for(const key of ['businessId','eventId','cancellationId']) router.param(key,(_req,_res,next,id)=>{if(!z.string().uuid().safeParse(id).success)return next(new ApiError(400,'INVALID_ID','Invalid identifier'));next();});
  const pageOf=(query:unknown)=>{const result=paging.safeParse(query);if(!result.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid pagination');return result.data.page;};
  router.post('/businesses/:businessId/checkout',...signedWrite,validateBody(z.object({planId:z.string().uuid(),confirm:z.literal(true)}).strict()),async(req,res)=>{
    const config=checkoutConfiguration(),businessId=String(req.params.businessId);
    if(!provider||!config.enabled)throw new ApiError(409,'PAID_CHECKOUT_UNAVAILABLE','Paid checkout is not enabled');
    const plan=await auth.transaction(async tx=>{
      await requireBillingOwner(auth,tx,ctx(res),businessId);
      const plan=await tx.billingPlan.findUnique({where:{id:req.body.planId}});
      if(!plan?.published||!plan.priceMinor||!config.bindings[plan.code])throw new ApiError(409,'PLAN_UNAVAILABLE','Plan unavailable');return plan;
    });
    const result=await new CheckoutService(auth,provider).create(ctx(res),businessId,plan.id,config.bindings[plan.code]!);
    const approve=result.snapshot.links?.find(l=>l.rel==='approve')?.href;
    if(approve){const url=new URL(approve);if(url.protocol!=='https:'||url.username||url.password||!['www.paypal.com','www.sandbox.paypal.com'].includes(url.hostname))throw new ApiError(502,'INVALID_APPROVAL_URL','Invalid provider approval link');}
    res.json({approvalUrl:approve??null,status:result.snapshot.status});
  });
  router.post('/businesses/:businessId/reconcile',...signedWrite,validateBody(z.object({}).strict()),async(req,res)=>{
    if(!provider)throw new ApiError(503,'PAYPAL_NOT_CONFIGURED','Provider is not configured');
    const intent=await auth.transaction(async tx=>{await requireBillingOwner(auth,tx,ctx(res),String(req.params.businessId));return tx.billingCheckout.findUnique({where:{businessId:String(req.params.businessId)}});});
    if(!intent)throw new ApiError(404,'NOT_FOUND','No checkout exists');
    // Scheduled reconciliation handles retries; bound manual refreshes per business.
    if(intent.reconciledAt&&Date.now()-intent.reconciledAt.getTime()<60000)throw new ApiError(429,'RECONCILE_TOO_SOON','Try again in a minute');
    res.json(await reconcileCheckout(auth,provider,intent.id));
  });
  router.get('/businesses/:businessId/payments',...signedRead,async(req,res)=>{
    const businessId=String(req.params.businessId),page=pageOf(req.query);
    res.json(await auth.transaction(async tx=>{
      await requireBillingOwner(auth,tx,ctx(res),businessId);
      const where={checkout:{businessId}};
      const items=await tx.billingReceipt.findMany({where,skip:(page-1)*25,take:25,orderBy:[{paidAt:'desc'},{id:'desc'}],select:{id:true,amountMinor:true,currency:true,paidAt:true,transactionId:true}});
      return {page,pageSize:25,total:await tx.billingReceipt.count({where}),items:items.map(({transactionId,...row})=>({...row,reference:transactionId.length > 8 ? `${transactionId.slice(0,3)}…${transactionId.slice(-3)}` : '•••'}))};
    }));
  });
  router.get('/businesses/:businessId/cancellation', ...signedRead, async(req,res)=>{
    res.json(await cancellation.status(ctx(res), String(req.params.businessId)));
  });
  router.post('/businesses/:businessId/cancellation', ...signedWrite, validateBody(z.object({confirm:z.literal(true)}).strict()), async(req,res)=>{
    res.status(202).json(await cancellation.request(ctx(res), String(req.params.businessId)));
  });
  router.get('/cancellations', ...signedRead, async(req,res)=>{
    const page=pageOf(req.query);
    res.json(await auth.transaction(async tx=>{
      await requirePlatform(auth,tx,ctx(res));
      return {page,pageSize:25,total:await tx.billingCancellation.count(),items:await tx.billingCancellation.findMany({skip:(page-1)*25,take:25,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,status:true,attempts:true,lastError:true,createdAt:true,confirmedAt:true,nextAttemptAt:true}})};
    }));
  });
  router.post('/cancellations/:cancellationId/retry', ...signedWrite, validateBody(z.object({}).strict()), async(req,res)=>{
    res.json(await cancellation.retry(ctx(res), String(req.params.cancellationId)));
  });
  router.get('/provider-events',...signedRead,async(req,res)=>{
    const page=pageOf(req.query);
    res.json(await auth.transaction(async tx=>{
      await requirePlatform(auth,tx,ctx(res));
      return {page,pageSize:25,total:await tx.billingWebhook.count(),providerConfigured:!!provider,items:await tx.billingWebhook.findMany({skip:(page-1)*25,take:25,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,eventId:true,eventType:true,status:true,attempts:true,lastError:true,createdAt:true,processedAt:true,nextAttemptAt:true}})};
    }));
  });
  router.post('/provider-events/:eventId/retry',...signedWrite,validateBody(z.object({}).strict()),async(req,res)=>{
    const id=String(req.params.eventId);
    await auth.transaction(async tx=>{
      await requirePlatform(auth,tx,ctx(res));
      if(!provider)throw new ApiError(503,'PAYPAL_NOT_CONFIGURED','B2B payment provider is not configured');
      const row=await tx.billingWebhook.findUnique({where:{id}});
      if(!row)throw new ApiError(404,'NOT_FOUND','Event not found');
      if(row.scope!==provider.scope || row.status!=='REVIEW' || !row.payload)throw new ApiError(409,'EVENT_NOT_RETRYABLE','Event cannot be retried with this provider configuration');
      const changed=await tx.billingWebhook.updateMany({where:{id,status:'REVIEW',attempts:row.attempts},data:{status:'PENDING',attempts:0,nextAttemptAt:new Date(),lastError:null,leaseToken:null,leaseUntil:null}});
      if(!changed.count)throw new ApiError(409,'REVISION_CONFLICT','Event changed');
      await tx.authAudit.create({data:{userId:ctx(res).user.id,action:'billing.webhook.retry',targetId:id}});
    });
    res.json({ok:true});
  });
  return router;
}
