import type { Tx } from '../auth/service.js';
import { ApiError } from '../errors.js';
// Call from the same serializable transaction as the protected creation or change.
export async function billingState(tx: Tx, businessId: string, now = new Date()) {
  const manual=await tx.manualSubscriptionPayment.findFirst({where:{businessId,startsAt:{lte:now}},orderBy:{endsAt:'desc'},include:{plan:true}});
  if(manual&&manual.endsAt>now)return {subscription:{id:manual.id,businessId,planId:manual.planId,status:'ACTIVE',trialStartedAt:manual.startsAt,trialEndsAt:manual.endsAt,createdAt:manual.createdAt,plan:manual.plan},active:true,status:'ACTIVE',paidUntil:manual.endsAt};
  let subscription = await tx.businessSubscription.findUnique({ where: { businessId }, include: { plan: true } });
  const paid=await tx.billingCheckout.findUnique({where:{businessId},include:{plan:true}});
  const approval=paid?await tx.paidApproval.findUnique({where:{businessId_planId:{businessId,planId:paid.planId}}}):null;
  if(paid?.paidFrom&&paid.paidUntil&&approval?.status==='APPROVED'){
    const confirmed=!!paid.paidTransaction&&paid.activatedTransaction===paid.paidTransaction;
    const active=confirmed&&!paid.accessHold&&paid.paidFrom<=now&&paid.paidUntil>now&&['ACTIVE','CANCELLED','SUSPENDED'].includes(paid.providerStatus??'');
    subscription={id:paid.id,businessId,planId:paid.planId,status:active?'ACTIVE':'EXPIRED',trialStartedAt:paid.paidFrom,trialEndsAt:paid.paidUntil,createdAt:paid.createdAt,plan:paid.plan};
    return {subscription,active,status:paid.accessHold?'REVIEW':!confirmed&&paid.paidUntil>now?'AWAITING_ACTIVATION':active?(paid.providerStatus==='CANCELLED'?'CANCELLED_PAID':'ACTIVE'):'EXPIRED',paidUntil:paid.paidUntil};
  }
  if(manual&&(!subscription||manual.endsAt>subscription.trialEndsAt))return {subscription:{id:manual.id,businessId,planId:manual.planId,status:'EXPIRED',trialStartedAt:manual.startsAt,trialEndsAt:manual.endsAt,createdAt:manual.createdAt,plan:manual.plan},active:false,status:'EXPIRED',paidUntil:manual.endsAt};
  const active = !!subscription && subscription.status === 'TRIAL' && subscription.trialStartedAt <= now && subscription.trialEndsAt > now;
  return { subscription, active, status: !subscription ? 'NOT_STARTED' : active ? 'TRIAL' : 'EXPIRED' };
}
export async function lockCapacity(tx: Tx, businessId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`billing:${businessId}`}, 0))`;
}
export async function memberUsage(tx: Tx, businessId: string, exclude: { email?: string; invitationId?: string } = {}) {
  const activeMembers = await tx.membership.count({ where: { businessId, disabledAt: null } });
  const pendingInvitations = await tx.invitation.count({ where: { businessId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() },
    ...(exclude.email ? { email: { not: exclude.email } } : {}), ...(exclude.invitationId ? { id: { not: exclude.invitationId } } : {}) } });
  return { activeMembers, pendingInvitations, reservedMembers: activeMembers + pendingInvitations };
}
export async function requireMemberCapacity(tx: Tx, businessId: string, exclude: { email?: string; invitationId?: string } = {}) {
  await lockCapacity(tx, businessId);
  const state = await billingState(tx, businessId);
  if (!state.active || !state.subscription) throw new ApiError(402, 'SUBSCRIPTION_REQUIRED', 'Start or renew your business subscription before adding team members');
  const usage = await memberUsage(tx, businessId, exclude);
  if (usage.reservedMembers >= state.subscription.plan.maxMembers) throw new ApiError(409, 'MEMBER_LIMIT_REACHED', 'Your plan team limit has been reached');
}
