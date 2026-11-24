import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import CustomerReturn,{returnCopy} from './CustomerReturn';
import Detail from './AdjustmentDetail';
import { Select as StyledSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { selectInputOnFocus } from '../../lib/selectInputOnFocus';
import { ArrowRight } from 'lucide-react';
import { formatQuantity } from '@/lib/quantity';
import CopyableCode from '@/components/CopyableCode';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { unitLabel } from '../catalogue-v2/units';
import {useRef,useState} from 'react';
import {Field} from '../auth-v2/Fields';
import {useResource} from '../business-v2/useBusinessApi';
import {Feedback,Select,Table,Pager,Modal,buttonClass,primaryClass,panelClass} from '../business-v2/UI';
import ProductSearch from '../operations-v2/ProductSearch';
import {LocationChoice,DocumentPicker,decimalPattern} from './Shared';
function Editor({context,api,c,lang,kind,done,close,initialSupplier}){
 const root=`/businesses/${context.business.id}`,[location,setLocation]=useState(null),[source,setSource]=useState(null),[rows,setRows]=useState([]),[reason,setReason]=useState(''),[picker,setPicker]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),key=useRef(crypto.randomUUID()),last=useRef('');const returns=kind.includes('RETURN');
 const draft=useLocalDraft(`adjustment:${kind}:${initialSupplier?.id||'all'}`,{location,source,rows,reason,clientKey:key.current,fingerprint:last.current},saved=>{setLocation(saved.location);setSource(saved.source);setRows(saved.rows);setReason(saved.reason);key.current=saved.clientKey;last.current=saved.fingerprint;});
 async function selectSource(r){setBusy(true);setError('');try{const source=await api(`${root}/workflows/adjustments/source/${r.id}?kind=${kind}`);setSource({...source,id:r.id});setRows(source.lines.filter(l=>Number(l.remaining)>0).map(l=>({...l,sourceLineId:l.id,quantity:'',condition:'RESTOCK'})));setPicker(null);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function addProduct(p){setPicker(null);if(rows.some(r=>r.productId===p.id))return;setBusy(true);try{const snapshot=kind==='COUNT'?await api(`${root}/workflows/snapshot?locationId=${location.id}&productId=${p.id}`):{};setRows(old=>[...old,{productId:p.id,name:p.name,sku:p.sku,unit:p.unit,quantity:'',condition:'RESTOCK',...snapshot}]);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function save(e){e.preventDefault();if(!location)return;setError('');setBusy(true);const body={kind,locationId:location.id,...(source?{sourceId:source.id}:{}),reason,lines:rows.filter(r=>r.quantity!=='').map(r=>({productId:r.productId,...(r.sourceLineId?{sourceLineId:r.sourceLineId}:{}),...(kind==='COUNT'?{expected:r.expected,snapshotToken:r.snapshotToken}:{}),quantity:r.quantity,condition:r.condition}))};if(last.current!==JSON.stringify(body)){last.current=JSON.stringify(body);key.current=crypto.randomUUID();}draft.checkpoint({clientKey:key.current,fingerprint:last.current});try{const result=await api(`${root}/workflows/adjustments`,{method:'POST',body:{...body,clientKey:key.current}});draft.clear();done(result);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <PageLayout as="div"><PageHeader title={<>{c(returns?'newReturn':'newRecord')} · {c(kind)}</>} accessory={<button className={buttonClass} disabled={busy} onClick={close}><ArrowRight aria-hidden="true" className={`h-4 w-4 shrink-0 ${lang==='ar'?'':'rotate-180'}`} />{c('back')}</button>}/><LocalDraftNotice {...{draft,lang,busy}}/><Feedback {...{c,error}}/><div className={`${panelClass} space-y-4`}><p className="text-sm text-slate-500">{c(returns?'returnEntryHint':kind==='COUNT'?'countEntryHint':'damageEntryHint')}</p><LocationChoice {...{context,api,c,lang}} value={location} onChange={setLocation} disabled={busy||!!source||rows.length>0}/>
 {!location&&(source||rows.length>0)&&<div className="space-y-2">
  <p role="status" className="text-sm text-slate-600">{lang==='ar'?'لم يعد موقع هذه الأصناف متاحًا.':'The location for these items is no longer available.'}</p>
  <button type="button" className={buttonClass} disabled={busy} onClick={()=>{setRows([]);setSource(null);setPicker(null);}}>
   {lang==='ar'?'إزالة الأصناف واختيار موقع آخر':'Clear items and choose another location'}
  </button>
 </div>}
 {location&&(returns?<button type="button" className={`${buttonClass} ms-2`} disabled={busy}
  onClick={e=>setPicker({kind:'source',focus:e.currentTarget})}>{source?.reference||c('chooseSource')}</button>:
  <ProductSearch {...{api,root,c,lang,context}} disabled={busy} onSelect={addProduct}/>)}</div>
 <form onSubmit={save} className="space-y-4"><fieldset disabled={busy} className="space-y-4 min-w-0">{rows.map((r,i)=><div key={r.sourceLineId||r.productId} className={`${panelClass} space-y-3`}><h3 className="font-semibold break-words">{r.name} <CopyableCode className="text-xs text-slate-500">{r.sku}</CopyableCode></h3><p className="text-sm text-slate-500">{c('unit')}: {unitLabel(r.unit,c)}{returns&&<> · {c('returnRemaining')}: <bdi>{formatQuantity(r.remaining)}</bdi></>}{kind==='COUNT'&&<> · {c('countExpected')}: <bdi>{formatQuantity(r.expected)}</bdi></>}</p><div className="grid sm:grid-cols-2 gap-4"><Field id={`adjust-quantity-${i}`} {...selectInputOnFocus} label={c(kind==='COUNT'?'countedQuantity':'quantity')} value={r.quantity} onChange={e=>setRows(old=>old.map((x,j)=>i===j?{...x,quantity:e.target.value}:x))} placeholder={kind==='COUNT'?'0':c('quantityExample')} inputMode="decimal" pattern={decimalPattern} required={!returns}/>{kind==='CUSTOMER_RETURN'&&<Select id={`adjust-condition-${i}`} label={c('itemCondition')} value={r.condition} onChange={e=>setRows(old=>old.map((x,j)=>i===j?{...x,condition:e.target.value}:x))}>{['RESTOCK','DAMAGED'].map(k=><option key={k} value={k}>{c(k)}</option>)}</Select>}</div>{!returns&&<button type="button" className={buttonClass} onClick={()=>setRows(old=>old.filter((_,j)=>j!==i))}>{c('saleRemove')}</button>}</div>)}<Field id="adjust-reason" label={c('recordReason')} value={reason} onChange={e=>setReason(e.target.value)} placeholder={c('recordReasonExample')} required minLength={5} maxLength={2000}/></fieldset><button className={primaryClass} disabled={busy||!location||!rows.some(r=>r.quantity!=='')}>{c(busy?'saving':'saveDraft')}</button></form>
 {location&&picker?.kind==='source'&&<DocumentPicker {...{api,c,lang}} path={kind==='CUSTOMER_RETURN'?`${root}/sales?status=COMPLETED&locationId=${location.id}`:`${root}/operations/purchases?kind=RECEIPT&status=COMPLETED&locationId=${location.id}${initialSupplier?`&supplierId=${initialSupplier.id}`:''}`} returnFocus={picker.focus} close={()=>setPicker(null)} onSelect={selectSource}/>}</PageLayout>;
}
export default function Adjustments({context,api,c,lang,mode='returns',initialSupplier,initialAction}){
 const options=initialSupplier?['SUPPLIER_RETURN']:mode==='counts'?['COUNT']:mode==='damage'?['DAMAGE']:[...(context.permissions['sales.view']?['CUSTOMER_RETURN']:[]),...(context.permissions['purchasing.view']?['SUPPLIER_RETURN']:[])],available=options.length?options:['CUSTOMER_RETURN'];const requestedKind = initialAction === 'customer' ? 'CUSTOMER_RETURN' : initialAction === 'supplier' ? 'SUPPLIER_RETURN' : null;
 const startReturn = mode === 'returns' && options.includes(requestedKind) && !!context.permissions['returns.create'];
 const [kind,setKind]=useState(startReturn ? requestedKind : available[0]),[page,setPage]=useState(1),[doc,setDoc]=useState(null),[edit,setEdit]=useState(startReturn),[error,setError]=useState(''),[busy,setBusy]=useState(false),{data,error:loadError,reload}=useResource(api,`/businesses/${context.business.id}/workflows/adjustments?kind=${kind}&page=${page}${initialSupplier?`&supplierId=${initialSupplier.id}`:''}`);
 const close=()=>{setDoc(null);setEdit(false);setError('');reload();};const shared={context,api,c,lang,initialSupplier};async function open(id){setBusy(true);setError('');try{setDoc(await api(`/businesses/${context.business.id}/workflows/adjustments/${id}`));}catch(e){setError(e.message);}finally{setBusy(false);}}
 if(edit&&kind==='CUSTOMER_RETURN')return <CustomerReturn {...shared} close={close}/>;if(edit)return <Editor {...shared} {...{kind,close}} done={d=>{setDoc(d);setEdit(false);}}/>;if(doc)return <Detail {...{doc,api,lang,close}} c={doc.kind==='CUSTOMER_RETURN'?returnCopy(c,lang):c} done={setDoc}/>;
 const actions=[{id:'create',label:c(mode==='counts'?'newCount':mode==='damage'?'newDamage':'newReturn'),
   variant:'primary',visible:!!context.permissions[`${mode}.create`],onClick:()=>setEdit(true)}];
 return <PageLayout as="div" title={c(mode)} actions={actions}><Feedback c={c} error={error||loadError} retry={reload}/>{!data&&!loadError&&<LoadingState>{c('loading')}</LoadingState>}<Table showRows={!!data} primaryFilters={available.length>1&&<div className="max-w-sm">
   <label htmlFor="adjust-kind" className="mb-1.5 block text-sm font-medium text-slate-700">{c('recordType')}</label>
   <StyledSelect dir={lang==='ar'?'rtl':'ltr'} value={kind} onValueChange={value=>{setKind(value);setPage(1);}}>
    <SelectTrigger id="adjust-kind" className="h-11 gap-2 rounded-lg border-slate-200 bg-white text-start shadow-none focus:ring-2 focus:ring-emerald-500">
     <SelectValue />
    </SelectTrigger>
    <SelectContent align="start" className="rounded-lg border-slate-200 bg-white shadow-md">
     {available.map(value=><SelectItem key={value} value={value}
      className="min-h-10 cursor-pointer rounded-md ps-3 pe-8 data-[state=checked]:font-semibold data-[state=checked]:text-emerald-800 rtl:[&>span:first-child]:left-2 rtl:[&>span:first-child]:right-auto">
      {c(value)}
     </SelectItem>)}
    </SelectContent>
   </StyledSelect>
  </div>} c={c} headers={['reference','selectedLocation','status','actions']} empty={!data?.items.length}>{data?.items.map(r=><tr key={r.id}><td className="p-4"><bdi>{r.reference}</bdi></td><td className="p-4">{r.locationName}</td><td className="p-4">{c(r.status)}</td><td className="p-4"><button className={buttonClass} disabled={busy} onClick={()=>open(r.id)}>{c('openDocument')}</button></td></tr>)}</Table>{data&&<Pager {...{data,setPage,c}}/>}</PageLayout>;
}
