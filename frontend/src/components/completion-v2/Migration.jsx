import { ChevronDown, ClipboardCheck, Download } from 'lucide-react';
import { formatQuantity } from '@/lib/quantity';
import CopyableCode from '@/components/CopyableCode';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import {useRef,useState} from 'react';
import {Field,inputClass} from '../auth-v2/Fields';
import {useResource} from '../business-v2/useBusinessApi';
import {Feedback,Modal,Table,buttonClass,primaryClass,panelClass} from '../business-v2/UI';
import {LocationChoice,downloadCsv} from './Shared';
export default function Migration({context,api,c,lang}){
 const path=`/businesses/${context.business.id}/workflows/migration`,{data,error:loadError,reload}=useResource(api,path),[location,setLocation]=useState(null),[fileName,setFileName]=useState(''),[text,setText]=useState(''),[reason,setReason]=useState(''),[preview,setPreview]=useState(null),[review,setReview]=useState(null),[rows,setRows]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),key=useRef(crypto.randomUUID()),last=useRef('');
 const draft=useLocalDraft('opening-stock',{location,text,reason},saved=>{setLocation(saved.location);setText(saved.text);setReason(saved.reason);setPreview(null);setReview(null);});
 async function file(e){const f=e.target.files?.[0];if(!f)return;if(f.size>50000){setError('MIGRATION_FILE_INVALID');return;}setText(await f.text());setFileName(f.name);setPreview(null);setError('');}
 async function prepare(e){e.preventDefault();setError('');setNotice('');setBusy(true);try{const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);if(lines.shift()?.trim()!=='sku,quantity')throw new Error('MIGRATION_FILE_INVALID');const parsed=lines.map(l=>{const parts=l.split(',').map(x=>x.trim());if(parts.length!==2||!parts[0]||!/^\d+(\.\d{1,4})?$/.test(parts[1]))throw new Error('MIGRATION_FILE_INVALID');return {sku:parts[0],quantity:parts[1]};});const body={locationId:location.id,reason,rows:parsed};if(last.current!==JSON.stringify(body)){last.current=JSON.stringify(body);key.current=crypto.randomUUID();}const result=await api(`${path}/preview`,{method:'POST',body:{...body,clientKey:key.current}});setRows(result.rows??parsed);setPreview(result);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function confirm(){setBusy(true);setError('');try{await api(`${path}/${preview.id}/confirm`,{method:'POST',body:{confirm:true}});setReview(null);setPreview(null);draft.clear();setText('');setFileName('');key.current=crypto.randomUUID();last.current='';setNotice('openingImported');reload();}catch(e){setReview(null);setError(e.message);}finally{setBusy(false);}}
 const ar=lang==='ar';
 const checks = ['stockLedgerMismatches','activeLocations','products','openTransfers','openReceipts','pendingAdjustments'];
 return <div className="space-y-5">
  <header>
   <h2 className="text-xl font-bold">{c('migration')}</h2>
   <p className="mt-1 text-sm text-slate-600">{c('migrationHint')}</p>
   <details className="mt-3 max-w-4xl rounded-lg border border-slate-200 bg-white px-4 text-sm">
    <summary className="cursor-pointer rounded py-2.5 font-medium text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
     {ar?'ما هو الرصيد الافتتاحي؟':'What is opening stock?'}
    </summary>
    <div className="space-y-2 pb-3 leading-relaxed text-slate-600">
     <p>{ar?'استخدم هذه الصفحة لتسجيل البضاعة الموجودة في متجرك أو مستودعك قبل بدء العمل على ProfitLens، حتى يبدأ النظام بتتبّع المخزون من الكمية الصحيحة.':'Use this page to record the stock already in your shop or warehouse when you start using ProfitLens, so inventory tracking starts with the right quantities.'}</p>
     <p>{ar?'مثال: إذا كان لديك ٥٠ علبة حليب، اختر المستودع وارفع ملفاً فيه رمز المنتج والكمية 50. اكتب سبباً مثل «جرد بداية العمل»، ثم راجع الكمية وأكّدها.':'For example, if you have 50 cartons of milk, select the warehouse and upload a file with the product code and quantity 50. Enter a reason such as “Opening stock count”, then review and confirm the quantity.'}</p>
     <p>{ar?'سجّل الرصيد الافتتاحي مرة واحدة لكل منتج في كل موقع. سجّل البضاعة التي تصل لاحقاً من المورد في صفحة المشتريات. إذا بدأت بمخزون فارغ، يمكنك تجاوز هذه الصفحة.':'Record opening stock once per product at each location. Use Purchases for stock that arrives from suppliers later. If you start with no stock, you can skip this page.'}</p>
    </div>
   </details>
  </header>
  <Feedback c={c} error={error||loadError} notice={notice} retry={loadError ? reload : undefined} />
  <form className={`${panelClass} max-w-4xl space-y-4`} onSubmit={prepare}>
   <LocalDraftNotice {...{draft,lang,busy}} />
   <fieldset disabled={busy||!!preview} className="min-w-0 space-y-4">
    <div className="space-y-1.5">
     <p className="text-sm font-semibold">{ar?'المتجر أو المستودع':'Shop or warehouse'}</p>
     <LocationChoice {...{context,api,c,lang}} value={location} onChange={setLocation} disabled={!!preview||busy} />
    </div>
    <div className="space-y-3 border-t border-slate-200 pt-4">
     <button type="button" className={buttonClass} onClick={()=>downloadCsv({filename:'opening-stock-template.csv',csv:'sku,quantity\r\nMILK-001,100\r\n'})}>
      <Download className="h-4 w-4" aria-hidden="true" />{c('downloadOpeningTemplate')}
     </button>
     <Field id="migration-file" label={c('openingFile')} type="file" accept=".csv,text/csv" onChange={file} />
     {fileName && <p className="break-all text-sm text-emerald-800" role="status"><bdi>{fileName}</bdi></p>}
     <details>
      <summary className="cursor-pointer text-sm font-medium text-slate-700">{c('openingRows')}</summary>
      <textarea id="migration-rows" aria-label={c('openingRows')} className={`${inputClass} mt-2`} rows={5} dir="ltr"
       placeholder={'sku,quantity\nMILK-001,100\nRICE-002,25.5'} value={text}
       onChange={e=>{setText(e.target.value);setFileName('');}} maxLength={50000} />
     </details>
     <details>
      <summary className="cursor-pointer text-sm font-medium text-slate-700">{ar?'شروط الاستيراد':'Import requirements'}</summary>
      <p className="mt-2 text-sm text-slate-600">{c('openingImportHint')}</p>
     </details>
    </div>
    <Field id="migration-reason" label={c('recordReason')} placeholder={c('openingReasonExample')} value={reason}
     onChange={e=>setReason(e.target.value)} required minLength={5} maxLength={2000} />
   </fieldset>
   {!preview && <button className={primaryClass} disabled={busy||!location||!text.trim()||reason.trim().length<5}>{c('previewOpening')}</button>}
  </form>
 {preview&&<div className="space-y-4"><p className="text-sm text-slate-500">{c('openingPreviewHint')} · {new Date(preview.expiresAt).toLocaleString(lang,{timeZone:context.business.timezone})}</p><Table c={c} headers={['sku','barcodes','quantity']} empty={!rows.length}>{rows.map(r=><tr key={r.sku}><td className="p-4"><CopyableCode>{r.sku}</CopyableCode></td><td className="p-4">{r.barcodes?.length?r.barcodes.map(code=><span className="block" key={code}><CopyableCode kind="barcode">{code}</CopyableCode></span>):'—'}</td><td className="p-4" dir="ltr">{formatQuantity(r.quantity)}</td></tr>)}</Table><div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={()=>setPreview(null)}>{c('editOpening')}</button><button className={primaryClass} disabled={busy} onClick={e=>setReview(e.currentTarget)}>{c('confirmOpening')}</button></div></div>}
  <details className={`${panelClass} group max-w-4xl !p-0`}>
   <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 [&::-webkit-details-marker]:hidden">
    <span className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" />{ar?'مراجعة حالة المخزون':'Review stock status'}</span>
    <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 group-open:rotate-180" aria-hidden="true" />
   </summary>
   <div className="space-y-4 border-t border-slate-200 px-4 pb-4 pt-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
     <p className="text-sm text-slate-600">{ar?'تحقق من فروقات المخزون والعمليات التي لم تكتمل بعد.':'Check for stock differences and transactions that are still open.'}</p>
     <button type="button" className={buttonClass} onClick={reload}>{c('refreshChecks')}</button>
    </div>
   {!data && !loadError && <p role="status" className="text-sm text-slate-600">{c('loading')}</p>}
   {data && <>
    <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
     {checks.map(key=><div key={key} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
      <dt className="text-slate-600">{c(key)}</dt><dd className="font-semibold tabular-nums">{data[key]}</dd>
     </div>)}
    </dl>
    {data.remainingGates.length > 0 && <details className="border-t border-slate-200 pt-3">
     <summary className="cursor-pointer text-sm font-semibold">{c('rolloutGates')}</summary>
     <ul className="mt-3 list-disc space-y-1 ps-5 text-sm text-slate-600">{data.remainingGates.map(key=><li key={key}>{c(`gate_${key}`)}</li>)}</ul>
    </details>}
   </>}
   </div>
  </details>
 {review&&<Modal {...{c,lang,busy}} title={c('confirmOpening')} description={c('confirmOpeningHint')} returnFocus={review} close={()=>setReview(null)}><p className="mb-4">{location.name} · {rows.length} {c('products')}</p><button className={primaryClass} disabled={busy} onClick={confirm}>{c('confirm')}</button></Modal>}</div>;
}
