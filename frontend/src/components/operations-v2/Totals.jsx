import { formatQuantity } from '@/lib/quantity';
import { unitLabel } from '../catalogue-v2/units';
// Exact decimal display, matching the API's four-decimal quantities/costs.
// Group quantities by base unit; never add kilograms to pieces.
const scaled=v=>{const [w,f='']=v.split('.');return BigInt(w)*10000n+BigInt(f.padEnd(4,'0'));};
const fixed=(n,p)=>{const scale=10n**BigInt(p);return `${n/scale}.${String(n%scale).padStart(p,'0')}`;};
export const displayAmount=value=>{const [whole,fraction='']=value.split('.');return `${whole}.${fraction.replace(/0+$/,'').padEnd(2,'0')}`;};
export default function Totals({lines,c,currency,cost,base=false,prominent=false}){
 const totals=new Map();let value=0n,valid=true;
 for(const l of lines){
  const q=base?l.baseQuantity:l.quantity;
  if(!/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(q||'')){valid=false;continue;}
  totals.set(l.unit,(totals.get(l.unit)||0n)+scaled(q));
  if(cost){if(!/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(l.unitCost||'')){valid=false;continue;}value+=scaled(q)*scaled(l.unitCost);}
 }
 if(prominent)return <div className="space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <span className="text-sm text-slate-600">{c('receiptLineCount')}: <bdi className="font-semibold">{lines.length}</bdi></span>
   {cost&&<div className="text-end"><p className="text-xs text-slate-600">{c('totalValue')}</p><p className="text-xl font-bold text-emerald-800 tabular-nums"><bdi dir="ltr">{valid?displayAmount(fixed(value,8)):'—'} {currency}</bdi></p></div>}
  </div>
  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">{valid&&[...totals].map(([unit,total])=><p key={unit}>{unitLabel(unit,c)}: <bdi className="tabular-nums">{formatQuantity(fixed(total,4))}</bdi></p>)}</div>
  {!valid&&<p className="text-sm text-amber-800">{c(cost?'receiptIncomplete':'receiptQuantityIncomplete')}</p>}
 </div>;
 return <div className="text-sm text-slate-600 space-y-2 text-end">{[...totals].map(([unit,total])=><p key={unit}>{c('total')} · {unitLabel(unit,c)}: <span dir="ltr" className="tabular-nums">{formatQuantity(fixed(total,4))}</span></p>)}{cost&&valid&&<p className="font-semibold text-slate-900">{c('totalValue')}: <span dir="ltr" className="tabular-nums">{displayAmount(fixed(value,8))} {currency}</span></p>}</div>;
}
