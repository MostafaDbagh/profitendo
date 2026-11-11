import type { Prisma } from '../generated/prisma/client.js';
import type { AuthContext, AuthService, Tx } from '../auth/service.js';
import { requireBusiness } from '../businesses/access.js';
import { ApiError } from '../errors.js';
import { fixed, scaled } from '../operations/decimal.js';
export type Transfer=Prisma.StockTransferGetPayload<{include:{lines:true}}>;
export type Access=Awaited<ReturnType<typeof transferAccess>>;
export const remaining=(l:Transfer['lines'][number])=>scaled(l.quantity.toFixed(4))-scaled(l.received.toFixed(4))-scaled(l.returned.toFixed(4))-scaled(l.lost.toFixed(4));
export async function transferAccess(auth:AuthService,tx:Tx,ctx:AuthContext,businessId:string){
 const access=await requireBusiness(auth,tx,ctx,businessId,'transfers.view');
 if(!access.permissions['locations.view'])throw new ApiError(403,'FORBIDDEN','Location access required');
 const ids=access.permissions['locations.all']?[]:(await tx.location.findMany({where:{businessId,...(access.permissions['locations.all']?{}:{assignments:{some:{businessId,membershipId:access.membership.id}}})},select:{id:true}})).map(l=>l.id);
 return {...access,locationIds:ids};
}
export function scope(businessId:string,access:Access):Prisma.StockTransferWhereInput{
 return {businessId,...(access.permissions['locations.all']?{}:{OR:[{sourceId:{in:access.locationIds}},{destinationId:{in:access.locationIds}}]})};
}
export function present(doc:Transfer,access:Access){
 const {requestHash,clientKey,...data}=doc;
 const source=access.permissions['locations.all']||access.locationIds.includes(doc.sourceId),destination=access.permissions['locations.all']||access.locationIds.includes(doc.destinationId),moving=['IN_TRANSIT','PARTIAL'].includes(doc.status);
 return {...data,lines:doc.lines.map(l=>({...l,quantity:l.quantity.toFixed(4),received:l.received.toFixed(4),returned:l.returned.toFixed(4),lost:l.lost.toFixed(4),
  inTransit:doc.dispatchedAt?fixed(remaining(l)):'0.0000'})),
  capabilities:{
   edit:doc.status==='DRAFT'&&source&&destination&&access.permissions['transfers.create'],
   cancel:doc.status==='DRAFT'&&source&&destination&&access.permissions['transfers.create'],
   dispatch:doc.status==='DRAFT'&&source&&access.permissions['transfers.dispatch'],
   receive:moving&&destination&&access.permissions['transfers.receive'],
   resolve:moving&&source&&destination&&access.permissions['transfers.resolve'],
  }};
}
