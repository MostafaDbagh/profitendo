import type { Tx } from '../auth/service.js';
import { ApiError } from '../errors.js';
import { effectivePermissions, PERMISSIONS, permissionKeys, type Permission } from './permissions.js';

export async function customRole(tx: Tx, businessId: string, id: string) {
  const role = await tx.businessRole.findFirst({ where: { id, businessId } });
  if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role not found');
  return role;
}
export function roleGrants(permissions: Parameters<typeof effectivePermissions>[1]) {
  const resolved = effectivePermissions('VIEWER', permissions);
  return Object.fromEntries(permissionKeys.filter(key => !PERMISSIONS[key].ownerOnly).map(key => [key, resolved[key]])) as Partial<Record<Permission, boolean>>;
}
export async function customRoleCatalog(tx: Tx, businessId: string) {
  const rows = await tx.businessRole.findMany({ where: { businessId }, orderBy: { name: 'asc' } });
  return rows.map(row => ({ role: row.id, name: row.name, custom: true, permissions: effectivePermissions('VIEWER', row.permissions) }));
}
