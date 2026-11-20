import { createHmac } from 'node:crypto';
import type { AuthService, AuthContext, Tx } from '../auth/service.js';
import { passwordHash, passwordMatches } from '../auth/crypto.js';
import { ApiError } from '../errors.js';
import { ownerPinStatus, requireBusiness } from './access.js';

const unlockDuration = 15 * 60_000;

function pinSecret(auth: AuthService, userId: string, pin: string) {
  return createHmac('sha256', auth.settings.key).update(`owner-pin:${userId}:${pin}`).digest('hex');
}

async function requireOwner(auth: AuthService, tx: Tx, ctx: AuthContext, businessId: string) {
  const access = await requireBusiness(auth, tx, ctx, businessId, 'business.edit');
  if (access.membership.role !== 'OWNER') throw new ApiError(403, 'FORBIDDEN', 'Only business owners can use an owner PIN');
  return access;
}

export async function configureOwnerPin(auth: AuthService, ctx: AuthContext, businessId: string, password: string, pin: string | null) {
  await auth.limit('owner-pin-settings', ctx.user.id, 5, 900);
  return auth.transaction(async tx => {
    const {user} = await requireOwner(auth, tx, ctx, businessId);
    if (!await passwordMatches(user.passwordHash, password)) {
      throw new ApiError(403, 'OWNER_PIN_PASSWORD_INCORRECT', 'The current password is incorrect');
    }
    const ownerPinHash = pin === null ? null : await passwordHash(pinSecret(auth, user.id, pin));
    await tx.authUser.update({where:{id:user.id},data:{ownerPinHash}});
    await tx.authSession.updateMany({where:{userId:user.id},data:{ownerPinUnlockedUntil:null}});
    await tx.authAudit.create({data:{businessId,userId:user.id,action:pin === null ? 'owner_pin.disabled' : 'owner_pin.configured'}});
    return {enabled: pin !== null, unlockedUntil: null};
  });
}

export async function unlockOwnerPin(auth: AuthService, ctx: AuthContext, businessId: string, pin: string) {
  await auth.limit('owner-pin-unlock', ctx.user.id, 5, 900);
  return auth.transaction(async tx => {
    const access = await requireOwner(auth, tx, ctx, businessId);
    const {user, session} = access;
    if (!user.ownerPinHash) return ownerPinStatus(access);
    if (!await passwordMatches(user.ownerPinHash, pinSecret(auth, user.id, pin))) {
      throw new ApiError(403, 'OWNER_PIN_INCORRECT', 'The PIN is incorrect');
    }
    const unlockedUntil = new Date(Date.now() + unlockDuration);
    await tx.authSession.update({where:{id:session.id},data:{ownerPinUnlockedUntil:unlockedUntil}});
    return {enabled:true,unlockedUntil};
  });
}
