import Migration from '../completion-v2/Migration';
import { Info } from 'lucide-react';
import { formatQuantity } from '@/lib/quantity';
import CopyableCode from '@/components/CopyableCode';
import { unitLabel } from '../catalogue-v2/units';
import { useRef, useState } from 'react';
import { useLiveSearch, useResource } from '../business-v2/useBusinessApi';
import { Feedback, Modal, Pager, Select, Table, buttonClass } from '../business-v2/UI';
import LocationChips from '../business-v2/LocationChips';
import ProductTableSearch from '../business-v2/ProductTableSearch';
function MovementDetails({row, location, timezone, c, lang, close, returnFocus}) {
 const ar=lang==='ar';
 const fields=[
  [ar?'من':'From', row.from??'—'],
  [ar?'إلى':'To', row.to??'—'],
  [c('selectedLocation'), location.name],
  [c('quantity'), <><bdi>{formatQuantity(row.quantity)}</bdi> {unitLabel(row.product.unit,c)}</>],
  [c('date'), new Date(row.createdAt).toLocaleString(ar?'ar-AE':'en-GB',{timeZone:timezone})],
  [c('reference'), <bdi dir="ltr">{row.reference||'—'}</bdi>],
  [c('sku'), <CopyableCode>{row.product.sku}</CopyableCode>],
  [c('barcodes'), row.product.barcodes?.length ? row.product.barcodes.map(barcode=>(
   <div key={barcode.value}><CopyableCode kind="barcode">{barcode.value}</CopyableCode></div>
  )) : '—'],
 ];
 if(row.notes)fields.push([ar?'ملاحظات':'Notes',row.notes]);
 return <Modal title={ar?'تفاصيل حركة المخزون':'Stock movement details'}
  description={`${row.product.name} · ${c(row.type)}`} {...{c,lang,close,returnFocus}}>
  <dl className="grid gap-3 sm:grid-cols-2">
   {fields.map(([label,value])=>(
    <div key={label} className="min-w-0 break-words rounded-lg bg-slate-50 p-3">
     <dt className="text-xs text-slate-500">{label}</dt>
     <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
    </div>
   ))}
  </dl>
 </Modal>;
}
function StockRows({context,api,c,lang,location}){
 const [view,setView]=useState('balances'),[page,setPage]=useState(1),[search,setSearch]=useState(''),[query,setQuery]=useState('');
 const [movement,setMovement]=useState(null),movementTrigger=useRef(null);
 const {data,error,reload}=useResource(api,`/businesses/${context.business.id}/operations/inventory?locationId=${location.id}&view=${view}&page=${page}&search=${encodeURIComponent(query)}`);
 useLiveSearch(search,query,setQuery,setPage);
 const currentResults=query===search.trim();
 const products=data&&currentResults
  ? {items:[...new Map(data.items.map(({productId,product})=>[productId,{...product,id:productId}])).values()]}
  : null;
 function searchStock(term){
  setSearch(term);
  setQuery(term);
  setPage(1);
 }
 return <div className="space-y-4"><div className="max-w-xs"><Select id="stock-view" label={c('inventory')} value={view} onChange={e=>{setView(e.target.value);setPage(1);}}>{['balances','movements'].map(k=><option key={k} value={k}>{c(k)}</option>)}</Select></div><Feedback {...{error,c}} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}
 <><Table showRows={!!data} searchContent={<ProductTableSearch id="stock-search" {...{c,lang}}
   value={search} onChange={setSearch} onSearch={searchStock} results={products} failed={currentResults&&Boolean(error)}
   onSelect={product=>searchStock(product.sku||product.name)}/>} c={c} headers={view==='balances'?['productName','barcodes','unit','onHand','reserved','available','status']:['date','productName','barcodes','movement','quantity','unit','reference']} empty={!data?.items.length} tableClassName="min-w-[880px]">{data?.items.map(row=><tr key={row.id}>{view==='movements'&&<td className="px-5 py-3 whitespace-nowrap text-start"><bdi>{new Date(row.createdAt).toLocaleString(lang==='ar'?'ar-AE':'en-GB',{timeZone:context.business.timezone})}</bdi></td>}<td className="px-5 py-3 font-semibold">{row.product.name}<span className="block text-xs text-slate-500"><CopyableCode>{row.product.sku}</CopyableCode></span></td><td className="px-5 py-3 text-start">{row.product.barcodes?.length?row.product.barcodes.map(b=><span className="block" key={b.value}><CopyableCode kind="barcode">{b.value}</CopyableCode></span>):'—'}</td>{view==='balances'?<><td className="px-5 py-3">{unitLabel(row.product.unit,c)}</td>{['onHand','reserved','available'].map(k=><td key={k} className="px-5 py-3 tabular-nums text-start"><bdi dir="ltr">{formatQuantity(row[k])}</bdi></td>)}<td className="px-5 py-3">{row.lowStock?<span className="text-amber-800 bg-amber-50 rounded px-2 py-1">{c('lowStock')}</span>:'—'}</td></>:<><td className="px-5 py-3"><div className="flex items-center gap-2">
 <span>{c(row.type)}</span>
 <button type="button" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-500"
  aria-label={`${lang==='ar'?'تفاصيل حركة المخزون':'Stock movement details'}: ${row.product.name}`}
  onClick={e=>{movementTrigger.current=e.currentTarget;setMovement(row);}}>
  <Info aria-hidden="true" className="h-4 w-4"/>
 </button>
 </div></td><td className="px-5 py-3 tabular-nums text-start"><bdi dir="ltr">{formatQuantity(row.quantity)}</bdi></td><td className="px-5 py-3">{unitLabel(row.product.unit,c)}</td><td className="px-5 py-3 break-all min-w-48 text-start"><bdi dir="ltr">{row.reference}</bdi></td></>}</tr>)}</Table>{data&&!data.items.length&&<p className="text-sm text-slate-500">{c('stockEmptyHint')}</p>}{data&&<Pager {...{data,setPage,c}}/>}</>
 {movement&&<MovementDetails row={movement} timezone={context.business.timezone}
  {...{location,c,lang}} returnFocus={movementTrigger.current} close={()=>setMovement(null)}/>}
 </div>;
}
export default function Inventory({context,api,c,lang}){
 const [importing,setImporting]=useState(false);
 const [location,setLocation]=useState(null);
 const importLabel=lang==='ar'?'استيراد رصيد افتتاحي CSV':'Import opening stock CSV';
 if(importing)return <section className="space-y-5"><button className={buttonClass} onClick={()=>setImporting(false)}>{c('back')}</button><Migration {...{context,api,c,lang}} initialLocation={location}/></section>;
 return <section className="space-y-5">
  <h2 className="font-bold text-lg">{c('inventory')}</h2>
  <div className="flex flex-nowrap items-start gap-2 sm:gap-3">
   <div className="min-w-0">
    <LocationChips {...{context,api,c,lang}} value={location} onChange={setLocation} all/>
   </div>
   {location&&context.permissions['migration.manage']&&(
    <button type="button" className={`${buttonClass} mt-7 shrink-0 whitespace-nowrap`} aria-label={importLabel} onClick={()=>setImporting(true)}>
     <span className="sm:hidden">{lang==='ar'?'استيراد CSV':'Import CSV'}</span>
     <span className="hidden sm:inline">{importLabel}</span>
    </button>
   )}
  </div>
 {location&&<StockRows key={location.id} {...{context,api,c,lang,location}}/>}
 </section>;
}
