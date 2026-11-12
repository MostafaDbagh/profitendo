import Adjustments from '../completion-v2/Adjustments';
import { useRef, useState } from 'react';
import { Field, inputClass } from '../auth-v2/Fields';
import { useResource } from '../business-v2/useBusinessApi';
import { Modal, Feedback, Pager, Select, Table, buttonClass, primaryClass } from '../business-v2/UI';
import Purchases from './Purchases';
function SupplierForm({row,path,api,c,lang,close,done,returnFocus}){
 const [value,setValue]=useState(row||{code:'',name:'',contact:'',phone:'',email:'',address:'',notes:'',active:true}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const field=(key)=>({value:value[key],onChange:e=>setValue(v=>({...v,[key]:e.target.value}))});
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{const {code,name,contact,phone,email,address,notes,active,revision}=value;await api(row?`${path}/${row.id}`:path,{method:row?'PATCH':'POST',body:row?{name,contact,phone,email,address,notes,active,revision}:{code,name,contact,phone,email,address,notes}});done();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <Modal {...{c,lang,close,busy,returnFocus}} title={c(row?'editSupplier':'addSupplier')} description={c('supplierFormHint')}><form onSubmit={save} className="space-y-4"><Feedback {...{error,c}}/>
  <Field id="supplier-code" label={c('supplierCode')} placeholder="SUP-001" required maxLength={40} disabled={!!row||busy} {...field('code')}/>
  <Field id="supplier-name" label={c('supplierName')} placeholder={c('supplierNamePlaceholder')} required minLength={2} maxLength={160} disabled={busy} {...field('name')}/>
  {['contact','phone','email','address'].map(key=><Field key={key} id={`supplier-${key}`} label={c(key)} placeholder={c(`${key}Placeholder`)} type={key==='email'?'email':key==='phone'?'tel':'text'} maxLength={{contact:160,phone:40,email:254,address:500}[key]} disabled={busy} {...field(key)}/>)}
  <label className="block text-sm font-medium" htmlFor="supplier-notes">{c('notes')}</label><textarea id="supplier-notes" className={inputClass} placeholder={c('notesPlaceholder')} maxLength={2000} disabled={busy} {...field('notes')}/>
  {row&&<label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={value.active} disabled={busy} onChange={e=>setValue(v=>({...v,active:e.target.checked}))}/>{c('active')}</label>}
  <div className="flex flex-wrap gap-2"><button className={primaryClass} disabled={busy}>{c(busy?'saving':'save')}</button><button type="button" className={buttonClass} disabled={busy} onClick={close}>{c('cancel')}</button></div>
 </form></Modal>;
}
export default function Suppliers({context,api,c,lang}){
 const path=`/businesses/${context.business.id}/operations/suppliers`,manage=context.permissions['suppliers.edit'],create=context.permissions['suppliers.create'];
 const [page,setPage]=useState(1),[state,setState]=useState('active'),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[edit,setEdit]=useState(null),[history,setHistory]=useState(null),[historyView,setHistoryView]=useState('purchases'),[notice,setNotice]=useState('');
 const trigger=useRef(null),{data,error,reload}=useResource(api,`${path}?page=${page}&state=${state}&search=${encodeURIComponent(query)}`);
 if(history)return <div className="space-y-4"><button className={buttonClass} onClick={()=>setHistory(null)}>{c('back')}</button><h2 className="font-bold">{history.name} · {c('history')}</h2>{context.permissions['returns.view']&&<div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={()=>setHistoryView('purchases')}>{c('purchases')}</button><button className={buttonClass} onClick={()=>setHistoryView('returns')}>{c('SUPPLIER_RETURN')}</button></div>}{historyView==='returns'&&context.permissions['returns.view']?<Adjustments {...{context,api,c,lang}} initialSupplier={history}/>:<Purchases {...{context,api,c,lang}} initialSupplier={history}/>}</div>;
 return <section className="space-y-5">
  <div className="flex flex-wrap gap-3 justify-between items-center"><div><h2 className="font-bold text-lg">{c('suppliers')}</h2><p className="text-sm text-slate-500 mt-1">{c('suppliersHint')}</p></div>{create&&<button className={primaryClass} onClick={e=>{trigger.current=e.currentTarget;setEdit({row:null});}}>{c('addSupplier')}</button>}</div>
  <form className="flex flex-wrap gap-3 items-end" onSubmit={e=>{e.preventDefault();setPage(1);setQuery(search.trim());}}><div className="w-full sm:w-72"><Field id="supplier-search" label={c('search')} placeholder={c('supplierSearchPlaceholder')} value={search} onChange={e=>setSearch(e.target.value)}/></div><Select id="supplier-state" label={c('status')} value={state} onChange={e=>{setState(e.target.value);setPage(1);}}>{['active','inactive','all'].map(k=><option key={k} value={k}>{c(k)}</option>)}</Select><button className={buttonClass}>{c('search')}</button></form>
  <Feedback {...{error,notice,c}} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}
  {data&&<><Table headers={['supplierName','supplierCode','contact','status','actions']} empty={!data.items.length} c={c}>{data.items.map(row=><tr key={row.id}><td className="px-5 py-3 font-semibold">{row.name}</td><td className="px-5 py-3" dir="ltr">{row.code}</td><td className="px-5 py-3"><span>{row.contact}</span><span className="block" dir="ltr">{row.phone}</span></td><td className="px-5 py-3">{c(row.active?'active':'inactive')}</td><td className="px-5 py-3"><div className="flex gap-2">{manage&&<button className={buttonClass} onClick={e=>{trigger.current=e.currentTarget;setEdit({row});}}>{c('editSupplier')}</button>}{context.permissions['purchasing.view']&&<button className={buttonClass} onClick={()=>setHistory(row)}>{c('history')}</button>}</div></td></tr>)}</Table><Pager {...{data,setPage,c}}/></>}
  {edit&&<SupplierForm {...{path,api,c,lang}} row={edit.row} returnFocus={trigger.current} close={()=>setEdit(null)} done={()=>{setEdit(null);setNotice('supplierSaved');reload();}}/>}
 </section>;
}
