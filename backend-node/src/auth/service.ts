import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import type { Prisma, PrismaClient, AuthUser, AuthSession } from '../generated/prisma/client.js';
import { ApiError } from '../errors.js';
import type { AuthSettings } from './settings.js';
import { digest, randomToken, passwordHash, passwordMatches, encrypt, decrypt, csrfFor, newTotpSecret, totp, totpStep } from './crypto.js';
export type Tx = Prisma.TransactionClient;
export type AuthContext = { token: string; session: AuthSession; user: AuthUser; mfaRequired: boolean };
const fail = () => new ApiError(401, 'INVALID_CREDENTIALS', 'Email, password or verification code is incorrect');
const invalidToken = () => new ApiError(400, 'INVALID_TOKEN', 'This link is invalid or has expired');
const hour = 3600000;
export const publicUser = (u: AuthUser) => ({ user_id: u.id, email: u.email, name: u.name, platformRole: u.platformRole });
export class AuthService {
  readonly dummyHash: Promise<string>;
  constructor(readonly db: PrismaClient, readonly settings: AuthSettings) {
    this.dummyHash = passwordHash(randomToken());
  }
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.db.$transaction(fn, { isolationLevel: 'Serializable', timeout: 10000 }); }
      catch (e) {
        type AdapterConflict = { name?: string; cause?: { kind?: string; originalCode?: string } };
        const error = e as AdapterConflict & { code?: string; meta?: { code?: string; driverAdapterError?: AdapterConflict } };
        // Raw SQL wraps adapter conflicts in P2010; commit conflicts surface directly.
        const adapter = error.code === 'P2010' ? error.meta?.driverAdapterError : error;
        const retryable = error.code === 'P2034'
          || (error.code === 'P2010' && ['40001', '40P01'].includes(error.meta?.code ?? ''))
          || (adapter?.name === 'DriverAdapterError'
          && adapter.cause?.kind === 'TransactionWriteConflict'
          && ['40001', '40P01'].includes(adapter.cause.originalCode ?? ''));
        if (!retryable) throw e;
        if (attempt >= 6) throw new ApiError(503, 'TRANSACTION_BUSY', 'Records are busy. Please retry the operation');
        await new Promise(resolve => setTimeout(resolve, Math.min(300, 30 * 2 ** attempt) + randomInt(0, 20)));
      }
    }
  }
  async lockUser(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM auth_users WHERE id = ${id}::uuid FOR UPDATE`;
    const u = await tx.authUser.findUnique({ where: { id } });
    if (!u || u.disabledAt) throw fail();
    return u;
  }
  async audit(tx: Tx, action: string, userId?: string, businessId?: string) {
    await tx.authAudit.create({ data: { action, userId, businessId } });
  }
  async limit(scope: string, identity: string, max: number, seconds = 900) {
    const bucket = Math.floor(Date.now() / (seconds * 1000));
    const key = digest(`${scope}:${identity}:${bucket}`);
    const row = await this.db.authRateLimit.upsert({ where: { key },
      create: { key, count: 1, expiresAt: new Date((bucket + 1) * seconds * 1000) }, update: { count: { increment: 1 } } });
    if (row.count > max) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  }
  async queueMail(tx: Tx, email: string, subject: string, action: string, token: string) {
    const id = randomUUID();
    // Fragment avoids leaking tokens into HTTP request paths or access logs.
    const url = `${this.settings.appOrigin}/auth-v2#action=${action}&token=${token}`;
    const payload = encrypt(this.settings.key, JSON.stringify({ to: email, subject, text: `${subject}\n\n${url}\n\nIf you did not request this, ignore this message.` }), `mail:${id}`);
    await tx.authMail.create({ data: { id, payload } });
  }
  async issueToken(tx: Tx, user: AuthUser, kind: 'VERIFY_EMAIL' | 'PASSWORD_RESET') {
    const token = randomToken();
    await tx.authToken.updateMany({ where: { userId: user.id, kind, usedAt: null }, data: { usedAt: new Date() } });
    await tx.authToken.create({ data: { tokenHash: digest(token), userId: user.id, kind, expiresAt: new Date(Date.now() + (kind === 'VERIFY_EMAIL' ? 24 * hour : hour / 2)) } });
    if(!this.settings.mockOtp)await this.queueMail(tx, user.email, kind === 'VERIFY_EMAIL' ? 'Verify your ProfitLens email' : 'Reset your ProfitLens password', kind === 'VERIFY_EMAIL' ? 'verify' : 'reset', token);
  }
  async register(input: { email: string; password: string; name: string; businessName: string }) {
    const hash = await passwordHash(input.password);
    try {
      await this.transaction(async tx => {
        if (await tx.authUser.findUnique({ where: { email: input.email } })) return;
        const user = await tx.authUser.create({ data: { email: input.email, name: input.name, passwordHash: hash } });
        const business = await tx.business.create({ data: { name: input.businessName } });
        await tx.membership.create({ data: { userId: user.id, businessId: business.id, role: 'OWNER' } });
        await this.issueToken(tx, user, 'VERIFY_EMAIL');
        await this.audit(tx, 'account.registered', user.id, business.id);
      });
    } catch (e) { if ((e as { code?: string }).code !== 'P2002') throw e; }
  }
  async requestToken(email: string, kind: 'VERIFY_EMAIL' | 'PASSWORD_RESET') {
    await this.transaction(async tx => {
      const user = await tx.authUser.findUnique({ where: { email } });
      if (!user || user.disabledAt || (kind === 'VERIFY_EMAIL' && user.emailVerifiedAt)) return;
      await this.lockUser(tx, user.id);
      await this.issueToken(tx, user, kind);
    });
  }
  async consumeToken(token: string, kind: 'VERIFY_EMAIL' | 'PASSWORD_RESET', password?: string) {
    const hash = password ? await passwordHash(password) : undefined;
    await this.transaction(async tx => {
      const row = await tx.authToken.findUnique({ where: { tokenHash: digest(token) } });
      if (!row || row.kind !== kind || row.usedAt || row.expiresAt <= new Date()) throw invalidToken();
      await this.lockUser(tx, row.userId);
      const consumed = await tx.authToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!consumed.count) throw invalidToken();
      if (kind === 'VERIFY_EMAIL') {
        await tx.authUser.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
      } else {
        await tx.authUser.update({ where: { id: row.userId }, data: { passwordHash: hash!, securityVersion: { increment: 1 } } });
        await tx.authSession.deleteMany({ where: { userId: row.userId } });
      }
      await this.audit(tx, kind === 'VERIFY_EMAIL' ? 'email.verified' : 'password.reset', row.userId);
    });
  }
  async requiresMfa(tx: Tx | PrismaClient, user: AuthUser) {
    return !!user.mfaSecret || user.platformRole === 'SUPER_ADMIN';
  }
  async makeSession(tx: Tx, user: AuthUser, mfaVerified = false) {
    const token = randomToken(), required = await this.requiresMfa(tx, user);
    const session = await tx.authSession.create({ data: { userId: user.id, tokenHash: digest(token), securityVersion: user.securityVersion,
      mfaVerified, expiresAt: new Date(Date.now() + (required && !mfaVerified ? 10 * 60000 : 12 * hour)) } });
    return { token, session, user, mfaRequired: required };
  }
  async login(email: string, password: string) {
    const snapshot = await this.db.authUser.findUnique({ where: { email } });
    const correct = await passwordMatches(snapshot?.passwordHash ?? await this.dummyHash, password);
    if (!snapshot || !correct || snapshot.disabledAt) throw fail();
    if (!snapshot.emailVerifiedAt) throw new ApiError(403, 'EMAIL_UNVERIFIED', 'Verify your email before signing in');
    return this.transaction(async tx => {
      const user = await this.lockUser(tx, snapshot.id);
      if (user.passwordHash !== snapshot.passwordHash) throw fail();
      const session = await this.makeSession(tx, user);
      await this.audit(tx, 'session.created', user.id);
      return session;
    });
  }
  async authenticate(token: string): Promise<AuthContext> {
    const session = await this.db.authSession.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } });
    if (!session || session.expiresAt <= new Date() || session.lastSeenAt.getTime() < Date.now() - 30 * 60000 || session.user.disabledAt || session.securityVersion !== session.user.securityVersion || !session.user.emailVerifiedAt) {
      throw new ApiError(401, 'SESSION_EXPIRED', 'Sign in again');
    }
    // Do not resurrect a session revoked concurrently.
    const touched = await this.db.authSession.updateMany({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    if (!touched.count) throw new ApiError(401, 'SESSION_EXPIRED', 'Sign in again');
    return { token, session, user: session.user, mfaRequired: await this.requiresMfa(this.db, session.user) };
  }
  stage(ctx: AuthContext) {
    return ctx.mfaRequired && !ctx.session.mfaVerified ? (ctx.user.mfaSecret ? 'mfa_required' : 'mfa_setup_required') : 'authenticated';
  }
  async sessionResult(ctx: AuthContext) {
    const stage = this.stage(ctx);
    const memberships = stage === 'authenticated' ? await this.db.membership.findMany({ where: { userId: ctx.user.id, disabledAt: null, business: { suspendedAt: null } }, select: { businessId: true, role: true, business: { select: { name: true } } } }) : [];
    return { user: publicUser(ctx.user), stage, mfaEnabled: !!ctx.user.mfaSecret, mfaMandatory: ctx.user.platformRole === 'SUPER_ADMIN', memberships, csrfToken: csrfFor(this.settings.key, ctx.token) };
  }
  async assertSession(tx: Tx, ctx: AuthContext) {
    const user = await this.lockUser(tx, ctx.user.id);
    const session = await tx.authSession.findUnique({ where: { id: ctx.session.id } });
    if (!session || session.expiresAt <= new Date() || session.lastSeenAt.getTime() < Date.now() - 30 * 60000 || session.securityVersion !== user.securityVersion || !user.emailVerifiedAt) throw fail();
    return { user, session };
  }
  async beginMfa(ctx: AuthContext, password: string) {
    if (!await passwordMatches(ctx.user.passwordHash, password)) throw fail();
    return this.transaction(async tx => {
      const { user } = await this.assertSession(tx, ctx);
      if (user.passwordHash !== ctx.user.passwordHash || user.mfaSecret) throw new ApiError(409, 'MFA_ALREADY_ENABLED', 'MFA is already enabled or credentials changed');
      const secret = newTotpSecret();
      await tx.authSession.update({ where: { id: ctx.session.id }, data: { pendingMfaSecret: encrypt(this.settings.key, secret, `enroll:${ctx.session.id}`) } });
      return { secret, uri: totp(secret, user.email).toString() };
    });
  }
  async confirmMfa(ctx: AuthContext, code: string) {
    return this.transaction(async tx => {
      const { user, session } = await this.assertSession(tx, ctx);
      if (!session.pendingMfaSecret || user.mfaSecret) throw new ApiError(409, 'MFA_SETUP_REQUIRED', 'Start MFA setup first');
      const secret = decrypt(this.settings.key, session.pendingMfaSecret, `enroll:${session.id}`);
      const step = this.settings.mockOtp ? (code==='123456'?0:null) : totpStep(secret, user.email, code);
      if (step === null) throw fail();
      const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(12).toString('hex'));
      const updated = await tx.authUser.update({ where: { id: user.id }, data: { mfaSecret: encrypt(this.settings.key, secret, `mfa:${user.id}`), mfaLastStep: step, recoveryHashes: recoveryCodes.map(digest), securityVersion: { increment: 1 } } });
      await tx.authSession.deleteMany({ where: { userId: user.id } });
      const result = await this.makeSession(tx, updated, true);
      await this.audit(tx, 'mfa.enabled', user.id);
      return { ...result, recoveryCodes };
    });
  }
  async disableMfa(ctx: AuthContext, password: string, code: string) {
    if (!await passwordMatches(ctx.user.passwordHash, password)) throw fail();
    return this.transaction(async tx => {
      const { user, session } = await this.assertSession(tx, ctx);
      if (user.platformRole === 'SUPER_ADMIN') throw new ApiError(403, 'MFA_MANDATORY', 'MFA is required for platform administrators');
      if (!session.mfaVerified || !user.mfaSecret || user.passwordHash !== ctx.user.passwordHash) throw fail();
      const step = this.settings.mockOtp ? (code === '123456' ? 0 : null) : totpStep(decrypt(this.settings.key, user.mfaSecret, `mfa:${user.id}`), user.email, code);
      if (step === null || (!this.settings.mockOtp && step <= user.mfaLastStep)) throw fail();
      const updated = await tx.authUser.update({ where: { id: user.id }, data: { mfaSecret: null, mfaLastStep: -1, recoveryHashes: [], securityVersion: { increment: 1 } } });
      await tx.authSession.deleteMany({ where: { userId: user.id } });
      await this.audit(tx, 'mfa.disabled', user.id);
      return this.makeSession(tx, updated);
    });
  }
  async verifyMfa(ctx: AuthContext, code: string) {
    return this.transaction(async tx => {
      const { user } = await this.assertSession(tx, ctx);
      if (!user.mfaSecret) throw fail();
      const isRecovery = /^[a-f0-9]{24}$/.test(code);
      let data: Prisma.AuthUserUpdateInput;
      if (isRecovery) {
        const hash = digest(code);
        if (!user.recoveryHashes.includes(hash)) throw fail();
        data = { recoveryHashes: user.recoveryHashes.filter(v => v !== hash) };
      } else {
        const step = this.settings.mockOtp ? (code==='123456'?user.mfaLastStep:null) : totpStep(decrypt(this.settings.key, user.mfaSecret, `mfa:${user.id}`), user.email, code);
        if (step === null || (!this.settings.mockOtp && step <= user.mfaLastStep)) throw fail();
        data = { mfaLastStep: step };
      }
      const updated = await tx.authUser.update({ where: { id: user.id }, data });
      await tx.authSession.delete({ where: { id: ctx.session.id } });
      const result = await this.makeSession(tx, updated, true);
      await this.audit(tx, isRecovery ? 'mfa.recovery_used' : 'mfa.verified', user.id);
      return result;
    });
  }
  async revoke(ctx: AuthContext, sessionId?: string) {
    await this.transaction(async tx => {
      await this.assertSession(tx, ctx);
      await tx.authSession.deleteMany({ where: { userId: ctx.user.id, ...(sessionId ? { id: sessionId } : {}) } });
      await this.audit(tx, sessionId ? 'session.revoked' : 'sessions.revoked', ctx.user.id);
    });
  }
  async changePassword(ctx: AuthContext, current: string, password: string) {
    if (!await passwordMatches(ctx.user.passwordHash, current)) throw fail();
    const hash = await passwordHash(password);
    await this.transaction(async tx => {
      const { user } = await this.assertSession(tx, ctx);
      if (user.passwordHash !== ctx.user.passwordHash) throw fail();
      await tx.authUser.update({ where: { id: user.id }, data: { passwordHash: hash, securityVersion: { increment: 1 } } });
      await tx.authSession.deleteMany({ where: { userId: user.id } });
      await tx.authToken.updateMany({ where: { userId: user.id, kind: 'PASSWORD_RESET', usedAt: null }, data: { usedAt: new Date() } });
      await this.audit(tx, 'password.changed', user.id);
    });
  }
}
