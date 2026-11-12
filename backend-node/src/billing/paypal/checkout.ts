import { requirePaidApproval } from '../approvals.js';
import { randomUUID } from 'node:crypto';
import type { AuthContext, AuthService } from '../../auth/service.js';
import { ApiError } from '../../errors.js';
import { requireBusiness } from '../../businesses/access.js';
import { assertBinding, assertPlanTerms, providerPlanId as providerPlanSchema } from './contracts.js';
import type { PayPalProvider } from './client.js';
// Internal workflow only: no public checkout endpoint is mounted yet. Binding a
// merchant plan must be configured server-side, never accepted from a browser.
export class CheckoutService {
  constructor(readonly auth: AuthService, readonly provider: PayPalProvider) {}
  async create(ctx: AuthContext, businessId: string, planId: string, providerPlanId: string) {
    providerPlanSchema.parse(providerPlanId);
    const local = await this.auth.transaction(async tx => {
      await requireBusiness(this.auth,tx,ctx,businessId,'billing.manage');
      await requirePaidApproval(tx,businessId,planId);
      const plan = await tx.billingPlan.findUnique({where:{id:planId}});
      if (!plan?.priceMinor) throw new ApiError(409,'PLAN_UNAVAILABLE','A priced plan is required');
      return plan;
    });
    assertPlanTerms(await this.provider.getPlan(providerPlanId),local);
    const intent = await this.auth.transaction(async tx => {
      await requireBusiness(this.auth,tx,ctx,businessId,'billing.manage');
      await requirePaidApproval(tx,businessId,planId);
      const existing = await tx.billingCheckout.findUnique({where:{businessId}});
      if (existing) {
        if (existing.scope !== this.provider.scope || existing.planId !== planId || existing.providerPlanId !== providerPlanId) throw new ApiError(409,'CHECKOUT_EXISTS','Reconcile the existing checkout before replacing it');
        return existing;
      }
      return tx.billingCheckout.create({data:{businessId,planId,scope:this.provider.scope,providerPlanId}});
    }).catch(error => {
      if ((error as { code?: string }).code === 'P2002') throw new ApiError(409,'CHECKOUT_BUSY','Retry the existing checkout');
      throw error;
    });
    if (intent.providerSubscriptionId) {
      const snapshot = await this.provider.getSubscription(intent.providerSubscriptionId); assertBinding(snapshot,intent);
      await this.auth.transaction(tx=>requireBusiness(this.auth,tx,ctx,businessId,'billing.manage'));
      return {intentId:intent.id,snapshot};
    }
    const leaseToken = randomUUID(), now = new Date();
    const claimed = await this.auth.transaction(async tx => {
      await requireBusiness(this.auth,tx,ctx,businessId,'billing.manage');
      await requirePaidApproval(tx,businessId,planId);
      const row = await tx.billingCheckout.findUniqueOrThrow({where:{id:intent.id}});
      if (row.providerSubscriptionId) throw new ApiError(409,'CHECKOUT_BUSY','Retry checkout status');
      // PayPal retains subscription creation request IDs for 72h. Leave margin;
      // never start a new request ID automatically after an ambiguous timeout.
      if (row.firstRequestedAt && Date.now()-row.firstRequestedAt.getTime() >= 70*3600000) throw new ApiError(409,'CHECKOUT_REVIEW_REQUIRED','Checkout requires reconciliation');
      const result = await tx.billingCheckout.updateMany({where:{id:row.id,OR:[{leaseUntil:null},{leaseUntil:{lte:now}}]},data:{leaseToken,leaseUntil:new Date(Date.now()+120000),firstRequestedAt:row.firstRequestedAt ?? now}});
      if (!result.count) throw new ApiError(409,'CHECKOUT_BUSY','Checkout is being created');
      return row;
    });
    try {
      const snapshot = await this.provider.createSubscription(providerPlanId,claimed.id,this.auth.settings.appOrigin); assertBinding(snapshot,claimed);
      // Persist provider binding even if customer access changed during the call:
      // losing the binding would permit duplicate billing on a later retry.
      await this.auth.transaction(async tx => {
        const updated = await tx.billingCheckout.updateMany({where:{id:claimed.id,leaseToken},data:{providerSubscriptionId:snapshot.id,providerStatus:snapshot.status,providerUpdatedAt:new Date(snapshot.status_update_time),revision:{increment:1},leaseToken:null,leaseUntil:null}});
        if (!updated.count) throw new ApiError(409,'CHECKOUT_BUSY','Checkout reconciliation required');
        await tx.billingAudit.create({data:{actorId:ctx.user.id,businessId,planId,action:'checkout.created',changes:{checkoutId:claimed.id}}});
      });
      await this.auth.transaction(tx=>requireBusiness(this.auth,tx,ctx,businessId,'billing.manage'));
      return {intentId:claimed.id,snapshot};
    } finally {
      await this.auth.db.billingCheckout.updateMany({where:{id:claimed.id,leaseToken},data:{leaseToken:null,leaseUntil:null}});
    }
  }
}
