import { z } from 'zod';
import { analyzeLegacy } from './legacy.js';
import { scaled } from '../operations/decimal.js';
const quantity=z.string().regex(/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/);
const reviewSchema=z.object({sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),sourceCounts:z.record(z.string(),z.number().int().nonnegative()),currency:z.string().regex(/^[A-Z]{3}$/),products:z.array(z.object({sku:z.string(),baseUnit:z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/),allocations:z.array(z.object({locationId:z.string().uuid(),quantity})).max(1000)})).max(100000),openingBalancesReviewed:z.literal(true),reviewedBy:z.string().trim().min(2).max(160),evidence:z.object({sourceCounts:z.string().min(1),openingBalances:z.string().min(1),hardwarePilot:z.string().min(1),fiscalRequirements:z.string().min(1)})}).strict();
// Validates an owner's allocation review. Does not infer missing locations or debt.
export function validateMigrationReview(raw:string,review:unknown){
 const source=analyzeLegacy(raw),r=reviewSchema.parse(review),issues=[...source.issues];
 if(r.sourceSha256!==source.sourceSha256)issues.push('Source hash changed; repeat the review');
 for(const [name,count] of Object.entries(source.collectionCounts))if(r.sourceCounts[name]!==count)issues.push(`Source count mismatch: ${name}`);
 const seen=new Set<string>();
 for(const p of r.products){
  if(seen.has(p.sku))issues.push(`Duplicate allocation SKU: ${p.sku}`);seen.add(p.sku);
  const original=source.products.find(x=>x.sku===p.sku);if(!original){issues.push(`Unknown SKU: ${p.sku}`);continue;}
  if(original.currency&&original.currency!==r.currency)issues.push(`Currency mismatch: ${p.sku}`);
  if(new Set(p.allocations.map(a=>a.locationId)).size!==p.allocations.length)issues.push(`Duplicate location: ${p.sku}`);
  if(quantity.safeParse(original.legacyStock).success&&p.allocations.reduce((sum,a)=>sum+scaled(a.quantity),0n)!==scaled(original.legacyStock))issues.push(`Stock allocation mismatch: ${p.sku}`);
 }
 for(const p of source.products)if(!seen.has(p.sku))issues.push(`Missing allocation: ${p.sku}`);
 return {sourceSha256:source.sourceSha256,reviewedBy:r.reviewedBy,issues,readyForOpeningReview:issues.length===0,productionCutoverApproved:false,evidence:r.evidence};
}
