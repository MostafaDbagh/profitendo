import { useState } from 'react';
import { Feedback, Modal, Pager, Table, buttonClass, primaryClass } from '../business-v2/UI';
import { inputClass } from '../auth-v2/Fields';
const labels={name:'productName',sku:'sku',unit:'unit',purchasePrice:'purchasePrice',sellingPrice:'sellingPrice',minimumStock:'minimumStock',category:'category',subcategory:'subcategory',brand:'brand',description:'description',barcodes:'barcodes',active:'active','sku/barcodes':'barcodes',row:'importRow'};
function readFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('INVALID_WORKBOOK'));reader.readAsDataURL(file);});}
export default function ProductImport({businessId,api,c,lang,close,done,returnFocus}){
  const path=`/businesses/${businessId}/product-imports`;
  const [file,setFile]=useState(null),[preview,setPreview]=useState(null),[result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[page,setPage]=useState(1);
  async function discard(){if(preview?.id)await api(`${path}/${preview.id}/discard`,{method:'POST',body:{}});}
  async function pick(e){const selected=e.target.files?.[0];setError('');setBusy(true);setPreview(null);setPage(1);setFile(null);try{await discard();if(selected){if(!/\.xlsx$/i.test(selected.name)||selected.size>1024*1024)throw new Error('INVALID_WORKBOOK');setFile(selected);}}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function upload(){setBusy(true);setError('');try{await discard();setPreview(null);setPage(1);setPreview(await api(`${path}/preview`,{method:'POST',body:{filename:file.name,fileBase64:await readFile(file)}}));}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function commit(){setBusy(true);setError('');try{setResult(await api(`${path}/${preview.id}/commit`,{method:'POST',body:{confirm:true}}));}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function download(){setBusy(true);setError('');try{const data=await api(`${path}/template`),bytes=Uint8Array.from(atob(data.fileBase64),v=>v.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=data.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e.message);}finally{setBusy(false);}}
  function dismiss(){
    if(result){done();return;}
    close();
    // Closing an uncommitted preview must not depend on connectivity. If cleanup
    // fails, the encrypted preview expires server-side and cannot add products.
    void discard().catch(()=>{});
  }
  const rows=preview?.rows.slice((page-1)*25,page*25)||[];
  return <Modal title={c('importProducts')} description={c('importHint')} {...{c,lang,busy,returnFocus}} close={dismiss}>
    <Feedback error={error} c={c}/>
    {result?<><p role="status" className="font-semibold text-emerald-700">{c('importCompleted')} · {result.count}</p><p className="text-sm text-slate-600">{c('importNoStock')}</p><button className={primaryClass} onClick={done}>{c('close')}</button></>:<>
      <button className={buttonClass} disabled={busy} onClick={download}>{c('downloadImportTemplate')}</button>
      <p className="text-xs text-slate-500">{c('importTemplateHint')}</p>
      <div><label htmlFor="product-import-file" className="block text-sm font-medium mb-1.5">{c('importFile')}</label><input id="product-import-file" className={inputClass} type="file" accept=".xlsx" disabled={busy} onChange={pick}/></div>
      <button className={buttonClass} disabled={busy||!file} onClick={upload}>{c(busy?'loading':'previewImport')}</button>
      {preview&&<div className="space-y-3 min-w-0"><p role="status" className="font-semibold text-sm">{c('importRows')}: {preview.total} · {c('pricesCurrency')}: {preview.currency}</p>
        {!!preview.issues.length&&<div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm"><p className="font-semibold">{c('importFixErrors')} ({preview.issues.length})</p><ul className="mt-2 max-h-48 overflow-y-auto space-y-1">{preview.issues.slice(0,50).map((issue,i)=><li key={i}>{c('importRow')} {issue.row} · {c(labels[issue.field]||'importRow')}: {c(issue.code)}</li>)}</ul>{preview.issues.length>50&&<p>{c('importFirstErrors')}</p>}</div>}
        {!!rows.length&&<><Table headers={['importRow','productName','sku','purchasePrice','sellingPrice','importDetails']} c={c} tableClassName="min-w-[680px]">{rows.map(({row,product})=><tr key={row}><td className="px-5 py-3">{row}</td><td className="px-5 py-3">{product.name}</td><td className="px-5 py-3"><span dir="ltr">{product.sku}</span></td><td className="px-5 py-3"><span dir="ltr">{product.purchasePrice}</span></td><td className="px-5 py-3"><span dir="ltr">{product.sellingPrice}</span></td><td className="px-5 py-3"><details><summary className="cursor-pointer text-emerald-700">{c('importDetails')}</summary><dl className="space-y-2 mt-2 min-w-40">{['unit','category','subcategory','brand','description','minimumStock','barcodes','active'].map(k=><div key={k}><dt className="text-xs text-slate-500">{c(labels[k])}</dt><dd className="break-words">{k==='unit'?c(product[k]):k==='active'?c(product[k]?'yes':'no'):Array.isArray(product[k])?product[k].join(', '):product[k]||'—'}</dd></div>)}</dl></details></td></tr>)}</Table><Pager data={{page,pageSize:25,total:preview.rows.length}} setPage={setPage} c={c}/></>}
        {preview.id&&<><p className="text-sm text-slate-600">{c('importConfirmHint')}</p><button className={primaryClass} disabled={busy||!!preview.issues.length} onClick={commit}>{c(busy?'saving':'confirmImport')}</button></>}
      </div>}
      <button className={buttonClass} disabled={busy} onClick={dismiss}>{c('cancel')}</button>
    </>}
  </Modal>;
}
