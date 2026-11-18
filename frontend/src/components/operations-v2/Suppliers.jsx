import { ArrowRight } from 'lucide-react';
import SupplierForm from './SupplierForm';
import Adjustments from '../completion-v2/Adjustments';
import { useRef, useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Pager, Select, Table, buttonClass, primaryClass } from '../business-v2/UI';
import Purchases from './Purchases';
export default function Suppliers({context,api,c,lang}){
 const path=`/businesses/${context.business.id}/operations/suppliers`,manage=context.permissions['suppliers.edit'],create=context.permissions['suppliers.create'];
 const [page,setPage]=useState(1),[state,setState]=useState('active'),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[edit,setEdit]=useState(null),[history,setHistory]=useState(null),[historyView,setHistoryView]=useState('purchases'),[notice,setNotice]=useState('');
 const trigger=useRef(null),{data,error,reload}=useResource(api,`${path}?page=${page}&state=${state}&search=${encodeURIComponent(query)}`);
 if(history)return <div className="space-y-4"><button className={buttonClass} onClick={()=>setHistory(null)}><ArrowRight aria-hidden="true" className={`h-4 w-4 ${lang==='ar'?'':'rotate-180'}`} />{c('back')}</button><h2 className="font-bold">{history.name} · {c('history')}</h2>{context.permissions['returns.view']&&<div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={()=>setHistoryView('purchases')}>{c('purchases')}</button><button className={buttonClass} onClick={()=>setHistoryView('returns')}>{c('SUPPLIER_RETURN')}</button></div>}{historyView==='returns'&&context.permissions['returns.view']?<Adjustments {...{context,api,c,lang}} initialSupplier={history}/>:<Purchases {...{context,api,c,lang}} initialSupplier={history}/>}</div>;
 return <section className="space-y-5">
  <div className="flex flex-wrap gap-3 justify-between items-center"><div><h2 className="font-bold text-lg">{c('suppliers')}</h2><p className="text-sm text-slate-500 mt-1">{c('suppliersHint')}</p></div>{create&&<button className={primaryClass} onClick={e=>{trigger.current=e.currentTarget;setEdit({row:null});}}>{c('addSupplier')}</button>}</div>
  <form className="flex flex-wrap gap-3 items-end" onSubmit={e=>{e.preventDefault();setPage(1);setQuery(search.trim());}}><div className="w-full sm:w-72"><Field id="supplier-search" label={c('search')} placeholder={c('supplierSearchPlaceholder')} value={search} onChange={e=>setSearch(e.target.value)}/></div><Select id="supplier-state" label={c('status')} value={state} onChange={e=>{setState(e.target.value);setPage(1);}}>{['active','inactive','all'].map(k=><option key={k} value={k}>{c(k)}</option>)}</Select><button className={buttonClass}>{c('search')}</button></form>
  <Feedback {...{error,notice,c}} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}
  {data&&<><Table headers={['supplierName','supplierCode','contact','status','actions']} empty={!data.items.length} c={c}>{data.items.map(row=><tr key={row.id}><td className="px-5 py-3 font-semibold">{row.name}</td><td className="px-5 py-3" dir="ltr">{row.code}</td><td className="px-5 py-3"><span>{row.contact}</span><span className="block" dir="ltr">{row.phone}</span></td><td className="px-5 py-3">{c(row.active?'active':'inactive')}</td><td className="px-5 py-3"><div className="flex gap-2">{manage&&<button className={buttonClass} onClick={e=>{trigger.current=e.currentTarget;setEdit({row});}}>{c('editSupplier')}</button>}{context.permissions['purchasing.view']&&<button className={buttonClass} onClick={()=>setHistory(row)}>{c('history')}</button>}</div></td></tr>)}</Table><Pager {...{data,setPage,c}}/></>}
  {edit&&<SupplierForm canDelete={context.permissions['suppliers.delete']} {...{path,api,c,lang}} row={edit.row} returnFocus={trigger.current} close={()=>setEdit(null)} done={()=>{setEdit(null);setNotice('supplierSaved');reload();}}/>}
 </section>;
}
