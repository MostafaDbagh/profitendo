import { createHmac } from 'node:crypto';
import type { AuthService, AuthContext, Tx } from '../auth/service.js';
import { decrypt, digest, encrypt, equal, passwordHash, passwordMatches } from '../auth/crypto.js';
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
  await auth.limit('owner-pin-attempt', ctx.user.id, 5, 900);
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

const deviceDuration = 30 * 24 * 60 * 60_000;
const devicePurpose = 'owner-pin-device-v1';

export function ownerPinDeviceCookie(auth: AuthService) {
  const secure = auth.settings.secure;
  return {
    name: secure ? '__Host-pl_owner_device' : 'pl_owner_device',
    options: { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: deviceDuration },
  };
}

export async function rememberOwnerPinDevice(auth: AuthService, ctx: AuthContext, businessId: string, password: string) {
  await auth.limit('owner-pin-device-settings', ctx.user.id, 5, 900);
  return auth.transaction(async tx => {
    const {user} = await requireOwner(auth, tx, ctx, businessId);
    if (!user.ownerPinHash || user.platformRole !== 'USER') {
      throw new ApiError(403, 'OWNER_PIN_DEVICE_UNAVAILABLE', 'PIN sign-in is unavailable for this account');
    }
    if (!await passwordMatches(user.passwordHash, password)) {
      throw new ApiError(403, 'OWNER_PIN_PASSWORD_INCORRECT', 'The current password is incorrect');
    }
    await tx.authAudit.create({data:{businessId,userId:user.id,action:'owner_pin.device_enabled'}});
    return encrypt(auth.settings.key, JSON.stringify({
      userId: user.id, securityVersion: user.securityVersion, pinBinding: digest(user.ownerPinHash),
      expiresAt: Date.now() + deviceDuration,
    }), devicePurpose);
  });
}

function readOwnerDevice(auth: AuthService, token: string | undefined) {
  if (!token || token.length > 1024) return null;
  try {
    return JSON.parse(decrypt(auth.settings.key, token, devicePurpose)) as {
      userId: string; securityVersion: number; pinBinding: string; expiresAt: number;
    };
  } catch { return null; }
}

export async function loginWithOwnerPin(auth: AuthService, email: string, pin: string, token: string | undefined) {
  const rejected = () => new ApiError(401, 'OWNER_PIN_LOGIN_FAILED', 'Check your email and PIN or use your password on this browser');
  const device = readOwnerDevice(auth, token);
  if (!device || device.expiresAt <= Date.now()) throw rejected();
  await auth.limit('owner-pin-attempt', device.userId, 5, 900);
  return auth.transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM auth_users WHERE id = ${device.userId}::uuid FOR UPDATE`;
    const user = await tx.authUser.findUnique({where:{id:device.userId}});
    if (!user || user.disabledAt || user.platformRole !== 'USER' || user.email !== email ||
        user.securityVersion !== device.securityVersion || !user.ownerPinHash ||
        !equal(digest(user.ownerPinHash), device.pinBinding)) throw rejected();
    const owner = await tx.membership.findFirst({
      where:{userId:user.id,role:'OWNER',disabledAt:null,business:{suspendedAt:null}},select:{id:true},
    });
    if (!owner || !await passwordMatches(user.ownerPinHash, pinSecret(auth, user.id, pin))) throw rejected();
    if ((await auth.policy(tx)).emailRequired && !user.emailVerifiedAt) throw rejected();
    // This follows the same MFA and phone checks as password sign-in.
    const session = await auth.makeSession(tx, user);
    await auth.audit(tx, 'session.owner_pin_created', user.id);
    return session;
  });
}
