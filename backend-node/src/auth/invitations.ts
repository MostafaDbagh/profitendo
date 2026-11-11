import type { MembershipRole } from '../generated/prisma/client.js';
import { ApiError } from '../errors.js';
import { digest, randomToken, passwordHash } from './crypto.js';
import { AuthService, type AuthContext, type Tx } from './service.js';
import { requireMemberCapacity } from '../billing/entitlements.js';
import { requireBusiness } from '../businesses/access.js';
const invalid = () => new ApiError(400, 'INVALID_INVITATION', 'Invitation is invalid or expired');
async function owner(auth: AuthService, tx: Tx, ctx: AuthContext, businessId: string) {
  await requireBusiness(auth, tx, ctx, businessId, 'invitations.manage');
}
export async function invite(auth: AuthService, ctx: AuthContext, input: { businessId: string; email: string; role: Exclude<MembershipRole, 'OWNER'> }) {
  await auth.transaction(async tx => {
    await owner(auth, tx, ctx, input.businessId);
    const member = await tx.membership.findFirst({ where: { businessId: input.businessId, user: { email: input.email } } });
    if (member) throw new ApiError(409, 'MEMBER_EXISTS', 'This email already belongs to a member');
    await tx.invitation.updateMany({ where: { businessId: input.businessId, email: input.email, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await requireMemberCapacity(tx, input.businessId, { email: input.email });
    const token = randomToken();
    await tx.invitation.create({ data: { tokenHash: digest(token), businessId: input.businessId, email: input.email, role: input.role, invitedBy: ctx.user.id, expiresAt: new Date(Date.now() + 48 * 3600000) } });
    await auth.queueMail(tx, input.email, 'Your ProfitLens team invitation', 'invite', token);
    await auth.audit(tx, 'invitation.created', ctx.user.id, input.businessId);
  });
}
export async function revokeInvitation(auth: AuthService, ctx: AuthContext, id: string) {
  await auth.transaction(async tx => {
    const invitation = await tx.invitation.findUnique({ where: { id } });
    if (!invitation) throw invalid();
    await owner(auth, tx, ctx, invitation.businessId);
    await tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await auth.audit(tx, 'invitation.revoked', ctx.user.id, invitation.businessId);
  });
}
export async function acceptInvitation(auth: AuthService, input: { token: string; name?: string; password?: string }, ctx?: AuthContext) {
  const hash = input.password ? await passwordHash(input.password) : undefined;
  await auth.transaction(async tx => {
    const invitation = await tx.invitation.findUnique({ where: { tokenHash: digest(input.token) }, include: { business: true } });
    if (!invitation || invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= new Date() || invitation.business.suspendedAt) throw invalid();
    // Removing the inviter's ownership also invalidates outstanding invitations.
    const inviter = await tx.membership.findUnique({ where: { businessId_userId: { businessId: invitation.businessId, userId: invitation.invitedBy } }, include: { user: true } });
    if (!inviter || inviter.role !== 'OWNER' || inviter.disabledAt || inviter.user.disabledAt) throw invalid();
    let user = await tx.authUser.findUnique({ where: { email: invitation.email } });
    if (user) {
      if (!ctx || ctx.user.id !== user.id || auth.stage(ctx) !== 'authenticated') {
        throw new ApiError(401, 'INVITATION_LOGIN_REQUIRED', 'Sign in to the invited account before accepting');
      }
      user = (await auth.assertSession(tx, ctx)).user;
    } else {
      if (!hash || !input.name) throw new ApiError(422, 'INVITATION_DETAILS_REQUIRED', 'Enter your name and a password');
      user = await tx.authUser.create({ data: { email: invitation.email, name: input.name, passwordHash: hash, emailVerifiedAt: new Date() } });
    }
    const consumed = await tx.invitation.updateMany({ where: { id: invitation.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (!consumed.count) throw invalid();
    const existing = await tx.membership.findUnique({ where: { businessId_userId: { businessId: invitation.businessId, userId: user.id } } });
    if (existing) throw new ApiError(409, 'MEMBER_EXISTS', 'Membership already exists');
    await requireMemberCapacity(tx, invitation.businessId, { invitationId: invitation.id });
    await tx.membership.create({ data: { businessId: invitation.businessId, userId: user.id, role: invitation.role } });
    await auth.audit(tx, 'invitation.accepted', user.id, invitation.businessId);
  });
}
export async function disableMember(auth: AuthService, ctx: AuthContext, id: string) {
  await auth.transaction(async tx => {
    const member = await tx.membership.findUnique({ where: { id } });
    if (!member) throw new ApiError(404, 'NOT_FOUND', 'Member not found');
    await owner(auth, tx, ctx, member.businessId);
    if (member.role === 'OWNER') throw new ApiError(403, 'OWNER_PROTECTED', 'Owner access cannot be removed here');
    await tx.membership.update({ where: { id }, data: { disabledAt: new Date(), revision: { increment: 1 } } });
    // Business access must be resolved live by every future tenant route.
    // Revoke existing sessions as an additional immediate safety measure.
    await tx.authUser.update({ where: { id: member.userId }, data: { securityVersion: { increment: 1 } } });
    await tx.authSession.deleteMany({ where: { userId: member.userId } });
    await auth.audit(tx, 'membership.disabled', ctx.user.id, member.businessId);
  });
}
