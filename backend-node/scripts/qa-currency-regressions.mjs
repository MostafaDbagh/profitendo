// Run from backend-node with: node --import tsx scripts/qa-currency-regressions.mjs
// Synthetic fixtures, no database writes. Nonzero exit means release blockers remain.
import {sliceCostAmount} from '../src/operations/fifo.ts';
import {summaryTotals} from '../src/reports/service.ts';
const layer=[{quantity:'1.0000',unitCost:'1.2300',amount:'1.2300',acquiredAt:'2026-11-23T00:00:00.000Z',originId:'qa-layer'}];
const actualCost=sliceCostAmount(layer,0n,10000n,0);
const decimal=value=>({toFixed:()=>value});
const sales=['USD','AED'].map(currency=>({currency,total:decimal('10.0000'),tax:decimal('0.0000'),lines:[]}));
const tx={sale:{findMany:async()=>sales},adjustment:{findMany:async()=>[]},moneyEntry:{findMany:async()=>[]},transferEvent:{findMany:async()=>[]},stockBalance:{count:async()=>0}};
const totals=await summaryTotals(tx,'synthetic-tenant',{gte:new Date('2026-11-23'),lt:new Date('2026-11-24')},{},2);
const checks=[{name:'Preserve original FIFO cost',expected:'1.2300',actual:actualCost,passed:actualCost==='1.2300'},{name:'Do not silently sum USD10 and AED10',expected:'currency-separated totals or explicit rejection',actual:totals.sales,passed:totals.sales!=='20.0000'}];
console.log(JSON.stringify({data:'Synthetic in-memory only',checks},null,2));
process.exitCode=checks.some(c=>!c.passed)?1:0;
