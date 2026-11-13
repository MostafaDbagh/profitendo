import type { AuthContext, AuthService, Tx } from '../auth/service.js';
import { ApiError } from '../errors.js';
export type Query = { page: number; pageSize: number; q: string; status: 'all' | 'active' | 'inactive' };
export type StatusChange = { revision: number; active: boolean; reason: string };
export async function requirePlatform(auth: AuthService, tx: Tx, ctx: AuthContext) {
  const current = await auth.assertSession(tx, ctx);
  if (current.user.platformRole !== 'SUPER_ADMIN') throw new ApiError(403, 'PLATFORM_FORBIDDEN', 'Platform administrator access required');
  if (current.user.mfaSecret && !current.session.mfaVerified) throw new ApiError(403, 'MFA_REQUIRED', 'Complete MFA first');
  return current;
}
const conflict = () => new ApiError(409, 'REVISION_CONFLICT', 'This record changed. Reload before saving');
const missing = () => new ApiError(404, 'NOT_FOUND', 'Record not found');
export class PlatformService {
  constructor(readonly auth: AuthService) {}
  async overview(ctx: AuthContext) {
    return this.auth.transaction(async tx => {
      await requirePlatform(this.auth, tx, ctx);
      return { businesses: await tx.business.count(), suspendedBusinesses: await tx.business.count({ where: { suspendedAt: { not: null } } }),
        users: await tx.authUser.count({ where: { platformRole: 'USER' } }), disabledUsers: await tx.authUser.count({ where: { platformRole: 'USER', disabledAt: { not: null } } }) };
    });
  }
  async businesses(ctx: AuthContext, query: Query) {
    return this.auth.transaction(async tx => {
      await requirePlatform(this.auth, tx, ctx);
      const where = { ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}), ...(query.status === 'all' ? {} : { suspendedAt: query.status === 'active' ? null : { not: null } }) };
      const items = await tx.business.findMany({ where, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, name: true, createdAt: true, suspendedAt: true, revision: true, _count: { select: { memberships: true } } } });
      return { page: query.page, pageSize: query.pageSize, total: await tx.business.count({ where }), items: items.map(({ _count, suspendedAt, ...row }) => ({ ...row, active: !suspendedAt, memberCount: _count.memberships })) };
    });
  }
  async users(ctx: AuthContext, query: Query) {
    return this.auth.transaction(async tx => {
      await requirePlatform(this.auth, tx, ctx);
      const where = { ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' as const } }, { email: { contains: query.q, mode: 'insensitive' as const } }] } : {}), ...(query.status === 'all' ? {} : { disabledAt: query.status === 'active' ? null : { not: null } }) };
      const items = await tx.authUser.findMany({ where, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, name: true, email: true, platformRole: true, disabledAt: true, emailVerifiedAt: true, createdAt: true, securityVersion: true } });
      return { page: query.page, pageSize: query.pageSize, total: await tx.authUser.count({ where }), items: items.map(({ securityVersion, disabledAt, emailVerifiedAt, ...row }) => ({ ...row, revision: securityVersion, active: !disabledAt, verified: !!emailVerifiedAt })) };
    });
  }
  async setBusinessStatus(ctx: AuthContext, id: string, patch: StatusChange) {
    return this.auth.transaction(async tx => {
      const { user } = await requirePlatform(this.auth, tx, ctx);
      const row = await tx.business.findUnique({ where: { id } });
      if (!row) throw missing();
      if (row.revision !== patch.revision) throw conflict();
      if (!row.suspendedAt === patch.active) return { ok: true, changed: false };
      const result = await tx.business.updateMany({ where: { id, revision: patch.revision }, data: { suspendedAt: patch.active ? null : new Date(), revision: { increment: 1 } } });
      if (!result.count) throw conflict();
      if (!patch.active) await tx.invitation.updateMany({ where: { businessId: id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.platformAudit.create({ data: { actorId: user.id, targetId: id, targetType: 'business', action: patch.active ? 'business.reactivated' : 'business.suspended', reason: patch.reason, beforeActive: !row.suspendedAt, afterActive: patch.active } });
      return { ok: true, changed: true };
    });
  }
  async setUserStatus(ctx: AuthContext, id: string, patch: StatusChange) {
    return this.auth.transaction(async tx => {
      const { user } = await requirePlatform(this.auth, tx, ctx);
      const row = await tx.authUser.findUnique({ where: { id } });
      if (!row) throw missing();
      // Administrator lifecycle remains the local operator's responsibility.
      if (row.platformRole === 'SUPER_ADMIN' || row.id === user.id) throw new ApiError(403, 'ADMIN_PROTECTED', 'Platform administrator accounts cannot be changed here');
      if (row.securityVersion !== patch.revision) throw conflict();
      if (!row.disabledAt === patch.active) return { ok: true, changed: false };
      const result = await tx.authUser.updateMany({ where: { id, securityVersion: patch.revision, platformRole: 'USER' }, data: { disabledAt: patch.active ? null : new Date(), securityVersion: { increment: 1 } } });
      if (!result.count) throw conflict();
      await tx.authSession.deleteMany({ where: { userId: id } });
      if (!patch.active) {
        await tx.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
        await tx.invitation.updateMany({ where: { invitedBy: id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.platformAudit.create({ data: { actorId: user.id, targetId: id, targetType: 'user', action: patch.active ? 'user.reactivated' : 'user.disabled', reason: patch.reason, beforeActive: !row.disabledAt, afterActive: patch.active } });
      return { ok: true, changed: true };
    });
  }
  async audit(ctx: AuthContext, query: Pick<Query, 'page' | 'pageSize'>) {
    return this.auth.transaction(async tx => {
      await requirePlatform(this.auth, tx, ctx);
      const items = await tx.platformAudit.findMany({ take: query.pageSize, skip: (query.page - 1) * query.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      const people = await tx.authUser.findMany({ where: { id: { in: items.flatMap(row => row.targetType === 'user' ? [row.actorId, row.targetId] : [row.actorId]) } }, select: { id: true, name: true } });
      const businesses = await tx.business.findMany({ where: { id: { in: items.filter(row => row.targetType === 'business').map(row => row.targetId) } }, select: { id: true, name: true } });
      const names = new Map([...people, ...businesses].map(row => [row.id, row.name]));
      return { ...query, total: await tx.platformAudit.count(), items: items.map(row => ({ ...row, actorName: names.get(row.actorId) ?? null, targetName: names.get(row.targetId) ?? null })) };
    });
  }
}
