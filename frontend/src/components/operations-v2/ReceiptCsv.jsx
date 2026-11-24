import {useRef,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {buttonClass} from '../business-v2/UI';
import {downloadCsv} from '../completion-v2/Shared';
import {parseReceiptCsv,receiptCsv,resolveReceiptRows} from './receiptCsvUtils';

function importError(code, ar) {
 const [reason,line,...details]=code.split(':');
 const sku=details.join(':');
 if(reason==='HEADERS')return ar?'هذا ليس ملف أصناف استلام. استخدم ملف «تصدير CSV» من شاشة الاستلام أو القالب الموجود هنا.':'This is not a receipt items file. Use the CSV exported from Receive stock or the template on this screen.';
 if(reason==='ROW')return ar?`السطر ${line}: تحقق من رمز الصنف والكمية والتكلفة، وتأكد أن الرمز يظهر مرة واحدة في الملف.`:`Row ${line}: Check the SKU, quantity, and cost, and make sure the SKU appears only once in the file.`;
 if(reason==='PRODUCT')return ar?`السطر ${line}: رمز الصنف «${sku}» غير موجود أو غير نشط. أدخل رمز منتج موجود من صفحة المنتجات، أو أضف المنتج هناك أولاً ثم أعد الاستيراد.`:`Row ${line}: SKU “${sku}” was not found or is inactive. Use an existing SKU from Products, or create the product there first and import again.`;
 if(reason==='CONFLICT')return ar?`السطر ${line}: الصنف موجود في المسودة بكمية أو تكلفة مختلفة. عدّل سطره في المسودة أو أزله قبل استيراده.`:`Row ${line}: This item already has a different quantity or cost in the draft. Edit the draft line or remove it before importing.`;
 if(reason==='CSV')return ar?'تحقق من أن الملف صالح وأن المسودة بعد الاستيراد لا تتجاوز ١٠٠ صنف.':'Check that the file is valid and the resulting draft has at most 100 items.';
 if(reason==='FORBIDDEN')return ar?'لا تملك صلاحية البحث عن المنتجات المطلوبة.':'You do not have permission to look up the required products.';
 return ar?'تعذّر التحقق من الأصناف. حاول مرة أخرى.':'Could not verify the items. Try again.';
}

export default function ReceiptCsv({api,root,lang,cost,lines,onImport,disabled,onBusy}){
 const ar=lang==='ar',file=useRef(null),lock=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function upload(event){
  const selected=event.target.files?.[0];event.target.value='';if(!selected||lock.current)return;
  lock.current=true;setBusy(true);onBusy(true);setError('');setNotice('');
  try{
   if(selected.size>1000000)throw new Error('CSV');
   const rows=parseReceiptCsv(await selected.text(),cost);
   const imported=await resolveReceiptRows(rows,api,root,lines,cost);
   if(imported.length){
    onImport(imported);
    setNotice(ar?'أُضيفت الأصناف الجديدة للمسودة. راجعها قبل تأكيد الاستلام.':'New items were added to the draft. Review them before confirming receipt.');
   }else{
    setNotice(ar?'الملف يطابق الأصناف الموجودة في المسودة.':'The file matches items already in the draft.');
   }
  }catch(e){setError(`${importError(e.message,ar)} ${ar?'لم تُضف أي أصناف.':'No items were added.'}`);}
  finally{lock.current=false;setBusy(false);onBusy(false);}
 }
 return <div className="space-y-2">
  <div className="flex flex-wrap gap-2">
   <input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-label={ar?'استيراد CSV':'Import CSV'} onChange={upload} disabled={disabled||busy}/>
   <button type="button" className={buttonClass} disabled={disabled||busy} onClick={()=>file.current.click()}><Upload className="h-4 w-4" aria-hidden="true"/>{busy?(ar?'جارٍ الاستيراد…':'Importing…'):(ar?'استيراد CSV':'Import CSV')}</button>
   <button type="button" className={buttonClass} disabled={disabled||busy||!lines.length} onClick={()=>downloadCsv({filename:'receipt-items.csv',csv:receiptCsv(lines,cost,lang)})}><Download className="h-4 w-4" aria-hidden="true"/>{ar?'تصدير CSV':'Export CSV'}</button>
   <button type="button" className={buttonClass} disabled={disabled||busy} onClick={()=>downloadCsv({filename:'receipt-template.csv',csv:receiptCsv([],cost,lang)+'\r\n'})}>{ar?'تنزيل قالب CSV':'Download CSV template'}</button>
  </div>
  <p className="text-xs text-slate-500">{ar?'التصدير يشمل أصناف المسودة الحالية فقط. للاستيراد استخدم رمز صنف موجود في صفحة المنتجات، وليس اسم المنتج. اسم المنتج والوحدة للتوضيح فقط؛ الكمية بالوحدة الأساسية والتكلفة لكل وحدة. أضف المنتجات الجديدة في صفحة المنتجات أولاً. لا يتغير المخزون حتى تأكيد الاستلام.':'Export includes only the current draft items. Import using an existing SKU from Products, not the product name. Name and unit are for reference only; enter base-unit quantities and cost per unit. Create new products in Products first. Stock changes only after receipt confirmation.'}</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-emerald-700">{notice}</p>}
 </div>;
}
