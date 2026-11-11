import type { Prisma } from '../generated/prisma/client.js';
import type { AuthService, AuthContext } from '../auth/service.js';
import { requireMemberCapacity } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
import { requireBusiness } from './access.js';
import { effectivePermissions, PERMISSIONS, roleCatalog, type Permission } from './permissions.js';
export type Page = { page: number; pageSize: number };
export type BusinessPatch = { revision: number; name?: string; baseCurrency?: string; timezone?: string; dateFormat?: string; numberFormat?: string };
export type MemberPatch = { revision: number; role?: 'OPERATIONS_MANAGER' | 'WAREHOUSE_STAFF' | 'SHOP_MANAGER' | 'CASHIER' | 'VIEWER'; permissionOverrides?: Partial<Record<Permission, boolean>>; active?: boolean };
const conflict = () => new ApiError(409, 'REVISION_CONFLICT', 'This record changed. Reload it before saving.');
const missing = () => new ApiError(404, 'NOT_FOUND', 'Record not found');
export class BusinessService {
  constructor(readonly auth: AuthService) {}
  async list(ctx: AuthContext) {
    return this.auth.transaction(async tx => {
      const { user, session } = await this.auth.assertSession(tx, ctx);
      if (await this.auth.requiresMfa(tx, user) && !session.mfaVerified) throw new ApiError(403, 'MFA_REQUIRED', 'Complete MFA first');
      const rows = await tx.membership.findMany({ where: { userId: user.id, disabledAt: null, business: { suspendedAt: null } }, include: { business: true }, orderBy: { business: { name: 'asc' } } });
      return rows.map(row => ({ id: row.businessId, name: row.business.name, role: row.role,
        permissions: effectivePermissions(row.role, row.permissionOverrides) })).filter(row => row.permissions['business.view']);
    });
  }
  async get(ctx: AuthContext, businessId: string) {
    return this.auth.transaction(async tx => {
      const access = await requireBusiness(this.auth, tx, ctx, businessId, 'business.view');
      return { business: access.business, membershipId: access.membership.id, role: access.membership.role, permissions: access.permissions };
    });
  }
  async update(ctx: AuthContext, businessId: string, patch: BusinessPatch) {
    return this.auth.transaction(async tx => {
      const { business } = await requireBusiness(this.auth, tx, ctx, businessId, 'business.edit');
      if (business.revision !== patch.revision) throw conflict();
      if(patch.timezone && patch.timezone!==business.timezone){
        await tx.$queryRaw`SELECT id FROM businesses WHERE id=${businessId}::uuid FOR UPDATE`;
        if(await tx.salePayment.count({where:{businessId}})||await tx.moneyEntry.count({where:{businessId}})||await tx.cashClose.count({where:{businessId}}))throw new ApiError(409,'TIMEZONE_LOCKED','Timezone is fixed after payment activity');
      }
      if (patch.baseCurrency && patch.baseCurrency !== business.baseCurrency && business.currencyLockedAt) {
        throw new ApiError(409, 'CURRENCY_LOCKED', 'The currency cannot change after financial activity begins');
      }
      const { revision, ...data } = patch;
      const updated = await tx.business.updateMany({ where: { id: businessId, revision }, data: { ...data, revision: { increment: 1 } } });
      if (!updated.count) throw conflict();
      const changes = Object.fromEntries(Object.entries(data).map(([key, after]) => [key, { before: business[key as keyof typeof data], after }]));
      await tx.authAudit.create({ data: { userId: ctx.user.id, businessId, action: 'business.updated', targetId: businessId, changes } });
      return tx.business.findUniqueOrThrow({ where: { id: businessId } });
    });
  }
  async members(ctx: AuthContext, businessId: string, paging: Page) {
    return this.auth.transaction(async tx => {
      const { permissions } = await requireBusiness(this.auth, tx, ctx, businessId, 'team.view');
      const where = { businessId };
      const rows = await tx.membership.findMany({ where, skip: (paging.page - 1) * paging.pageSize, take: paging.pageSize, orderBy: { id: 'asc' },
        select: { id: true, role: true, disabledAt: true, revision: true, permissionOverrides: true, user: { select: { id: true, name: true, email: true, disabledAt: true } } } });
      return { ...paging, total: await tx.membership.count({ where }), items: rows.map(row => ({
        id: row.id, userId: row.user.id, name: row.user.name, email: row.user.email, role: row.role,
        active: !row.disabledAt, accountDisabled: !!row.user.disabledAt, revision: row.revision,
        // Only owners managing permissions need the stored per-user overrides.
        ...(permissions['team.manage'] ? { permissionOverrides: row.permissionOverrides, permissions: effectivePermissions(row.role, row.permissionOverrides) } : {}),
      })) };
    });
  }
  async updateMember(ctx: AuthContext, businessId: string, memberId: string, patch: MemberPatch) {
    return this.auth.transaction(async tx => {
      await requireBusiness(this.auth, tx, ctx, businessId, 'team.manage');
      const member = await tx.membership.findFirst({ where: { id: memberId, businessId }, include: { user: { select: { disabledAt: true } } } });
      if (!member) throw missing();
      if (member.role === 'OWNER') throw new ApiError(403, 'OWNER_PROTECTED', 'Owner membership cannot be changed here');
      if (member.revision !== patch.revision) throw conflict();
      if (patch.active && member.user.disabledAt) throw new ApiError(409, 'ACCOUNT_DISABLED', 'The platform account is disabled');
      if (patch.active && member.disabledAt) await requireMemberCapacity(tx, businessId);
      const data: Prisma.MembershipUpdateManyMutationInput = { revision: { increment: 1 } };
      if (patch.role) data.role = patch.role;
      // Changing role resets prior overrides unless the caller explicitly supplies new ones.
      if (patch.permissionOverrides !== undefined) data.permissionOverrides = patch.permissionOverrides;
      else if (patch.role) data.permissionOverrides = {};
      if (patch.active !== undefined) data.disabledAt = patch.active ? null : new Date();
      const result = await tx.membership.updateMany({ where: { id: memberId, businessId, revision: patch.revision }, data });
      if (!result.count) throw conflict();
      const after = await tx.membership.findUniqueOrThrow({ where: { id: memberId } });
      await tx.authUser.update({ where: { id: member.userId }, data: { securityVersion: { increment: 1 } } });
      await tx.authSession.deleteMany({ where: { userId: member.userId } });
      if (patch.active === false) {
        await tx.invitation.updateMany({ where: { businessId, invitedBy: member.userId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.authAudit.create({ data: { userId: ctx.user.id, businessId, action: 'membership.updated', targetId: memberId,
        changes: { before: { role: member.role, active: !member.disabledAt, permissionOverrides: member.permissionOverrides }, after: { role: after.role, active: !after.disabledAt, permissionOverrides: after.permissionOverrides } } } });
      return { id: after.id, role: after.role, active: !after.disabledAt, revision: after.revision, permissionOverrides: after.permissionOverrides, permissions: effectivePermissions(after.role, after.permissionOverrides) };
    });
  }
  async roles(ctx: AuthContext, businessId: string) {
    return this.auth.transaction(async tx => {
      await requireBusiness(this.auth, tx, ctx, businessId, 'roles.view');
      return { permissions: PERMISSIONS, roles: roleCatalog() };
    });
  }
  async invitations(ctx: AuthContext, businessId: string, paging: Page) {
    return this.auth.transaction(async tx => {
      await requireBusiness(this.auth, tx, ctx, businessId, 'invitations.manage');
      const where = { businessId };
      const items = await tx.invitation.findMany({ where, take: paging.pageSize, skip: (paging.page - 1) * paging.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, email: true, role: true, invitedBy: true, createdAt: true, expiresAt: true, usedAt: true, revokedAt: true } });
      return { ...paging, total: await tx.invitation.count({ where }), items: items.map(row => ({ ...row, status: row.usedAt ? 'accepted' : row.revokedAt ? 'revoked' : row.expiresAt <= new Date() ? 'expired' : 'pending' })) };
    });
  }
  async revokeInvitation(ctx: AuthContext, businessId: string, invitationId: string) {
    await this.auth.transaction(async tx => {
      await requireBusiness(this.auth, tx, ctx, businessId, 'invitations.manage');
      const row = await tx.invitation.findFirst({ where: { id: invitationId, businessId } });
      if (!row) throw missing();
      if (row.usedAt) throw new ApiError(409, 'INVITATION_USED', 'Invitation has already been accepted');
      if (row.revokedAt) return;
      await tx.invitation.update({ where: { id: invitationId }, data: { revokedAt: new Date() } });
      await tx.authAudit.create({ data: { userId: ctx.user.id, businessId, action: 'invitation.revoked', targetId: invitationId } });
    });
  }
  async audit(ctx: AuthContext, businessId: string, paging: Page) {
    return this.auth.transaction(async tx => {
      await requireBusiness(this.auth, tx, ctx, businessId, 'audit.view');
      const where = { businessId };
      const rows = await tx.authAudit.findMany({ where, take: paging.pageSize, skip: (paging.page - 1) * paging.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, action: true, userId: true, targetId: true, changes: true, createdAt: true } });
      const actors = await tx.authUser.findMany({ where: { id: { in: rows.flatMap(row => row.userId ? [row.userId] : []) } }, select: { id: true, name: true } });
      const names = new Map(actors.map(user => [user.id, user.name]));
      return { ...paging, total: await tx.authAudit.count({ where }), items: rows.map(row => ({ ...row, actorName: row.userId ? names.get(row.userId) ?? null : null })) };
    });
  }
}
