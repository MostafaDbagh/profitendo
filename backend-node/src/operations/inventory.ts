import { randomUUID } from 'node:crypto';
import type { AuthContext, AuthService, Tx } from '../auth/service.js';
import { requireLocation } from '../locations/access.js';
import { ApiError } from '../errors.js';
import { fixed, quantity, scaled } from './decimal.js';
// Internal posting primitive: callers must authorize every location inside the same
// serializable transaction. No public endpoint accepts arbitrary stock mutations.
export async function postStock(tx:Tx,input:{businessId:string;locationId:string;productId:string;delta:string;type:string;sourceId:string;sourceLineId:string;reference:string;actorId:string;notes:string}){
 if(!/^-?(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(input.delta)||scaled(input.delta)===0n)throw new ApiError(422,'INVALID_QUANTITY','Invalid stock quantity');
 const {delta,...data}=input;
 const prior=await tx.stockMovement.findUnique({where:{businessId_type_sourceLineId:{businessId:input.businessId,type:input.type,sourceLineId:input.sourceLineId}}});
 if(prior){
  if(prior.locationId!==input.locationId||prior.productId!==input.productId||prior.sourceId!==input.sourceId||scaled(prior.quantity.toFixed(4))!==scaled(delta))throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Posting key was used for different stock');
  return prior;
 }
 const key={businessId:input.businessId,locationId:input.locationId,productId:input.productId};
 // Ensure there is a lockable row even for first receipt. Serializable retries
 // cover concurrent inserts as well as concurrent changes to an existing balance.
 await tx.$executeRaw`INSERT INTO stock_balances(id,business_id,location_id,product_id) VALUES(${randomUUID()}::uuid,${key.businessId}::uuid,${key.locationId}::uuid,${key.productId}::uuid) ON CONFLICT(business_id,location_id,product_id) DO NOTHING`;
 await tx.$queryRaw`SELECT id FROM stock_balances WHERE business_id=${key.businessId}::uuid AND location_id=${key.locationId}::uuid AND product_id=${key.productId}::uuid FOR UPDATE`;
 const balance=await tx.stockBalance.findUniqueOrThrow({where:{businessId_locationId_productId:key}});
 const next=scaled(balance.onHand.toFixed(4))+scaled(delta);
 if(next<scaled(balance.reserved.toFixed(4)))throw new ApiError(409,'INSUFFICIENT_STOCK','Insufficient available stock');
 await tx.stockBalance.update({where:{id:balance.id},data:{onHand:quantity(next)}});
 return tx.stockMovement.create({data:{...data,quantity:delta}});
}
export class InventoryService{
 constructor(readonly auth:AuthService){}
 async list(ctx:AuthContext,businessId:string,locationId:string,page:number,search:string,movements:boolean){
  return this.auth.transaction(async tx=>{
   await requireLocation(this.auth,tx,ctx,businessId,locationId,'inventory.view',false);
   const where={businessId,locationId,...(search?{product:{OR:[{name:{contains:search,mode:'insensitive' as const}},{sku:{contains:search,mode:'insensitive' as const}},{barcodes:{some:{value:search}}}]}}:{})};
   if(movements){const rows=await tx.stockMovement.findMany({where,include:{product:{select:{name:true,sku:true,unit:true}}},skip:(page-1)*25,take:25,orderBy:[{createdAt:'desc'},{id:'desc'}]});
    return {page,pageSize:25,total:await tx.stockMovement.count({where}),items:rows.map(r=>({...r,quantity:r.quantity.toFixed(4)}))};}
   const rows=await tx.stockBalance.findMany({where,include:{product:{select:{name:true,sku:true,unit:true,minimumStock:true}}},skip:(page-1)*25,take:25,orderBy:{product:{name:'asc'}}});
   return {page,pageSize:25,total:await tx.stockBalance.count({where}),items:rows.map(r=>({...r,onHand:r.onHand.toFixed(4),reserved:r.reserved.toFixed(4),available:fixed(scaled(r.onHand.toFixed(4))-scaled(r.reserved.toFixed(4))),lowStock:r.onHand.minus(r.reserved).lte(r.product.minimumStock),product:{...r.product,minimumStock:r.product.minimumStock.toFixed(4)}}))};
  });
 }
}
