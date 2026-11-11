import type { MembershipRole, Prisma } from '../generated/prisma/client.js';
// Only implemented business-level capabilities. Location-scoped operational
// permissions must be introduced with their services and location authorization.
export const PERMISSIONS = {
  'returns.view': { ownerOnly: false },
  'returns.create': { ownerOnly: false },
  'returns.approve': { ownerOnly: false },
  'counts.view': { ownerOnly: false },
  'counts.create': { ownerOnly: false },
  'counts.approve': { ownerOnly: false },
  'payments.view': { ownerOnly: false },
  'payments.manage': { ownerOnly: false },
  'cash.close': { ownerOnly: false },
  'reports.view': { ownerOnly: false },
  'migration.manage': { ownerOnly: true },
  'sales.view': { ownerOnly: false },
  'sales.create': { ownerOnly: false },
  'sales.discount': { ownerOnly: false },
  'sales.manage': { ownerOnly: false },
  'transfers.view': { ownerOnly: false },
  'transfers.create': { ownerOnly: false },
  'transfers.dispatch': { ownerOnly: false },
  'transfers.receive': { ownerOnly: false },
  'transfers.resolve': { ownerOnly: false },
  'inventory.view': { ownerOnly: false },
  'suppliers.view': { ownerOnly: false },
  'suppliers.manage': { ownerOnly: false },
  'purchasing.view': { ownerOnly: false },
  'purchasing.manage': { ownerOnly: false },
  'receiving.create': { ownerOnly: false },
  'receiving.confirm': { ownerOnly: false },
  'catalogue.view': { ownerOnly: false },
  'catalogue.manage': { ownerOnly: false },
  'catalogue.cost': { ownerOnly: false },
  'billing.manage': { ownerOnly: true },
  'locations.view': { ownerOnly: false },
  'locations.all': { ownerOnly: false },
  'locations.manage': { ownerOnly: true },
  'business.view': { ownerOnly: false },
  'business.edit': { ownerOnly: true },
  'team.view': { ownerOnly: false },
  'team.manage': { ownerOnly: true },
  'invitations.manage': { ownerOnly: true },
  'roles.view': { ownerOnly: false },
  'audit.view': { ownerOnly: false },
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const permissionKeys = Object.keys(PERMISSIONS) as Permission[];
export const staffRoles = ['OPERATIONS_MANAGER', 'WAREHOUSE_STAFF', 'SHOP_MANAGER', 'CASHIER', 'VIEWER'] as const;
export const ROLE_DEFAULTS: Record<MembershipRole, readonly Permission[]> = {
  OWNER: permissionKeys,
  OPERATIONS_MANAGER: ['returns.view','returns.create','returns.approve','counts.view','counts.create','counts.approve','payments.view','payments.manage','cash.close','reports.view','sales.view','sales.create','sales.discount','sales.manage','transfers.view','transfers.create','transfers.dispatch','transfers.receive','transfers.resolve','inventory.view','suppliers.view','suppliers.manage','purchasing.view','purchasing.manage','receiving.create','receiving.confirm','business.view', 'team.view', 'roles.view', 'audit.view', 'locations.view', 'locations.all', 'catalogue.view', 'catalogue.manage', 'catalogue.cost'],
  WAREHOUSE_STAFF: ['returns.view','returns.create','counts.view','counts.create','transfers.view','transfers.create','transfers.dispatch','transfers.receive','inventory.view','suppliers.view','purchasing.view','receiving.create','business.view', 'locations.view', 'catalogue.view'],
  SHOP_MANAGER: ['returns.view','returns.create','returns.approve','counts.view','counts.create','counts.approve','payments.view','payments.manage','cash.close','reports.view','sales.view','sales.create','sales.discount','sales.manage','transfers.view','transfers.create','transfers.dispatch','transfers.receive','inventory.view','suppliers.view','purchasing.view','receiving.create','business.view', 'locations.view', 'catalogue.view'],
  CASHIER: ['returns.view','returns.create','sales.view','sales.create','business.view', 'locations.view', 'catalogue.view'],
  VIEWER: ['reports.view','transfers.view','inventory.view','business.view', 'locations.view', 'catalogue.view'],
};
export function effectivePermissions(role: MembershipRole, overrides: Prisma.JsonValue) {
  const changes = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {};
  return Object.fromEntries(permissionKeys.map(key => [key,
    role === 'OWNER' ? true : PERMISSIONS[key].ownerOnly ? false
      : typeof changes[key] === 'boolean' ? changes[key] : ROLE_DEFAULTS[role].includes(key),
  ])) as Record<Permission, boolean>;
}
export function roleCatalog() {
  return Object.entries(ROLE_DEFAULTS).map(([role]) => ({ role, permissions: effectivePermissions(role as MembershipRole, {}) }));
}
