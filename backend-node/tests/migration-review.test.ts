import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {analyzeLegacy} from '../src/migration/legacy.js';
import {validateMigrationReview} from '../src/migration/review.js';
const raw=JSON.stringify({meta:{app:'ProfitLens',format_version:1,business_id:'legacy'},data:{products:[{business_id:'legacy',sku:'MILK-01',name:'Milk',stock_qty:'100',product_cost:'1',selling_price:'2',currency:'USD'}]}});
function review(){return {sourceSha256:analyzeLegacy(raw).sourceSha256,sourceCounts:{products:1},currency:'USD',products:[{sku:'MILK-01',baseUnit:'BOTTLE',allocations:[{locationId:randomUUID(),quantity:'70'},{locationId:randomUUID(),quantity:'30'}]}],openingBalancesReviewed:true,reviewedBy:'Test owner',evidence:{sourceCounts:'source-counts.txt',openingBalances:'balances.txt',hardwarePilot:'pilot.txt',fiscalRequirements:'requirements.txt'}};}
it('checks exact stock allocation and source integrity without authorizing cutover',()=>{
 expect(validateMigrationReview(raw,review())).toMatchObject({readyForOpeningReview:true,productionCutoverApproved:false});
 const r=review();r.products[0]!.allocations[0]!.quantity='69.9999';expect(validateMigrationReview(raw,r).readyForOpeningReview).toBe(false);
 r.sourceSha256='0'.repeat(64);expect(validateMigrationReview(raw,r).issues).toContain('Source hash changed; repeat the review');
});
it('rejects incomplete, duplicate and invented allocation reviews',()=>{
 const r=review();r.products=[];expect(validateMigrationReview(raw,r).readyForOpeningReview).toBe(false);
 const duplicate=review();duplicate.products.push(duplicate.products[0]!);expect(validateMigrationReview(raw,duplicate).readyForOpeningReview).toBe(false);
 const counts=review();counts.sourceCounts.products=2;expect(validateMigrationReview(raw,counts).readyForOpeningReview).toBe(false);
 expect(()=>validateMigrationReview(raw,{...review(),openingBalancesReviewed:false})).toThrow();
});
