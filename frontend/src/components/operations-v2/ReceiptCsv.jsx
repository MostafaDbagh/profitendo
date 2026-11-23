import {useRef,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {buttonClass} from '../business-v2/UI';
import {downloadCsv} from '../completion-v2/Shared';
import {parseReceiptCsv,receiptCsv,resolveReceiptRows} from './receiptCsvUtils';
export default function ReceiptCsv({api,root,lang,cost,lines,onImport,disabled,onBusy}){
 const ar=lang==='ar',file=useRef(null),lock=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function upload(event){
  const selected=event.target.files?.[0];event.target.value='';if(!selected||lock.current)return;
  lock.current=true;setBusy(true);onBusy(true);setError('');setNotice('');
  try{
   if(selected.size>1000000)throw new Error('CSV');
   const rows=parseReceiptCsv(await selected.text(),cost);
   if(rows.length+lines.length>100)throw new Error('CSV');
   const imported=await resolveReceiptRows(rows,api,root,lines);
   onImport(imported);setNotice(ar?'أُضيفت الأصناف للمسودة. راجعها قبل تأكيد الاستلام.':'Items added to the draft. Review them before confirming receipt.');
  }catch(e){setError(ar?'تعذّر الاستيراد. استخدم القالب (حتى ١٠٠ صنف)، وتحقق من رموز المنتجات والكميات والتكرارات والصلاحيات. لم تُضف أي أصناف.':'Could not import. Use the template (up to 100 items), and check product SKUs, quantities, duplicates and permissions. No items were added.');}
  finally{lock.current=false;setBusy(false);onBusy(false);}
 }
 return <div className="space-y-2">
  <div className="flex flex-wrap gap-2">
   <input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-label={ar?'استيراد CSV':'Import CSV'} onChange={upload} disabled={disabled||busy}/>
   <button type="button" className={buttonClass} disabled={disabled||busy} onClick={()=>file.current.click()}><Upload className="h-4 w-4" aria-hidden="true"/>{busy?(ar?'جارٍ الاستيراد…':'Importing…'):(ar?'استيراد CSV':'Import CSV')}</button>
   <button type="button" className={buttonClass} disabled={disabled||busy||!lines.length} onClick={()=>downloadCsv({filename:'receipt-items.csv',csv:receiptCsv(lines,cost)})}><Download className="h-4 w-4" aria-hidden="true"/>{ar?'تصدير CSV':'Export CSV'}</button>
   <button type="button" className={buttonClass} disabled={disabled||busy} onClick={()=>downloadCsv({filename:'receipt-template.csv',csv:receiptCsv([],cost)+'\r\n'})}>{ar?'تنزيل قالب CSV':'Download CSV template'}</button>
  </div>
  <p className="text-xs text-slate-500">{ar?'استورد أصنافاً جديدة إلى المسودة باستخدام رمز المنتج والكمية بوحدته الأساسية. لا يتغير المخزون حتى تأكيد الاستلام.':'Import new draft items by SKU and base-unit quantity. Stock changes only after receipt confirmation.'}</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-emerald-700">{notice}</p>}
 </div>;
}
