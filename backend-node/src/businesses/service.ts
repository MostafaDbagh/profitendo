import { customRole, customRoleCatalog, roleGrants } from './custom-roles.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuthService, AuthContext } from '../auth/service.js';
import { billingState, requireMemberCapacity } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
import { requireBusiness } from './access.js';
import { effectivePermissions, PERMISSIONS, permissionKeys, roleCatalog, type Permission } from './permissions.js';
export type Page = { page: number; pageSize: number };
export type BusinessPatch = { revision: number; salesTaxRate?: string; name?: string; baseCurrency?: string; timezone?: string; dateFormat?: string; numberFormat?: string };
export type MemberPatch = { revision: number; customRoleId?: string | null; role?: 'OPERATIONS_MANAGER' | 'WAREHOUSE_STAFF' | 'SHOP_MANAGER' | 'CASHIER' | 'VIEWER'; permissionOverrides?: Partial<Record<Permission, boolean>>; active?: boolean };
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
      const state = await billingState(tx, businessId);
      const subscriptionAccess = { active: state.active, status: state.status, endsAt: state.subscription?.trialEndsAt ?? null, paid: !!state.paidUntil };
      return { subscriptionAccess, business: access.business, hiddenTabs: access.membership.hiddenTabs, tabOrder: access.membership.tabOrder, membershipId: access.membership.id, role: access.membership.role, permissions: access.permissions };
    });
  }
  async preferences(ctx: AuthContext, businessId: string, hiddenTabs: string[], tabOrder?: string[]) {
    return this.auth.transaction(async tx => {
      const { membership } = await requireBusiness(this.auth, tx, ctx, businessId, 'business.view');
      const updated = await tx.membership.update({ where: { id: membership.id }, data: { hiddenTabs: [...new Set(hiddenTabs)], ...(tabOrder !== undefined ? { tabOrder } : {}) } });
      return { hiddenTabs: updated.hiddenTabs, tabOrder: updated.tabOrder };
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
      const { permissions, membership: actor } = await requireBusiness(this.auth, tx, ctx, businessId, 'team.view');
      const where = { businessId };
      const rows = await tx.membership.findMany({ where, skip: (paging.page - 1) * paging.pageSize, take: paging.pageSize, orderBy: { id: 'asc' },
        select: { id: true, role: true, customRoleId: true, customRole: { select: { name: true } }, disabledAt: true, revision: true, permissionOverrides: true, user: { select: { id: true, name: true, email: true, disabledAt: true } } } });
      return { ...paging, permissionKeys: permissions['team.manage'] ? permissionKeys.filter(key=>!PERMISSIONS[key].ownerOnly && (actor.role==='OWNER'||key!=='team.manage')) : [], roleDefaults: permissions['team.manage'] ? [...roleCatalog(), ...await customRoleCatalog(tx, businessId)] : [], total: await tx.membership.count({ where }), items: rows.map(row => ({
        canEdit: permissions['team.manage'] && row.role!=='OWNER' && (actor.role==='OWNER'||row.user.id!==ctx.user.id&&!effectivePermissions(row.role,row.permissionOverrides)['team.manage']),
        id: row.id, userId: row.user.id, name: row.user.name, email: row.user.email, role: row.role, customRoleId: row.customRoleId, roleName: row.customRole?.name,
        active: !row.disabledAt, accountDisabled: !!row.user.disabledAt, revision: row.revision,
        // Only authorized permission administrators receive stored overrides.
        ...(permissions['team.manage'] ? { permissionOverrides: row.permissionOverrides, permissions: effectivePermissions(row.role, row.permissionOverrides) } : {}),
      })) };
    });
  }
  async updateMember(ctx: AuthContext, businessId: string, memberId: string, requestedPatch: MemberPatch) {
    return this.auth.transaction(async tx => {
      // Retries must resolve the original request, not a previously expanded role.
      let patch = requestedPatch;
      const actor = await requireBusiness(this.auth, tx, ctx, businessId, 'team.manage');
      const member = await tx.membership.findFirst({ where: { id: memberId, businessId }, include: { user: { select: { disabledAt: true } } } });
      if (!member) throw missing();
      if (member.role === 'OWNER') throw new ApiError(403, 'OWNER_PROTECTED', 'Owner membership cannot be changed here');
      // Resolve only within this tenant; never trust client-provided preset grants.
      const suppliedOverrides = patch.permissionOverrides;
      if (patch.customRoleId) {
        const selected = await customRole(tx, businessId, patch.customRoleId);
        patch = { ...patch, role: 'VIEWER', permissionOverrides: { ...roleGrants(selected.permissions), ...suppliedOverrides } };
        if (actor.membership.role !== 'OWNER' && patch.permissionOverrides?.['team.manage']) throw new ApiError(403, 'FORBIDDEN', 'Only owners may delegate administrators');
      }
      if(actor.membership.role!=='OWNER'){
        const before=effectivePermissions(member.role,member.permissionOverrides);
        if(member.userId===ctx.user.id||before['team.manage']||suppliedOverrides?.['team.manage']!==undefined)throw new ApiError(403,'FORBIDDEN','Only the owner may change delegated administrators');
        const after=effectivePermissions(patch.role??member.role,patch.permissionOverrides??(patch.role?{}:member.permissionOverrides));
        if(permissionKeys.some(key=>after[key]&&!actor.permissions[key]&&(!before[key]||patch.active&&member.disabledAt)))throw new ApiError(403,'FORBIDDEN','Cannot grant permissions beyond your own access');
      }
      if (member.revision !== patch.revision) throw conflict();
      if (patch.active && member.user.disabledAt) throw new ApiError(409, 'ACCOUNT_DISABLED', 'The platform account is disabled');
      if (patch.active && member.disabledAt) await requireMemberCapacity(tx, businessId);
      const data: Prisma.MembershipUncheckedUpdateManyInput = { revision: { increment: 1 } };
      if (patch.role) data.role = patch.role;
      if (patch.customRoleId !== undefined) data.customRoleId = patch.customRoleId;
      else if (patch.role) data.customRoleId = null;
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
        await tx.invitation.updateMany({ where: { businessId, invitedBy: member.userId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date(), initialPasswordHash: null } });
      }
      await tx.authAudit.create({ data: { userId: ctx.user.id, businessId, action: 'membership.updated', targetId: memberId,
        changes: { before: { customRoleId: member.customRoleId, role: member.role, active: !member.disabledAt, permissionOverrides: member.permissionOverrides }, after: { customRoleId: after.customRoleId, role: after.role, active: !after.disabledAt, permissionOverrides: after.permissionOverrides } } } });
      return { id: after.id, customRoleId: after.customRoleId, role: after.role, active: !after.disabledAt, revision: after.revision, permissionOverrides: after.permissionOverrides, permissions: effectivePermissions(after.role, after.permissionOverrides) };
    });
  }
  async roles(ctx: AuthContext, businessId: string) {
    return this.auth.transaction(async tx => {
      const actor = await requireBusiness(this.auth, tx, ctx, businessId, 'roles.view');
      return { permissions: PERMISSIONS, roles: [...roleCatalog(), ...await customRoleCatalog(tx, businessId)],
        canCreate: actor.permissions['team.manage'],
        grantableKeys: permissionKeys.filter(key => !PERMISSIONS[key].ownerOnly && actor.permissions[key] && (actor.membership.role === 'OWNER' || key !== 'team.manage')) };

    });
  }
  async createRole(ctx: AuthContext, businessId: string, input: { name: string; permissions: Partial<Record<Permission, boolean>> }) {
    return this.auth.transaction(async tx => {
      const actor = await requireBusiness(this.auth, tx, ctx, businessId, 'team.manage');
      const name = input.name.normalize('NFKC').trim().replace(/\s+/gu, ' '), nameKey = name.toLowerCase();
      if (name.length < 2 || name.length > 80) throw new ApiError(422, 'VALIDATION_ERROR', 'Enter a role name between 2 and 80 characters');
      if (Object.keys(input.permissions).some(key => !permissionKeys.includes(key as Permission) || PERMISSIONS[key as Permission].ownerOnly)) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid permission');
      const grants = Object.fromEntries(permissionKeys.filter(key => !PERMISSIONS[key].ownerOnly).map(key => [key, key === 'business.view' || input.permissions[key] === true])) as Partial<Record<Permission, boolean>>;
      if (permissionKeys.some(key => grants[key] && (!actor.permissions[key] || key === 'team.manage' && actor.membership.role !== 'OWNER'))) throw new ApiError(403, 'FORBIDDEN', 'Cannot grant permissions beyond your own access');
      // Serialize duplicate checks and resource bounds per tenant.
      await tx.$queryRaw`SELECT id FROM businesses WHERE id=${businessId}::uuid FOR UPDATE`;
      if (await tx.businessRole.findUnique({ where: { businessId_nameKey: { businessId, nameKey } } })) throw new ApiError(409, 'ROLE_NAME_EXISTS', 'A role with this name already exists');
      if (await tx.businessRole.count({ where: { businessId } }) >= 100) throw new ApiError(409, 'ROLE_LIMIT_REACHED', 'Custom role limit reached');
      const role = await tx.businessRole.create({ data: { businessId, name, nameKey, permissions: grants } });
      await tx.authAudit.create({ data: { userId: ctx.user.id, businessId, action: 'role.created', targetId: role.id, changes: { name, permissions: grants } } });
      return { role: role.id, name: role.name, custom: true, permissions: effectivePermissions('VIEWER', role.permissions) };
    });
  }
  async invitations(ctx: AuthContext, businessId: string, paging: Page) {
    return this.auth.transaction(async tx => {
      await requireBusiness(this.auth, tx, ctx, businessId, 'invitations.manage');
      const where = { businessId };
      const items = await tx.invitation.findMany({ where, take: paging.pageSize, skip: (paging.page - 1) * paging.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, name: true, email: true, role: true, customRoleId: true, customRole: { select: { name: true } }, invitedBy: true, createdAt: true, expiresAt: true, usedAt: true, revokedAt: true } });
      return { ...paging, total: await tx.invitation.count({ where }), items: items.map(row => ({ ...row, roleName: row.customRole?.name, status: row.usedAt ? 'accepted' : row.revokedAt ? 'revoked' : row.expiresAt <= new Date() ? 'expired' : 'pending' })) };
    });
  }
  async revokeInvitation(ctx: AuthContext, businessId: string, invitationId: string) {
    await this.auth.transaction(async tx => {
      await requireBusiness(this.auth, tx, ctx, businessId, 'invitations.manage');
      const row = await tx.invitation.findFirst({ where: { id: invitationId, businessId } });
      if (!row) throw missing();
      if (row.usedAt) throw new ApiError(409, 'INVITATION_USED', 'Invitation has already been accepted');
      if (row.revokedAt) return;
      await tx.invitation.update({ where: { id: invitationId }, data: { revokedAt: new Date(), initialPasswordHash: null } });
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
