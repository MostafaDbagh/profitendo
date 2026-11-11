import {z} from 'zod';
import type {AuthService,AuthContext} from '../auth/service.js';
import {requireLocation} from '../locations/access.js';
import {positive} from '../operations/contracts.js';
import {fail,hash,entitled,stockSnapshot} from '../workflows/shared.js';
import {WorkflowService} from '../workflows/service.js';
import {adjustmentSchema} from '../workflows/contracts.js';
export const previewSchema=z.object({clientKey:z.uuid(),locationId:z.uuid(),reason:z.string().trim().min(5).max(2000),rows:z.array(z.object({sku:z.string().trim().min(1).max(80),quantity:positive}).strict()).min(1).max(100)}).strict().refine(v=>new Set(v.rows.map(r=>r.sku)).size===v.rows.length);
export class MigrationService{
 constructor(readonly auth:AuthService){}
 async preview(ctx:AuthContext,bid:string,input:z.infer<typeof previewSchema>){return this.auth.transaction(async tx=>{
  await requireLocation(this.auth,tx,ctx,bid,input.locationId,'migration.manage');await entitled(tx,bid);
  const previous=await tx.migrationPreview.findUnique({where:{businessId_clientKey:{businessId:bid,clientKey:input.clientKey}}});if(previous){if(previous.requestHash!==hash(input))fail('IDEMPOTENCY_CONFLICT');return previous;}
  const lines=[];for(const row of input.rows){const p=await tx.product.findUnique({where:{businessId_sku:{businessId:bid,sku:row.sku}}});if(!p||!p.active)fail('MIGRATION_SKU_INVALID',422);if(await stockSnapshot(tx,bid,input.locationId,p.id))fail('OPENING_STOCK_EXISTS');lines.push({productId:p.id,quantity:row.quantity,condition:'RESTOCK' as const});}
  const payload={clientKey:input.clientKey,kind:'OPENING',locationId:input.locationId,reason:input.reason,lines};
  return tx.migrationPreview.create({data:{businessId:bid,locationId:input.locationId,clientKey:input.clientKey,requestHash:hash(input),payload,actorId:ctx.user.id,expiresAt:new Date(Date.now()+30*60*1000)}});
 });}
 async confirm(ctx:AuthContext,bid:string,id:string){
  // Preview only creates a draft. Approval uses the same opening-stock workflow,
  // which rechecks live authority and unchanged stock before an atomic posting.
  const preview=await this.auth.transaction(async tx=>{const p=await tx.migrationPreview.findFirst({where:{id,businessId:bid}});if(!p)fail('NOT_FOUND',404);await requireLocation(this.auth,tx,ctx,bid,p.locationId,'migration.manage');if(p.expiresAt<=new Date()&&!p.completedId&&!(await tx.adjustment.findFirst({where:{businessId:bid,clientKey:p.clientKey,status:'COMPLETED'}})))fail('MIGRATION_EXPIRED');return p;});
  const workflow=new WorkflowService(this.auth),draft=await workflow.create(ctx,bid,adjustmentSchema.parse(preview.payload));
  const result=draft.status==='COMPLETED'?draft:await workflow.transition(ctx,bid,draft.id,{revision:draft.revision,action:'confirm'});
  await this.auth.transaction(async tx=>{await requireLocation(this.auth,tx,ctx,bid,preview.locationId,'migration.manage',false);await tx.migrationPreview.update({where:{id},data:{completedId:result.id}});});return result;
 }
 async readiness(ctx:AuthContext,bid:string){return this.auth.transaction(async tx=>{
  const {requireBusiness}=await import('../businesses/access.js');await requireBusiness(this.auth,tx,ctx,bid,'migration.manage');
  const stock=await tx.$queryRaw<{mismatches:bigint}[]>`SELECT COUNT(*)::bigint AS mismatches FROM (SELECT COALESCE(b.location_id,m.location_id),COALESCE(b.product_id,m.product_id) FROM stock_balances b FULL JOIN (SELECT business_id,location_id,product_id,SUM(quantity) AS total FROM stock_movements WHERE business_id=${bid}::uuid GROUP BY business_id,location_id,product_id) m ON b.business_id=m.business_id AND b.location_id=m.location_id AND b.product_id=m.product_id WHERE (b.business_id=${bid}::uuid OR m.business_id=${bid}::uuid) AND COALESCE(b.on_hand,0)<>COALESCE(m.total,0)) mismatch`;
  return {stockLedgerMismatches:Number(stock[0]!.mismatches),openTransfers:await tx.stockTransfer.count({where:{businessId:bid,status:{in:['IN_TRANSIT','PARTIAL']}}}),openReceipts:await tx.purchaseDocument.count({where:{businessId:bid,kind:'RECEIPT',status:{in:['DRAFT','PENDING']}}}),pendingAdjustments:await tx.adjustment.count({where:{businessId:bid,status:'DRAFT'}}),activeLocations:await tx.location.count({where:{businessId:bid,archivedAt:null}}),products:await tx.product.count({where:{businessId:bid}}),commercialReady:false,remainingGates:['billing','catalogue_followups','production_backup_restore','customer_data_reconciliation','physical_scanner_printer_pilot','local_compliance','owner_cutover_approval']};
 });}
}
