import {createHash} from 'node:crypto';
import {ApiError} from '../errors.js';
import type {AuthService,AuthContext,Tx} from '../auth/service.js';
import type {Permission} from '../businesses/permissions.js';
import {requireBusiness} from '../businesses/access.js';
import {billingState} from '../billing/entitlements.js';
export function fail(code:string,status=409):never{throw new ApiError(status,code,code);}
export const hash=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
export async function entitled(tx:Tx,bid:string){if(!(await billingState(tx,bid)).active)fail('SUBSCRIPTION_REQUIRED',402);}
export async function locationScope(auth:AuthService,tx:Tx,ctx:AuthContext,bid:string,permission:Permission){const a=await requireBusiness(auth,tx,ctx,bid,permission);if(!a.permissions['locations.view'])fail('FORBIDDEN',403);return {access:a,where:{businessId:bid,...(a.permissions['locations.all']?{}:{location:{assignments:{some:{businessId:bid,membershipId:a.membership.id}}}})}};}
export const isReturn=(kind:string)=>kind==='CUSTOMER_RETURN'||kind==='SUPPLIER_RETURN';
export const permission=(kind:string,action:'view'|'create'|'approve'):Permission=>kind==='OPENING'?'migration.manage':`${isReturn(kind)?'returns':'counts'}.${action}` as Permission;
// Append-only history makes its row count a monotonic revision. Unlike sorting
// timestamps/UUIDs, this also detects movements posted in the same millisecond.
export async function stockSnapshot(tx:Tx,bid:string,locationId:string,productId:string){
 const count=await tx.stockMovement.count({where:{businessId:bid,locationId,productId}});if(!count)return null;
 const h=hash({bid,locationId,productId,count});return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
