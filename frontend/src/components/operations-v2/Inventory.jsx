import { useRef, useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Pager, Select, Table, buttonClass } from '../business-v2/UI';
import RecordPicker from './RecordPicker';
function StockRows({context,api,c,lang,location}){
 const [view,setView]=useState('balances'),[page,setPage]=useState(1),[search,setSearch]=useState(''),[query,setQuery]=useState('');
 const {data,error,reload}=useResource(api,`/businesses/${context.business.id}/operations/inventory?locationId=${location.id}&view=${view}&page=${page}&search=${encodeURIComponent(query)}`);
 return <div className="space-y-4"><form className="flex flex-wrap gap-3 items-end" onSubmit={e=>{e.preventDefault();setQuery(search.trim());setPage(1);}}><Select id="stock-view" label={c('inventory')} value={view} onChange={e=>{setView(e.target.value);setPage(1);}}>{['balances','movements'].map(k=><option key={k} value={k}>{c(k)}</option>)}</Select><div className="w-full sm:w-72"><Field id="stock-search" label={c('searchProducts')} placeholder={c('productSearchPlaceholder')} value={search} onChange={e=>setSearch(e.target.value)}/></div><button className={buttonClass}>{c('search')}</button></form><Feedback {...{error,c}} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}
 {data&&<><Table c={c} headers={view==='balances'?['productName','unit','onHand','reserved','available','status']:['date','productName','movement','quantity','unit','reference']} empty={!data.items.length} tableClassName="min-w-[640px]">{data.items.map(row=><tr key={row.id}>{view==='movements'&&<td className="px-5 py-3 whitespace-nowrap" dir="ltr">{new Date(row.createdAt).toLocaleString(lang==='ar'?'ar-AE':'en-GB',{timeZone:context.business.timezone})}</td>}<td className="px-5 py-3 font-semibold">{row.product.name}<span className="block text-xs text-slate-500" dir="ltr">{row.product.sku}</span></td>{view==='balances'?<><td className="px-5 py-3">{c(row.product.unit)}</td>{['onHand','reserved','available'].map(k=><td key={k} className="px-5 py-3 tabular-nums" dir="ltr">{row[k]}</td>)}<td className="px-5 py-3">{row.lowStock?<span className="text-amber-800 bg-amber-50 rounded px-2 py-1">{c('lowStock')}</span>:'—'}</td></>:<><td className="px-5 py-3">{c(row.type)}</td><td className="px-5 py-3 tabular-nums" dir="ltr">{row.quantity}</td><td className="px-5 py-3">{c(row.product.unit)}</td><td className="px-5 py-3 break-all min-w-48" dir="ltr">{row.reference}</td></>}</tr>)}</Table>{!data.items.length&&<p className="text-sm text-slate-500">{c('stockEmptyHint')}</p>}<Pager {...{data,setPage,c}}/></>}
 </div>;
}
export default function Inventory({context,api,c,lang}){
 const [location,setLocation]=useState(null),[choosing,setChoosing]=useState(false),trigger=useRef(null);
 return <section className="space-y-5"><div><h2 className="font-bold text-lg">{c('inventory')}</h2><p className="text-sm text-slate-500 mt-1">{c('inventoryHint')}</p></div><button className={buttonClass} onClick={e=>{trigger.current=e.currentTarget;setChoosing(true);}}>{location?`${c('selectedLocation')}: ${location.name}`:c('chooseLocation')}</button>
 {location&&<StockRows key={location.id} {...{context,api,c,lang,location}}/>}
 {choosing&&<RecordPicker {...{api,c,lang}} path={`/businesses/${context.business.id}/locations?state=all`} title={c('chooseLocation')} returnFocus={trigger.current} close={()=>setChoosing(false)} onSelect={row=>{setLocation(row);setChoosing(false);}}/>}
 </section>;
}
