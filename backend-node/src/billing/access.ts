import type { AuthService, AuthContext, Tx } from '../auth/service.js';
import { ApiError } from '../errors.js';

// Deliberately limited to billing reads and cancellation. This is NOT an
// operational-access bypass and must never authorize checkout or reactivation.
export async function requireBillingOwner(auth: AuthService, tx: Tx, ctx: AuthContext, businessId: string) {
  const { user, session } = await auth.assertSession(tx, ctx);
  if (!user.mfaSecret) throw new ApiError(403, 'BILLING_MFA_SETUP_REQUIRED', 'Set up MFA in Account security before accessing billing');
  if (!session.mfaVerified) throw new ApiError(403, 'MFA_REQUIRED', 'Complete MFA first');
  const membership = await tx.membership.findUnique({ where: { businessId_userId: { businessId, userId: user.id } } });
  if (!membership || membership.disabledAt || membership.role !== 'OWNER') throw new ApiError(403, 'FORBIDDEN', 'Business billing access is not available');
  return membership;
}
