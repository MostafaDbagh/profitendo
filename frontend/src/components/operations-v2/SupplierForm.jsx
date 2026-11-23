import {OptionalFields} from '../business-v2/Disclosure';
import { useState } from 'react';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { Field, inputClass } from '../auth-v2/Fields';
import { Modal, Feedback, buttonClass, primaryClass } from '../business-v2/UI';

export default function SupplierForm({canDelete,row,path,api,c,lang,close,done,returnFocus}){
 const [value,setValue]=useState(row||{name:'',contact:'',phone:'',email:'',address:'',notes:'',active:true}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const draft=useLocalDraft(`supplier:${row?.id||'new'}:${row?.revision||0}`,{value},saved=>{setValue(saved.value);});
 const field=(key)=>({value:value[key],onChange:e=>setValue(v=>({...v,[key]:e.target.value}))});
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{const {name,contact,phone,email,address,notes,active,revision}=value;const saved=await api(row?`${path}/${row.id}`:path,{method:row?'PATCH':'POST',body:row?{name,contact,phone,email,address,notes,active,revision}:{name,contact,phone,email,address,notes}});draft.clear();done(saved);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <Modal {...{c,lang,close,busy,returnFocus}} title={c(row?'editSupplier':'addSupplier')} description={lang==='ar'?'أدخل اسم المورد وبيانات التواصل المتاحة.':'Enter the supplier name and any contact details.'}><form onSubmit={save} className="space-y-4"><LocalDraftNotice {...{draft,lang,busy}}/><Feedback {...{error,c}}/>
  <Field id="supplier-name" label={c('supplierName')} placeholder={c('supplierNamePlaceholder')} required minLength={2} maxLength={160} disabled={busy} {...field('name')}/>
  <Field id="supplier-phone" label={c('phone')} placeholder={c('phonePlaceholder')} type="tel" maxLength={40} disabled={busy} {...field('phone')}/>
  <OptionalFields hasValue={Boolean(value.contact||value.email||value.address||value.notes)}>
  {['contact','email','address'].map(key=><Field key={key} id={`supplier-${key}`} label={c(key)} placeholder={c(`${key}Placeholder`)} type={key==='email'?'email':key==='phone'?'tel':'text'} maxLength={{contact:160,phone:40,email:254,address:500}[key]} disabled={busy} {...field(key)}/>)}
  <label className="block text-sm font-medium" htmlFor="supplier-notes">{c('notes')}</label><textarea id="supplier-notes" className={inputClass} placeholder={c('notesPlaceholder')} maxLength={2000} disabled={busy} {...field('notes')}/></OptionalFields>
  {row&&<label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={value.active} disabled={busy || (row.active && !canDelete)} onChange={e=>setValue(v=>({...v,active:e.target.checked}))}/>{c('active')}</label>}
  <div className="flex flex-wrap gap-2"><button className={primaryClass} disabled={busy}>{c(busy?'saving':'save')}</button><button type="button" className={buttonClass} disabled={busy} onClick={close}>{c('cancel')}</button></div>
 </form></Modal>;
}
