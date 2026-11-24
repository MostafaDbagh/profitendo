import {LoadingState} from '../page-layout/PageResults';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Modal, Select, buttonClass, primaryClass } from '../business-v2/UI';
export default function References({canDelete,path,api,c,lang,close,returnFocus}){
 const t=(en,ar)=>lang==='ar'?ar:en,{data,error,reload}=useResource(api,`${path}/references`);
 const [kind,setKind]=useState('CATEGORY'),[code,setCode]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false),[failure,setFailure]=useState('');
 const draft=useLocalDraft('reference',{kind,code,name},saved=>{setKind(saved.kind);setCode(saved.code);setName(saved.name);});
 async function run(fn){setBusy(true);setFailure('');try{await fn();reload();}catch(e){setFailure(e.message);}finally{setBusy(false);}}
 return <Modal title={t('Categories & units','الفئات والوحدات')} description={t('Codes and names stay fixed to preserve existing records. Retire unused definitions.','تبقى الرموز والأسماء ثابتة للحفاظ على السجلات. يمكنك إيقاف التعريفات غير المستخدمة.')} {...{c,lang,close,returnFocus,busy}}><div className="space-y-4">
  <LocalDraftNotice {...{draft,lang,busy}}/><Feedback error={failure||error} c={c} retry={reload}/>{!data&&!error&&<LoadingState>{c('loading')}</LoadingState>}
  <p className="text-sm text-slate-500">{t('Built-in units','الوحدات الأساسية')}: {data?.baseUnits.map(c).join('، ')}</p>
  <ul className="divide-y">{data?.items.map(r=><li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-2"><div className="min-w-0 flex-1 text-start"><p className="font-semibold text-slate-900 break-words"><bdi>{r.name}</bdi></p><div className="mt-1 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{t(r.kind==='UNIT'?'Unit':'Category',r.kind==='UNIT'?'وحدة':'فئة')}</span><span className="text-slate-500">{t('Code','الرمز')}: <bdi dir="ltr" className="font-mono">{r.code}</bdi></span></div></div><button className={buttonClass} disabled={busy || (r.active && !canDelete)} onClick={()=>run(()=>api(`${path}/references/${r.id}`,{method:'PATCH',body:{revision:r.revision,active:!r.active}}))}>{t(r.active?'Retire':'Reactivate',r.active?'إيقاف':'إعادة تفعيل')}</button></li>)}</ul>
  <form className="space-y-3" onSubmit={e=>{e.preventDefault();run(async()=>{await api(`${path}/references`,{method:'POST',body:{kind,code,name}});draft.clear();setCode('');setName('');});}}>
   <Select id="reference-kind" label={t('Definition type','نوع التعريف')} value={kind} onChange={e=>setKind(e.target.value)}><option value="CATEGORY">{t('Category','فئة')}</option><option value="UNIT">{t('Unit','وحدة')}</option></Select>
   <Field id="reference-code" label={t('Code','الرمز')} placeholder={kind==='UNIT'?'BOTTLE':'DAIRY'} dir="ltr" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} pattern="[A-Z][A-Z0-9_]{1,31}" required disabled={busy}/>
   <Field id="reference-name" label={t('Name','الاسم')} placeholder={kind==='UNIT'?t('e.g. Bottle','مثال: زجاجة'):t('e.g. Dairy','مثال: ألبان')} value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={80} required disabled={busy}/><button className={primaryClass} disabled={busy}>{t('Add definition','إضافة تعريف')}</button>
  </form></div></Modal>;
}
