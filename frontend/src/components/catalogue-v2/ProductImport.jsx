import CopyableCode from '@/components/CopyableCode';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { useRef, useState } from 'react';
import { Feedback, Modal, Pager, Table, buttonClass, primaryClass } from '../business-v2/UI';
import { Upload, FileSpreadsheet } from 'lucide-react';
const labels={name:'productName',sku:'sku',unit:'unit',purchasePrice:'purchasePrice',sellingPrice:'sellingPrice',minimumStock:'minimumStock',category:'category',subcategory:'subcategory',brand:'brand',description:'description',barcodes:'barcodes',active:'active','sku/barcodes':'barcodes',row:'importRow'};
function readFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('INVALID_WORKBOOK'));reader.readAsDataURL(file);});}
export default function ProductImport({businessId,api,c,lang,close,done,returnFocus}){
  const fileInput=useRef(null);
  const path=`/businesses/${businessId}/product-imports`;
  const [file,setFile]=useState(null),[preview,setPreview]=useState(null),[result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[page,setPage]=useState(1);
  const draft=useLocalDraft('product-import',{file,preview},saved=>{setFile(saved.file);setPreview(saved.preview);});
  async function discard(){if(preview?.id)await api(`${path}/${preview.id}/discard`,{method:'POST',body:{}});}
  async function discardDraft(){
    if(!window.confirm(lang==='ar'?'حذف هذه المسودة وإعادة الحقول إلى البداية؟':'Discard this draft and reset the fields?'))return;
    setBusy(true);setError('');
    try{await discard();draft.reset();setPage(1);if(fileInput.current)fileInput.current.value='';}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function pick(e){
    const selected=e.target.files?.[0];if(!selected)return;
    setError('');setBusy(true);
    try{
      if(!/\.(xlsx|csv)$/i.test(selected.name)||selected.size>1024*1024)throw new Error('INVALID_WORKBOOK');
      const nextFile={name:selected.name,data:await readFile(selected)};
      await discard();setPreview(null);setPage(1);setFile(nextFile);
    }catch(e){setError(e.message);if(fileInput.current)fileInput.current.value='';}
    finally{setBusy(false);}
  }
  async function upload(duplicateMode='review'){setBusy(true);setError('');try{await discard();setPreview(null);setPage(1);setPreview(await api(`${path}/preview`,{method:'POST',body:{filename:file.name,fileBase64:file.data,duplicateMode}}));}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function commit(){setBusy(true);setError('');try{setResult(await api(`${path}/${preview.id}/commit`,{method:'POST',body:{confirm:true}}));draft.clear();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function download(format='xlsx'){setBusy(true);setError('');try{const data=await api(`${path}/template?format=${format}&lang=${lang==='ar'?'ar':'en'}`),bytes=Uint8Array.from(atob(data.fileBase64),v=>v.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:format==='csv'?'text/csv;charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=data.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e.message);}finally{setBusy(false);}}
  function dismiss(){
    if(result){done();return;}
    close();
    // Keep the resumable preview; the server still validates its expiry on commit.
  }
  const rows=preview?.rows.slice((page-1)*25,page*25)||[];
  const ar=lang==='ar';
  return <Modal title={ar?'استيراد المنتجات':'Import products'} description={preview?(ar?'راجع المنتجات، ثم أكّد الاستيراد.':'Review your products, then confirm the import.'):(ar?'اختر ملفك. سنتعرّف على الأعمدة العربية والإنجليزية تلقائيًا.':'Choose your file. Arabic and English columns are matched automatically.')} {...{c,lang,busy,returnFocus}} close={dismiss}>
    {!result&&(['error','conflict'].includes(draft.status)||!draft.online)&&<LocalDraftNotice draft={{...draft,discard:discardDraft}} {...{lang,busy}}/>}<Feedback error={error} c={c}/>
    {result?<><p role="status" className="font-semibold text-emerald-700">{c('importCompleted')} · {result.count}</p><p className="text-sm text-slate-600">{c('importNoStock')}</p><button className={primaryClass} onClick={done}>{c('close')}</button></>:<>
      <input ref={fileInput} id="product-import-file" className="hidden" aria-label={c('importFile')} type="file" accept=".xlsx,.csv,text/csv" disabled={busy} onChange={pick}/>
      {!file?<button type="button" className="flex flex-col items-center gap-3 w-full rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center hover:border-emerald-500 hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50" disabled={busy} onClick={()=>fileInput.current?.click()}>
        <Upload className="h-7 w-7 text-emerald-600" aria-hidden="true"/>
        <span className="font-semibold text-slate-900">{ar?'اختر ملف Excel أو CSV':'Choose Excel or CSV file'}</span>
        <span className="text-xs text-slate-500">{ar?'حتى ٥٠٠ منتج · ١ ميغابايت':'Up to 500 products · 1 MB'}</span>
      </button>:<div className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 min-w-0">
        <FileSpreadsheet className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden="true"/>
        <div className="min-w-0 flex-1"><p className="text-sm font-medium break-all">{file.name}</p>{draft.restored&&<p className="text-xs text-slate-500">{ar?'تمت استعادة ملفك السابق':'Your previous file was restored'}</p>}</div>
        <button type="button" className="text-sm text-emerald-700 underline shrink-0 disabled:opacity-50" disabled={busy} onClick={()=>fileInput.current?.click()}>{ar?'تغيير الملف':'Change file'}</button>
      </div>}
      {!preview&&<>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500"><span>{ar?'ليس لديك ملف جاهز؟':'Need a template?'}</span><button type="button" className="text-emerald-700 underline disabled:opacity-50" disabled={busy} onClick={()=>download('xlsx')}>{c('downloadImportTemplate')}</button></div>
        <details className="text-xs text-slate-500"><summary className="cursor-pointer py-1">{ar?'إرشادات الملف':'File guidelines'}</summary><div className="space-y-3 pt-2"><p>{c('importTemplateHint')}</p><button type="button" className="text-emerald-700 underline" disabled={busy} onClick={()=>download('csv')}>{ar?'تنزيل قالب CSV':'Download CSV template'}</button></div></details>
      </>}
      {file&&(!preview||error)&&<button className={primaryClass} disabled={busy} onClick={()=>upload()}>{c(busy?'loading':'previewImport')}</button>}
      {preview&&<div className="space-y-3 min-w-0">{preview.skipped>0&&<p role="status" className="text-sm text-slate-600">{lang==='ar'?`تم استبعاد ${preview.skipped} صف مكرر من هذا الاستيراد. لم تُحذف أي منتجات موجودة.`:`Excluded ${preview.skipped} duplicate rows from this import. No existing products were deleted.`}</p>}<p role="status" className="font-semibold text-sm">{c('importRows')}: {preview.total} · {c('pricesCurrency')}: {preview.currency}</p>
        {!!preview.duplicates?.length&&<section aria-label={lang==='ar'?'مراجعة المكررات':'Duplicate review'} className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm space-y-3">
          <p className="font-semibold">{lang==='ar'?`صفوف مكررة محتملة: ${preview.duplicates.length}`:`Possible duplicate rows: ${preview.duplicates.length}`}</p>
          <p>{ar?'اختر استبعاد المكررات أو إبقاءها كمنتجات منفصلة. عند الإبقاء، يتغيّر رمز الصنف المتعارض وتُزال الباركودات المتعارضة.':'Exclude duplicates or keep them as separate products. Keeping them replaces conflicting SKUs and removes conflicting barcodes.'}</p>
          <details><summary className="cursor-pointer text-amber-900">{ar?'عرض المنتجات المكررة':'View duplicate products'}</summary><ul className="mt-2 max-h-48 overflow-y-auto space-y-2">{preview.duplicates.map(item=><li key={item.row} className="break-words">{c('importRow')} {item.row} · {item.name} · {item.fields.map(field=>c(labels[field])).join(' / ')}</li>)}</ul></details>
          <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy} onClick={()=>upload('skip')}>{lang==='ar'?'استبعاد المكررات':'Exclude duplicates'}</button><button className={buttonClass} disabled={busy} onClick={()=>upload('keep')}>{lang==='ar'?'إبقاء المكررات':'Keep duplicates'}</button></div>
        </section>}
        {!!preview.issues.length&&<div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm"><p className="font-semibold">{c('importFixErrors')} ({preview.issues.length})</p><ul className="mt-2 max-h-48 overflow-y-auto space-y-1">{preview.issues.slice(0,50).map((issue,i)=><li key={i}>{c('importRow')} {issue.row} · {c(labels[issue.field]||'importRow')}: {c(issue.code)}</li>)}</ul>{preview.issues.length>50&&<p>{c('importFirstErrors')}</p>}</div>}
        {!!rows.length&&<><Table tools={false} headers={['importRow','productName','purchasePrice','sellingPrice','importDetails']} c={c} tableClassName="min-w-[480px]">{rows.map(({row,product})=><tr key={row}><td className="px-5 py-3">{row}</td><td className="px-5 py-3">{product.name}</td><td className="px-5 py-3"><span dir="ltr">{product.purchasePrice}</span></td><td className="px-5 py-3"><span dir="ltr">{product.sellingPrice}</span></td><td className="px-5 py-3"><details><summary className="cursor-pointer text-emerald-700">{c('importDetails')}</summary><dl className="space-y-2 mt-2 min-w-40">{['sku','barcodes','unit','category','subcategory','brand','description','minimumStock','active'].map(k=><div key={k}><dt className="text-xs text-slate-500">{c(labels[k])}</dt><dd className="break-words">{k==='unit'?c(product[k]):k==='active'?c(product[k]?'yes':'no'):Array.isArray(product[k])?product[k].map(code=><span className="block whitespace-nowrap" key={code}><CopyableCode kind="barcode">{code}</CopyableCode></span>):product[k]||'—'}</dd></div>)}</dl></details></td></tr>)}</Table><Pager data={{page,pageSize:25,total:preview.rows.length}} setPage={setPage} c={c}/></>}
        {preview.id&&<><p className="text-xs text-slate-500">{ar?'تُضاف المنتجات فقط. لا تتغير كميات المخزون أو المنتجات الحالية.':'Adds products only. Existing products and stock quantities stay unchanged.'}</p><button className={primaryClass} disabled={busy||!!preview.issues.length} onClick={commit}>{c(busy?'saving':'confirmImport')}</button></>}
      </div>}
      <div className="flex justify-between gap-3"><button className="text-sm text-slate-500 underline disabled:opacity-50" disabled={busy} onClick={dismiss}>{c('cancel')}</button>{file&&<button className="text-sm text-slate-500 underline disabled:opacity-50" disabled={busy} onClick={discardDraft}>{ar?'حذف المسودة':'Discard draft'}</button>}</div>
    </>}
  </Modal>;
}
