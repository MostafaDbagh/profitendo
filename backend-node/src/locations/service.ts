import type { AuthService, AuthContext, Tx } from '../auth/service.js';
import { requireBusiness } from '../businesses/access.js';
import { requireLocation } from './access.js';
import { billingState, lockCapacity } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
import { effectivePermissions } from '../businesses/permissions.js';
export type LocationInput = {code:string;name:string;kind:'WAREHOUSE'|'SHOP';address:string};
export type LocationPatch = {revision:number;name?:string;address?:string;active?:boolean};
const conflict = () => new ApiError(409,'REVISION_CONFLICT','Reload before saving');
async function capacity(tx:Tx,businessId:string,kind:string) {
  await lockCapacity(tx,businessId);
  const state=await billingState(tx,businessId);
  if(!state.active || !state.subscription)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','An active subscription is required to add locations');
  const used=await tx.location.count({where:{businessId,kind,archivedAt:null}}),limit=kind==='WAREHOUSE'?state.subscription.plan.maxWarehouses:state.subscription.plan.maxShops;
  if(used>=limit)throw new ApiError(409,'LOCATION_LIMIT_REACHED','Your plan location limit has been reached');
}
export class LocationService {
  constructor(readonly auth:AuthService){}
  async list(ctx:AuthContext,businessId:string,query:{page:number;state:'active'|'archived'|'all';kind?:string;search?:string}){
    return this.auth.transaction(async tx=>{
      const access=await requireBusiness(this.auth,tx,ctx,businessId,'locations.view');
      const where={businessId,...(query.state==='all'?{}:{archivedAt:query.state==='active'?null:{not:null}}),...(query.kind?{kind:query.kind}:{}),
        ...(query.search?{OR:[{name:{contains:query.search,mode:'insensitive' as const}},{code:{contains:query.search,mode:'insensitive' as const}}]}:{}),
        ...(access.permissions['locations.all']?{}:{assignments:{some:{businessId,membershipId:access.membership.id}}})};
      return {page:query.page,pageSize:25,total:await tx.location.count({where}),items:await tx.location.findMany({where,skip:(query.page-1)*25,take:25,orderBy:[{name:'asc'},{id:'asc'}]})};
    });
  }
  async create(ctx:AuthContext,businessId:string,input:LocationInput){
    try{return await this.auth.transaction(async tx=>{
      await requireBusiness(this.auth,tx,ctx,businessId,'locations.manage');await capacity(tx,businessId,input.kind);
      const location=await tx.location.create({data:{businessId,...input}});
      await tx.authAudit.create({data:{userId:ctx.user.id,businessId,action:'location.created',targetId:location.id,changes:{...input}}});return location;
    });}catch(error){if((error as {code?:string}).code==='P2002')throw new ApiError(409,'LOCATION_CODE_EXISTS','This location code is already used');throw error;}
  }
  async update(ctx:AuthContext,businessId:string,id:string,patch:LocationPatch){
    return this.auth.transaction(async tx=>{
      const {location}=await requireLocation(this.auth,tx,ctx,businessId,id,'locations.manage',false);
      if(location.revision!==patch.revision)throw conflict();
      if(patch.active && location.archivedAt)await capacity(tx,businessId,location.kind);
      const data={...(patch.name===undefined?{}:{name:patch.name}),...(patch.address===undefined?{}:{address:patch.address}),
        ...(patch.active===undefined?{}:{archivedAt:patch.active?null:location.archivedAt??new Date()})};
      if(patch.active===false){
        const stock=await tx.stockBalance.count({where:{businessId,locationId:id,OR:[{onHand:{gt:0}},{reserved:{gt:0}}]}});
        const open=await tx.purchaseDocument.count({where:{businessId,locationId:id,status:{in:['DRAFT','PENDING','OPEN','PARTIAL']}}});
        if(await tx.sale.count({where:{businessId,locationId:id,status:'DRAFT',expiresAt:{gt:new Date()}}}))throw new ApiError(409,'LOCATION_OPEN_SALES','Cancel active sale drafts first');
        if(await tx.adjustment.count({where:{businessId,locationId:id,status:'DRAFT'}}))throw new ApiError(409,'LOCATION_IN_USE','Resolve adjustment drafts first');
        const transfers=await tx.stockTransfer.count({where:{businessId,OR:[{sourceId:id},{destinationId:id}],status:{in:['DRAFT','IN_TRANSIT','PARTIAL']}}});
        if(stock||open||transfers)throw new ApiError(409,'LOCATION_IN_USE','Clear stock and open documents before archiving');
      }
      const result=await tx.location.updateMany({where:{id,businessId,revision:patch.revision},data:{...data,revision:{increment:1}}});
      if(!result.count)throw conflict();
      // Archived locations lose explicit assignments; reactivation never silently
      // restores access to staff who may have moved to a different branch.
      if(patch.active===false)await tx.locationAssignment.deleteMany({where:{businessId,locationId:id}});
      await tx.authAudit.create({data:{userId:ctx.user.id,businessId,action:'location.updated',targetId:id,changes:{...patch}}});
      return tx.location.findUniqueOrThrow({where:{id}});
    });
  }
  async assignments(ctx:AuthContext,businessId:string,id:string,page:number){
    return this.auth.transaction(async tx=>{
      const {location}=await requireLocation(this.auth,tx,ctx,businessId,id,'locations.manage',false);
      const where={businessId};
      const items=await tx.membership.findMany({where,skip:(page-1)*25,take:25,orderBy:{id:'asc'},select:{id:true,role:true,permissionOverrides:true,disabledAt:true,user:{select:{name:true,email:true,disabledAt:true}},locationAssignments:{where:{locationId:id},select:{id:true}}}});
      return {page,pageSize:25,total:await tx.membership.count({where}),revision:location.revision,items:items.map(m=>({id:m.id,role:m.role,name:m.user.name,email:m.user.email,active:!m.disabledAt&&!m.user.disabledAt,assigned:m.locationAssignments.length>0,allLocations:effectivePermissions(m.role,m.permissionOverrides)['locations.all']}))};
    });
  }
  async assign(ctx:AuthContext,businessId:string,id:string,input:{revision:number;membershipId:string;assigned:boolean}){
    return this.auth.transaction(async tx=>{
      const {location}=await requireLocation(this.auth,tx,ctx,businessId,id,'locations.manage',false);
      if(location.revision!==input.revision)throw conflict();
      const member=await tx.membership.findFirst({where:{id:input.membershipId,businessId},include:{user:{select:{disabledAt:true}}}});
      if(!member)throw new ApiError(404,'NOT_FOUND','Team member not found');
      if(input.assigned && (location.archivedAt||member.disabledAt||member.user.disabledAt))throw new ApiError(409,'ASSIGNMENT_UNAVAILABLE','Choose an active location and team member');
      const where={businessId,locationId:id,membershipId:member.id};
      const existing=await tx.locationAssignment.findFirst({where});
      if(!!existing===input.assigned)return {revision:location.revision};
      if(input.assigned)await tx.locationAssignment.create({data:where});else await tx.locationAssignment.deleteMany({where});
      const result=await tx.location.updateMany({where:{id,businessId,revision:input.revision},data:{revision:{increment:1}}});if(!result.count)throw conflict();
      await tx.authAudit.create({data:{userId:ctx.user.id,businessId,action:'location.assignment.updated',targetId:id,changes:{membershipId:member.id,assigned:input.assigned}}});
      return {revision:location.revision+1};
    });
  }
}
