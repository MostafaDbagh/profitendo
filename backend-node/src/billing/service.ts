import { checkoutConfiguration } from './paypal/launch.js';
import type { AuthContext, AuthService } from '../auth/service.js';
import { ApiError } from '../errors.js';
import { requireBusiness } from '../businesses/access.js';
import { requirePlatform } from '../platform/service.js';
import { billingState, lockCapacity, memberUsage } from './entitlements.js';
import { requireBillingOwner } from './access.js';
export type PlanInput = { code: string; name: string; nameAr: string; priceMinor: number | null; currency: string; interval: string; trialDays: number; maxMembers: number; maxWarehouses: number; maxShops: number };
export class BillingService {
  constructor(readonly auth: AuthService) {}
  async ownerBusinesses(ctx: AuthContext) {
    return this.auth.transaction(async tx => {
      const { user, session } = await this.auth.assertSession(tx, ctx);
      if (await this.auth.requiresMfa(tx, user) && !session.mfaVerified) throw new ApiError(403, 'MFA_REQUIRED', 'Complete MFA first');
      const rows = await tx.membership.findMany({ where: { userId: user.id, role: 'OWNER', disabledAt: null },
        select: { business: { select: { id: true, name: true, timezone: true, suspendedAt: true } } }, orderBy: { business: { name: 'asc' } } });
      return rows.map(({business}) => ({ id: business.id, name: business.name, timezone: business.timezone, suspended: !!business.suspendedAt }));
    });
  }
  async ownerStatus(ctx: AuthContext, businessId: string) {
    return this.auth.transaction(async tx => {
      await requireBillingOwner(this.auth, tx, ctx, businessId);
      const { subscription, active, status, paidUntil } = await billingState(tx, businessId);
      return { status, active, checkoutAvailable: checkoutConfiguration().enabled, paidUntil, subscription, usage: await memberUsage(tx, businessId),
        locationUsage: { maxWarehouses: await tx.location.count({where:{businessId,kind:'WAREHOUSE',archivedAt:null}}), maxShops: await tx.location.count({where:{businessId,kind:'SHOP',archivedAt:null}}) },
        plans: await tx.billingPlan.findMany({ where: { published: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }) };
    });
  }
  async startTrial(ctx: AuthContext, businessId: string, planId: string) {
    return this.auth.transaction(async tx => {
      await requireBusiness(this.auth, tx, ctx, businessId, 'billing.manage');
      await lockCapacity(tx, businessId);
      if (await tx.businessSubscription.findUnique({ where: { businessId } })) throw new ApiError(409, 'TRIAL_ALREADY_USED', 'This business has already started its trial');
      const plan = await tx.billingPlan.findUnique({ where: { id: planId } });
      if (!plan || !plan.published || plan.priceMinor !== null || plan.trialDays <= 0) throw new ApiError(409, 'PLAN_UNAVAILABLE', 'This plan is not available for trial');
      const start = new Date(), end = new Date(start.getTime() + plan.trialDays * 86400000);
      const subscription = await tx.businessSubscription.create({ data: { businessId, planId, trialStartedAt: start, trialEndsAt: end } });
      await tx.billingAudit.create({ data: { actorId: ctx.user.id, businessId, planId, action: 'trial.started', changes: { trialDays: plan.trialDays, endsAt: end.toISOString() } } });
      return { status: 'TRIAL', trialEndsAt: subscription.trialEndsAt };
    });
  }
  async plans(ctx: AuthContext, page: number) {
    return this.auth.transaction(async tx => { await requirePlatform(this.auth, tx, ctx); return { paidCheckoutConfigured:checkoutConfiguration().enabled, page, pageSize: 25, total: await tx.billingPlan.count(), items: await tx.billingPlan.findMany({ take: 25, skip: (page - 1) * 25, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) }; });
  }
  async createPlan(ctx: AuthContext, input: PlanInput) {
    try { return await this.auth.transaction(async tx => {
      await requirePlatform(this.auth, tx, ctx);
      if (await tx.billingPlan.findUnique({ where: { code: input.code } })) throw new ApiError(409, 'PLAN_CODE_EXISTS', 'Choose a unique plan code');
      const plan = await tx.billingPlan.create({ data: input });
      await tx.billingAudit.create({ data: { actorId: ctx.user.id, planId: plan.id, action: 'plan.created', changes: { ...input } } });
      return plan;
    }); } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ApiError(409, 'PLAN_CODE_EXISTS', 'Choose a unique plan code');
      throw error;
    }
  }
  async publishPlan(ctx: AuthContext, id: string, revision: number, published: boolean) {
    return this.auth.transaction(async tx => {
      await requirePlatform(this.auth, tx, ctx);
      const plan = await tx.billingPlan.findUnique({ where: { id } });
      if (!plan) throw new ApiError(404, 'NOT_FOUND', 'Plan not found');
      if (plan.revision !== revision) throw new ApiError(409, 'REVISION_CONFLICT', 'Reload before saving');
      // Paid offers remain drafts until provider integration and commercial terms are ready.
      if (published && plan.priceMinor !== null && (!checkoutConfiguration().enabled||!checkoutConfiguration().bindings[plan.code])) throw new ApiError(409, 'PAID_CHECKOUT_UNAVAILABLE', 'Paid plans cannot be published before payment setup');
      if (published && plan.trialDays === 0 && plan.priceMinor === null) throw new ApiError(409, 'PLAN_UNAVAILABLE', 'A trial offer needs a trial duration');
      if (plan.published === published) return plan;
      const updated = await tx.billingPlan.updateMany({ where: { id, revision }, data: { published, revision: { increment: 1 } } });
      if (!updated.count) throw new ApiError(409, 'REVISION_CONFLICT', 'Reload before saving');
      await tx.billingAudit.create({ data: { actorId: ctx.user.id, planId: id, action: published ? 'plan.published' : 'plan.unpublished', changes: { before: plan.published, after: published } } });
      return tx.billingPlan.findUniqueOrThrow({ where: { id } });
    });
  }
  async audit(ctx: AuthContext, page: number) {
    return this.auth.transaction(async tx => {
      await requirePlatform(this.auth, tx, ctx);
      const items = await tx.billingAudit.findMany({ skip: (page - 1) * 25, take: 25, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      const people = await tx.authUser.findMany({ where: { id: { in: items.map(row => row.actorId) } }, select: { id: true, name: true } });
      const plans = await tx.billingPlan.findMany({ where: { id: { in: items.map(row => row.planId) } }, select: { id: true, name: true, nameAr: true } });
      return { page, pageSize: 25, total: await tx.billingAudit.count(), items: items.map(row => ({ ...row, actorName: people.find(p => p.id === row.actorId)?.name ?? null, planName: plans.find(p => p.id === row.planId)?.name ?? null, planNameAr: plans.find(p => p.id === row.planId)?.nameAr ?? null })) };
    });
  }
}
