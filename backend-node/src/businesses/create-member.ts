import type {MembershipRole} from '../generated/prisma/client.js';
import {AuthService, type AuthContext} from '../auth/service.js';
import {passwordHash} from '../auth/crypto.js';
import {requireBusiness} from './access.js';
import {customRole,roleGrants} from './custom-roles.js';
import {effectivePermissions,permissionKeys} from './permissions.js';
import {requireLocation} from '../locations/access.js';
import {requireMemberCapacity} from '../billing/entitlements.js';
import {ApiError} from '../errors.js';
export async function createMember(auth:AuthService,ctx:AuthContext,input:{businessId:string;name:string;email:string;password:string;role?:Exclude<MembershipRole,'OWNER'>;customRoleId?:string;locationIds:string[]}){
 // Reject unauthorized callers before spending CPU on password hashing.
 // The write transaction still rechecks authority to prevent revocation races.
 await auth.transaction(tx=>requireBusiness(auth,tx,ctx,input.businessId,'team.manage'));
 const hash=await passwordHash(input.password);
 return auth.transaction(async tx=>{
  const actor=await requireBusiness(auth,tx,ctx,input.businessId,'team.manage');
  const selected=input.customRoleId?await customRole(tx,input.businessId,input.customRoleId):null;
  const grants=effectivePermissions(selected?'VIEWER':input.role!,selected?.permissions??{});
  if(actor.membership.role!=='OWNER'&&(grants['team.manage']||permissionKeys.some(k=>grants[k]&&!actor.permissions[k])))throw new ApiError(403,'FORBIDDEN','Cannot grant access beyond your own');
  const locationIds=[...new Set(input.locationIds)];
  if(!grants['locations.all']&&!locationIds.length)throw new ApiError(422,'MEMBER_LOCATION_REQUIRED','Choose a warehouse or shop');
  for(const id of locationIds)await requireLocation(auth,tx,ctx,input.businessId,id,'locations.manage');
  if(await tx.authUser.findUnique({where:{email:input.email}}))throw new ApiError(409,'MEMBER_EMAIL_EXISTS','An account already uses this email');
  await requireMemberCapacity(tx,input.businessId,{email:input.email});
  const user=await tx.authUser.create({data:{name:input.name,email:input.email,passwordHash:hash}});
  const member=await tx.membership.create({data:{businessId:input.businessId,userId:user.id,role:selected?'VIEWER':input.role!,customRoleId:selected?.id,...(selected?{permissionOverrides:roleGrants(selected.permissions)}:{})}});
  if(locationIds.length)await tx.locationAssignment.createMany({data:locationIds.map(locationId=>({businessId:input.businessId,membershipId:member.id,locationId}))});
  await tx.invitation.updateMany({where:{businessId:input.businessId,email:input.email,usedAt:null,revokedAt:null},data:{revokedAt:new Date(),initialPasswordHash:null}});
  await auth.audit(tx,'membership.created',ctx.user.id,input.businessId);
  return {id:member.id};
 });
}
