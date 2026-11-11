import { randomUUID } from 'node:crypto';
import type { AuthContext, AuthService } from '../../auth/service.js';
import { ApiError } from '../../errors.js';
import { requireBillingOwner } from '../access.js';
import { requirePlatform } from '../../platform/service.js';
import { assertBinding } from './contracts.js';
import type { PayPalProvider } from './client.js';

const publicFields = { id: true, status: true, attempts: true, createdAt: true, confirmedAt: true } as const;
const terminal = new Set(['CANCELLED', 'EXPIRED']);
const permanent = new Set(['PROVIDER_BINDING_MISMATCH', 'CANCELLATION_STATE_REVIEW']);

export class CancellationService {
  constructor(readonly auth: AuthService, readonly provider?: PayPalProvider) {}

  async status(ctx: AuthContext, businessId: string) {
    return this.auth.transaction(async tx => {
      await requireBillingOwner(this.auth, tx, ctx, businessId);
      const checkout = await tx.billingCheckout.findUnique({ where: { businessId }, include: { cancellation: { select: publicFields } } });
      return { providerStatus: checkout?.providerStatus ?? null, cancellation: checkout?.cancellation ?? null,
        cancellationAvailable: !!this.provider && checkout?.scope === this.provider.scope && !!checkout?.providerSubscriptionId };
    });
  }

  async request(ctx: AuthContext, businessId: string) {
    return this.auth.transaction(async tx => {
      await requireBillingOwner(this.auth, tx, ctx, businessId);
      if (!this.provider) throw new ApiError(503, 'PAYPAL_NOT_CONFIGURED', 'B2B payment provider is not configured');
      // Lock the unique checkout to make repeated and concurrent requests idempotent.
      await tx.$queryRaw`SELECT id FROM billing_checkouts WHERE business_id = ${businessId}::uuid FOR UPDATE`;
      const checkout = await tx.billingCheckout.findUnique({ where: { businessId } });
      if (!checkout?.providerSubscriptionId || checkout.scope !== this.provider.scope) throw new ApiError(409, 'SUBSCRIPTION_NOT_LINKED', 'No linked subscription is available for cancellation');
      const existing = await tx.billingCancellation.findUnique({ where: { checkoutId: checkout.id }, select: publicFields });
      if (existing) return existing;
      const result = await tx.billingCancellation.create({ data: { checkoutId: checkout.id, actorId: ctx.user.id }, select: publicFields });
      await tx.billingAudit.create({ data: { actorId: ctx.user.id, businessId, planId: checkout.planId,
        action: 'cancellation.requested', changes: { cancellationId: result.id } } });
      return result;
    });
  }

  async retry(ctx: AuthContext, id: string) {
    return this.auth.transaction(async tx => {
      await requirePlatform(this.auth, tx, ctx);
      if (!this.provider) throw new ApiError(503, 'PAYPAL_NOT_CONFIGURED', 'B2B payment provider is not configured');
      const row = await tx.billingCancellation.findUnique({ where: { id }, include: { checkout: true } });
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Cancellation not found');
      if (row.status !== 'REVIEW' || row.checkout.scope !== this.provider.scope) throw new ApiError(409, 'CANCELLATION_NOT_RETRYABLE', 'Cancellation cannot be retried');
      await tx.billingCancellation.update({ where: { id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null } });
      await tx.billingAudit.create({ data: { actorId: ctx.user.id, businessId: row.checkout.businessId, planId: row.checkout.planId,
        action: 'cancellation.retried', changes: { cancellationId: id } } });
      return { ok: true };
    });
  }
}

