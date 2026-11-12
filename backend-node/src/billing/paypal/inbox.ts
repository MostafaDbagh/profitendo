import { randomUUID } from 'node:crypto';
import type { AuthService } from '../../auth/service.js';
import { decrypt, digest, encrypt } from '../../auth/crypto.js';
import { ApiError } from '../../errors.js';
import type { PayPalProvider, WebhookHeaders } from './client.js';
import { assertBinding, assertPlanTerms, minorUnits, webhookSchema, subscriptionId, dateTime } from './contracts.js';
import { z } from 'zod';
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function receiveWebhook(auth: AuthService, provider: PayPalProvider, headers: WebhookHeaders, body: unknown) {
  const parsed = webhookSchema.safeParse(body); if (!parsed.success) throw new ApiError(400,'INVALID_WEBHOOK','Invalid webhook envelope');
  await provider.verifyWebhook(headers,parsed.data);
  const payloadHash = digest(canonical(parsed.data)), id = randomUUID();
  try {
    await auth.db.billingWebhook.create({data:{id,scope:provider.scope,eventId:parsed.data.id,eventType:parsed.data.event_type,payloadHash,payload:encrypt(auth.settings.key,JSON.stringify(parsed.data),`billing-webhook:${id}`)}});
    return {received:true,duplicate:false};
  } catch (error) {
    if ((error as {code?:string}).code !== 'P2002') throw error;
    const row = await auth.db.billingWebhook.findUniqueOrThrow({where:{scope_eventId:{scope:provider.scope,eventId:parsed.data.id}}});
    if (row.payloadHash !== payloadHash) throw new ApiError(409,'WEBHOOK_EVENT_CONFLICT','Provider event requires review');
    return {received:true,duplicate:true};
  }
}
const lifecycle = new Set(['BILLING.SUBSCRIPTION.CREATED','BILLING.SUBSCRIPTION.ACTIVATED','BILLING.SUBSCRIPTION.UPDATED','BILLING.SUBSCRIPTION.SUSPENDED','BILLING.SUBSCRIPTION.CANCELLED','BILLING.SUBSCRIPTION.EXPIRED','BILLING.SUBSCRIPTION.PAYMENT.FAILED']);
const saleSchema = z.object({id:z.string().regex(/^[A-Z0-9-]{3,64}$/),billing_agreement_id:subscriptionId,state:z.literal('completed'),create_time:dateTime,amount:z.object({total:z.string(),currency:z.string().length(3)})});
const permanent = new Set(['PROVIDER_BINDING_MISMATCH','PROVIDER_PLAN_MISMATCH','PROVIDER_AMOUNT_INVALID','PAYMENT_REVIEW_REQUIRED','PROVIDER_EVENT_INVALID','PAYMENT_CONFLICT']);
export async function processWebhookBatch(auth: AuthService, provider: PayPalProvider, limit = 20) {
  let processed = 0, ignored = 0, retried = 0, review = 0;
  for (let i=0;i<Math.min(100,Math.max(0,limit));i++) {
    const leaseToken = randomUUID();
    const row = await auth.db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{id:string}[]>`SELECT id FROM billing_webhooks WHERE scope = ${provider.scope} AND ((status = 'PENDING' AND next_attempt_at <= now()) OR (status = 'PROCESSING' AND lease_until <= now())) ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows[0]) return null;
      return tx.billingWebhook.update({where:{id:rows[0].id},data:{status:'PROCESSING',attempts:{increment:1},leaseToken,leaseUntil:new Date(Date.now()+120000)}});
    });
    if (!row) break;
    try {
      const event = webhookSchema.parse(JSON.parse(decrypt(auth.settings.key,row.payload,`billing-webhook:${row.id}`)));
      if (digest(canonical(event)) !== row.payloadHash) throw new ApiError(409,'PROVIDER_EVENT_INVALID','Stored event integrity failure');
      const type = event.event_type;
      if (type === 'PAYMENT.SALE.REFUNDED' || type === 'PAYMENT.SALE.REVERSED') {
        const saleId=type==='PAYMENT.SALE.REVERSED'?event.resource.id:event.resource.sale_id;
        if(typeof saleId==='string'){
          const receipt=await auth.db.billingReceipt.findUnique({where:{scope_transactionId:{scope:provider.scope,transactionId:saleId}}});
          if(receipt)await auth.db.billingCheckout.update({where:{id:receipt.checkoutId},data:{accessHold:true,revision:{increment:1},reconciliationError:'PAYMENT_REVIEW_REQUIRED'}});
        }
        throw new ApiError(409,'PAYMENT_REVIEW_REQUIRED','Refund or reversal requires reconciliation');
      }
      const handled = lifecycle.has(type) || type === 'PAYMENT.SALE.COMPLETED';
      const rawId = lifecycle.has(type) ? event.resource.id : event.resource.billing_agreement_id;
      const id = handled ? subscriptionId.safeParse(rawId) : null;
      if (handled && !id?.success) throw new ApiError(400,'PROVIDER_EVENT_INVALID','Invalid subscription reference');
      const intent = id?.success ? await auth.db.billingCheckout.findUnique({where:{scope_providerSubscriptionId:{scope:provider.scope,providerSubscriptionId:id.data}},include:{plan:true}}) : null;
      if (handled && !intent) throw new ApiError(409,'CHECKOUT_NOT_LINKED','Checkout binding is not available yet');
      const snapshot = intent ? await provider.getSubscription(intent.providerSubscriptionId!) : null;
      if (intent && snapshot) { assertBinding(snapshot,intent); assertPlanTerms(await provider.getPlan(intent.providerPlanId),intent.plan,{allowInactive:true}); }
      const sale = type === 'PAYMENT.SALE.COMPLETED' ? saleSchema.safeParse(event.resource) : null;
      if (sale && !sale.success) throw new ApiError(400,'PROVIDER_EVENT_INVALID','Invalid sale resource');
      const amountMinor = sale?.success ? minorUnits(sale.data.amount.total) : null;
      if (sale?.success && (!amountMinor || amountMinor > 2147483647 || sale.data.amount.currency !== intent?.plan.currency)) throw new ApiError(409,'PROVIDER_AMOUNT_INVALID','Unexpected payment currency or amount');
      await auth.transaction(async tx => {
        const current = await tx.billingWebhook.findFirst({where:{id:row.id,status:'PROCESSING',leaseToken,leaseUntil:{gt:new Date()}}});
        if (!current) throw new ApiError(409,'WEBHOOK_LEASE_LOST','Webhook processing lease expired');
        if (intent && snapshot) {
          const updated = new Date(snapshot.status_update_time);
          const state = await tx.billingCheckout.findUniqueOrThrow({where:{id:intent.id}});
          if (state.revision !== intent.revision) throw new ApiError(409,'CHECKOUT_CHANGED','Retry with current provider state');
          if (!state.providerUpdatedAt || updated >= state.providerUpdatedAt) {
            if (state.providerUpdatedAt?.getTime() === updated.getTime() && state.providerStatus && state.providerStatus !== snapshot.status) throw new ApiError(409,'PROVIDER_EVENT_INVALID','Conflicting provider state');
            await tx.billingCheckout.update({where:{id:state.id},data:{nextBillingAt:snapshot.status==='ACTIVE'&&snapshot.billing_info?.next_billing_time?new Date(snapshot.billing_info.next_billing_time):null,providerStatus:snapshot.status,providerUpdatedAt:updated,revision:{increment:1}}});
          }
          if (sale?.success) {
            const existing = await tx.billingReceipt.findUnique({where:{scope_transactionId:{scope:provider.scope,transactionId:sale.data.id}}});
            if (existing && (existing.checkoutId !== intent.id || existing.amountMinor !== amountMinor || existing.currency !== sale.data.amount.currency || existing.paidAt.getTime() !== new Date(sale.data.create_time).getTime())) throw new ApiError(409,'PAYMENT_CONFLICT','Payment requires reconciliation');
            if (!existing) await tx.billingReceipt.create({data:{checkoutId:intent.id,scope:provider.scope,transactionId:sale.data.id,eventId:event.id,amountMinor:amountMinor!,currency:sale.data.amount.currency,paidAt:new Date(sale.data.create_time)}});
          }
        }
        const completed = await tx.billingWebhook.updateMany({where:{id:row.id,leaseToken,leaseUntil:{gt:new Date()}},data:{status:handled?'PROCESSED':'IGNORED',processedAt:new Date(),payload:'',leaseToken:null,leaseUntil:null,lastError:null}});
        if (!completed.count) throw new ApiError(409,'WEBHOOK_LEASE_LOST','Webhook processing lease expired');
      });
      if (handled) processed++; else ignored++;
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'PROCESSING_FAILED';
      const needsReview = permanent.has(code) || row.attempts >= 10;
      const result = await auth.db.billingWebhook.updateMany({where:{id:row.id,leaseToken},data:{status:needsReview?'REVIEW':'PENDING',lastError:code,nextAttemptAt:new Date(Date.now()+Math.min(3600,2**row.attempts*15)*1000),leaseToken:null,leaseUntil:null}});
      if (result.count) { if (needsReview) review++; else retried++; }
    }
  }
  return {processed,ignored,retried,review};
}
