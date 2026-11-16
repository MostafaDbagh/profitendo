import {currencyDigits} from '../sales/money.js';
import {z} from 'zod';
import type {AuthService,AuthContext,Tx} from '../auth/service.js';
import {requireBusiness} from '../businesses/access.js';
import {hash,fail} from '../workflows/shared.js';
import {addLayers} from './fifo.js';
export const fifoActivation=z.object({snapshot:z.string().length(64),confirmed:z.literal(true),lines:z.array(z.object({balanceId:z.uuid(),unitCost:z.string().regex(/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/)}).strict()).max(1000)}).strict();
async function review(tx:Tx,bid:string){
 const business=await tx.business.findUniqueOrThrow({where:{id:bid}});
 const inTransit=await tx.stockTransfer.count({where:{businessId:bid,status:{in:['IN_TRANSIT','PARTIAL']}}});
 // Activated businesses need status, not a new opening-stock review.
 if(business.fifoStartedAt)return {activeSince:business.fifoStartedAt,currency:business.baseCurrency,inTransit,snapshot:hash({activatedAt:business.fifoStartedAt}),lines:[]};
 const rows=await tx.stockBalance.findMany({where:{businessId:bid,onHand:{gt:0}},include:{product:{select:{name:true,sku:true,purchasePrice:true}},location:{select:{name:true}}},orderBy:[{locationId:'asc'},{productId:'asc'}],take:1001});
 if(rows.length>1000)fail('FIFO_REVIEW_TOO_LARGE',422);
 const movements=await tx.stockMovement.count({where:{businessId:bid}});
 return {activeSince:business.fifoStartedAt,currency:business.baseCurrency,inTransit,snapshot:hash({revision:business.revision,movements,rows:rows.map(r=>[r.id,r.onHand.toFixed(4),r.product.purchasePrice.toFixed(4)])}),lines:rows.map(r=>({balanceId:r.id,locationId:r.locationId,productId:r.productId,location:r.location.name,name:r.product.name,sku:r.product.sku,quantity:r.onHand.toFixed(4),suggestedCost:r.product.purchasePrice.toFixed(4)}))};
}
export async function reviewFifo(auth:AuthService,ctx:AuthContext,bid:string){return auth.transaction(async tx=>{await requireBusiness(auth,tx,ctx,bid,'migration.manage');return review(tx,bid);});}
export async function activateFifo(auth:AuthService,ctx:AuthContext,bid:string,input:z.infer<typeof fifoActivation>){return auth.transaction(async tx=>{
 const access=await requireBusiness(auth,tx,ctx,bid,'migration.manage');
 await tx.$queryRaw`SELECT id FROM businesses WHERE id=${bid}::uuid FOR UPDATE`;
 const current=await review(tx,bid);if(current.activeSince)return {activeSince:current.activeSince};
 if(current.inTransit)fail('FIFO_TRANSFERS_OPEN');
 if(current.snapshot!==input.snapshot)fail('REVISION_CONFLICT');
 const costs=new Map(input.lines.map(l=>[l.balanceId,l.unitCost]));
 if(costs.size!==input.lines.length||costs.size!==current.lines.length||current.lines.some(l=>!costs.has(l.balanceId)))fail('FIFO_REVIEW_REQUIRED',422);
 const at=new Date();
 for(const line of current.lines)await addLayers(tx,{businessId:bid,locationId:line.locationId,productId:line.productId},[{quantity:line.quantity,unitCost:costs.get(line.balanceId)!,acquiredAt:at.toISOString(),originId:`opening:${line.balanceId}`}],currencyDigits(current.currency));
 await tx.business.update({where:{id:bid},data:{fifoStartedAt:at,currencyLockedAt:access.business.currencyLockedAt??at,revision:{increment:1}}});
 await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'inventory.fifo_activated',targetId:bid,changes:{snapshot:input.snapshot,openingLayers:current.lines.map(l=>({...l,unitCost:costs.get(l.balanceId)})),activatedAt:at.toISOString()}}});
 return {activeSince:at};
});}