// Provider calls stay outside transactions. A request already authorized by its
// owner remains valid if their session expires or the business is suspended.
export async function processCancellationBatch(auth: AuthService, provider: PayPalProvider, limit = 20) {
  let confirmed = 0, retried = 0, review = 0;
  for (let index = 0; index < Math.min(100, Math.max(0, limit)); index++) {
    const leaseToken = randomUUID();
    const row = await auth.db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT c.id FROM billing_cancellations c
        JOIN billing_checkouts b ON b.id = c.checkout_id WHERE b.scope = ${provider.scope}
        AND ((c.status = 'PENDING' AND c.next_attempt_at <= now()) OR (c.status = 'PROCESSING' AND c.lease_until <= now()))
        ORDER BY c.created_at, c.id FOR UPDATE OF c SKIP LOCKED LIMIT 1`;
      if (!rows[0]) return null;
      return tx.billingCancellation.update({ where: { id: rows[0].id }, data: { status: 'PROCESSING', attempts: { increment: 1 }, leaseToken, leaseUntil: new Date(Date.now() + 120000) }, include: { checkout: true } });
    });
    if (!row) break;
    try {
      const checkout = row.checkout;
      if (!checkout.providerSubscriptionId) throw new ApiError(409, 'CANCELLATION_STATE_REVIEW', 'Missing provider binding');
      let snapshot = await provider.getSubscription(checkout.providerSubscriptionId);
      assertBinding(snapshot, checkout);
      if (!terminal.has(snapshot.status)) {
        if (!['ACTIVE', 'SUSPENDED', 'APPROVED'].includes(snapshot.status)) throw new ApiError(409, 'CANCELLATION_STATE_REVIEW', 'Subscription needs provider review');
        // Recheck the lease before requesting the external side effect.
        const owned = await auth.db.billingCancellation.count({ where: { id: row.id, status: 'PROCESSING', leaseToken, leaseUntil: { gt: new Date() } } });
        if (!owned) throw new ApiError(409, 'CANCELLATION_LEASE_LOST', 'Cancellation lease expired');
        await provider.cancelSubscription(checkout.providerSubscriptionId);
        snapshot = await provider.getSubscription(checkout.providerSubscriptionId);
        assertBinding(snapshot, checkout);
      }
      // A 204 or a timeout is never treated as proof of cancellation.
      if (!terminal.has(snapshot.status)) throw new ApiError(409, 'CANCELLATION_NOT_CONFIRMED', 'Waiting for provider confirmation');
      await auth.transaction(async tx => {
        const updatedAt = new Date(snapshot.status_update_time);
        const current = await tx.billingCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
        if (current.revision !== checkout.revision || (current.providerUpdatedAt && current.providerUpdatedAt > updatedAt)) throw new ApiError(409, 'CHECKOUT_CHANGED', 'Retry with current provider state');
        if (current.providerUpdatedAt?.getTime() === updatedAt.getTime() && current.providerStatus && current.providerStatus !== snapshot.status) throw new ApiError(409, 'CANCELLATION_STATE_REVIEW', 'Conflicting provider state');
        const result = await tx.billingCancellation.updateMany({ where: { id: row.id, status: 'PROCESSING', leaseToken, leaseUntil: { gt: new Date() } },
          data: { status: 'CONFIRMED', confirmedAt: new Date(), leaseToken: null, leaseUntil: null, lastError: null } });
        if (!result.count) throw new ApiError(409, 'CANCELLATION_LEASE_LOST', 'Cancellation lease expired');
        await tx.billingCheckout.update({ where: { id: checkout.id }, data: { providerStatus: snapshot.status, providerUpdatedAt: updatedAt, revision: { increment: 1 } } });
        await tx.billingAudit.create({ data: { actorId: row.actorId, businessId: checkout.businessId, planId: checkout.planId,
          action: 'cancellation.confirmed', changes: { cancellationId: row.id, providerStatus: snapshot.status } } });
      });
      confirmed++;
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'PROCESSING_FAILED';
      const needsReview = permanent.has(code) || row.attempts >= 10;
      const updated = await auth.db.billingCancellation.updateMany({ where: { id: row.id, status: 'PROCESSING', leaseToken }, data: {
        status: needsReview ? 'REVIEW' : 'PENDING', lastError: code, leaseToken: null, leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + Math.min(3600, 2 ** row.attempts * 15) * 1000) } });
      if (updated.count) { if (needsReview) review++; else retried++; }
    }
  }
  return { confirmed, retried, review };
}
