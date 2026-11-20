import { ApiError } from '../errors.js';
import type { AuthService, AuthContext, Tx } from '../auth/service.js';
import { effectivePermissions, type Permission } from './permissions.js';
type OwnerPinAccess = {
  membership: {role: string};
  user: {ownerPinHash: string | null};
  session: {ownerPinUnlockedUntil: Date | null};
};

export function ownerPinStatus(access: OwnerPinAccess) {
  const enabled = access.membership.role === 'OWNER' && Boolean(access.user.ownerPinHash);
  return {enabled, unlockedUntil: enabled ? access.session.ownerPinUnlockedUntil : null};
}

export function requireOwnerPin(access: OwnerPinAccess) {
  const {enabled, unlockedUntil} = ownerPinStatus(access);
  if (enabled && (!unlockedUntil || unlockedUntil.getTime() <= Date.now())) {
    throw new ApiError(403, 'OWNER_PIN_REQUIRED', 'Unlock this section with your owner PIN');
  }
}

const pinProtectedPermissions = new Set<Permission>(['cash.close', 'payments.view', 'payments.manage', 'payments.reverse', 'reports.deliver']);

/** Call INSIDE the same serializable transaction as the protected operation.
 * Business ID is a selector only. Never use it as proof of access.
 * Platform role deliberately does not bypass business membership.
 */
export async function requireBusiness(auth: AuthService, tx: Tx, ctx: AuthContext, businessId: string, permission: Permission) {
  const { user, session } = await auth.assertSession(tx, ctx);
  if (await auth.requiresMfa(tx, user) && !session.mfaVerified) throw new ApiError(403, 'MFA_REQUIRED', 'Complete MFA first');
  const membership = await tx.membership.findUnique({
    where: { businessId_userId: { businessId, userId: user.id } }, include: { business: true },
  });
  if (!membership || membership.disabledAt || membership.business.suspendedAt) {
    throw new ApiError(403, 'FORBIDDEN', 'Business access is not available');
  }
  if(membership.role==='OWNER'&&(await auth.policy(tx)).ownerPhoneRequired&&!user.phoneVerifiedAt)throw new ApiError(403,'PHONE_UNVERIFIED','Verify your phone first');
  const permissions = effectivePermissions(membership.role, membership.permissionOverrides);
  if (!permissions['business.view'] || !permissions[permission]) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action');
  const access = { user, session, membership, business: membership.business, permissions };
  if (pinProtectedPermissions.has(permission)) requireOwnerPin(access);
  return access;
}
