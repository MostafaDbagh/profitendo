import type { AuthService, AuthContext, Tx } from '../auth/service.js';
import { requireBusiness } from '../businesses/access.js';
import type { Permission } from '../businesses/permissions.js';
import { ApiError } from '../errors.js';
// Stock writes must call this inside their transaction for EACH location whose
// balance changes. Documents also enforce their workflow's route scope: transfer
// creation needs both endpoints; dispatch/arrival authorize the affected endpoint.
// A business membership alone is insufficient.
export async function requireLocation(auth: AuthService, tx: Tx, ctx: AuthContext, businessId: string, locationId: string, permission: Permission = 'locations.view', active = true) {
  const access = await requireBusiness(auth,tx,ctx,businessId,permission);
  if (!access.permissions['locations.view']) throw new ApiError(403,'FORBIDDEN','Location access is not available');
  const location = await tx.location.findFirst({where:{id:locationId,businessId,
    ...(access.permissions['locations.all'] ? {} : {assignments:{some:{membershipId:access.membership.id,businessId}}})}});
  if (!location) throw new ApiError(404,'NOT_FOUND','Location not found');
  if (active && location.archivedAt) throw new ApiError(409,'LOCATION_ARCHIVED','This location is archived');
  return {...access,location};
}
