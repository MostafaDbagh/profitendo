import {useRef,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {buttonClass} from '../business-v2/UI';
import {downloadCsv} from '../completion-v2/Shared';
import ProductSearch from './ProductSearch';
import ProductForm from '../catalogue-v2/ProductForm';
import {parseReceiptCsv,receiptCsv,resolveReceiptRows} from './receiptCsvUtils';

function importError(code, ar) {
 const [reason,line,...details]=code.split(':');
 const sku=details.join(':');
 if(reason==='HEADERS')return ar?'هذا ليس ملف أصناف استلام. استخدم ملف «تصدير CSV» من شاشة الاستلام أو القالب الموجود هنا.':'This is not a receipt items file. Use the CSV exported from Receive stock or the template on this screen.';
 if(reason==='ROW')return ar?`السطر ${line}: تحقق من رمز الصنف والكمية والتكلفة، وتأكد أن الرمز يظهر مرة واحدة في الملف.`:`Row ${line}: Check the SKU, quantity, and cost, and make sure the SKU appears only once in the file.`;
 if(reason==='PRODUCT')return ar?`السطر ${line}: رمز الصنف «${sku}» غير موجود أو غير نشط. اختر المنتج المطابق أو أنشئ منتجاً من الخيارات أدناه، ثم نكمل الملف المحفوظ.`:`Row ${line}: SKU “${sku}” was not found or is inactive. Match or create the product below to continue the retained file.`;
 if(reason==='CONFLICT')return ar?`السطر ${line}: الصنف موجود في المسودة بكمية أو تكلفة مختلفة. عدّل سطره في المسودة أو أزله قبل استيراده.`:`Row ${line}: This item already has a different quantity or cost in the draft. Edit the draft line or remove it before importing.`;
 if(reason==='CSV')return ar?'تحقق من أن الملف صالح وأن المسودة بعد الاستيراد لا تتجاوز ١٠٠ صنف.':'Check that the file is valid and the resulting draft has at most 100 items.';
 if(reason==='FORBIDDEN')return ar?'لا تملك صلاحية البحث عن المنتجات المطلوبة.':'You do not have permission to look up the required products.';
 return ar?'تعذّر التحقق من الأصناف. حاول مرة أخرى.':'Could not verify the items. Try again.';
}

export default function ReceiptCsv({api,root,lang,cost,lines,onImport,disabled,onBusy,context,c}){
 const ar=lang==='ar',file=useRef(null),lock=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [pending,setPending]=useState(null),[creating,setCreating]=useState(false);
 const canCreate=Boolean(context?.permissions['catalogue.create']&&context?.permissions['catalogue.cost']&&cost);
 async function process(rows){
  if(lock.current)return;
  lock.current=true;setBusy(true);onBusy(true);setError('');setNotice('');
  try{
   const imported=await resolveReceiptRows(rows,api,root,lines,cost);
   if(imported.length)onImport(imported);
   setPending(null);
   setNotice(imported.length?(ar?'أُضيفت أصناف الملف إلى المسودة. راجعها قبل تأكيد الاستلام.':'File items added to the draft. Review before confirming receipt.'):(ar?'الملف يطابق أصناف المسودة.':'The file matches items already in the draft.'));
  }catch(e){
   const parts=e.message.split(':');
   setPending({rows,index:parts[0]==='PRODUCT'?Number(parts[1])-2:null});
   setError(`${importError(e.message,ar)} ${ar?'لم تُضف أي أصناف إلى المسودة.':'No items were added.'}`);
  }finally{lock.current=false;setBusy(false);onBusy(false);}
 }
 function match(product){
  if(!product?.active&&product?.active!==undefined)return;
  const rows=pending.rows.map((row,index)=>index===pending.index?{...row,sku:product.sku}:row);
  process(rows);
 }
 async function upload(event){
  const selected=event.target.files?.[0];event.target.value='';if(!selected||lock.current)return;
  try{
   if(selected.size>1000000)throw new Error('CSV');
   const rows=parseReceiptCsv(await selected.text(),cost,true);
   setPending(null);await process(rows);
  }catch(e){setPending(null);setError(importError(e.message,ar));}
 }
 const missing=pending?.index!=null?pending.rows[pending.index]:null;

 return <div className="space-y-2">
  <div className="flex flex-wrap gap-2">
   <input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-label={ar?'استيراد CSV':'Import CSV'} onChange={upload} disabled={disabled||busy}/>
   <button type="button" className={buttonClass} disabled={disabled||busy} onClick={()=>file.current.click()}><Upload className="h-4 w-4" aria-hidden="true"/>{busy?(ar?'جارٍ الاستيراد…':'Importing…'):(ar?'استيراد CSV':'Import CSV')}</button>
   <button type="button" className={buttonClass} disabled={disabled||busy||!lines.length} onClick={()=>downloadCsv({filename:'receipt-items.csv',csv:receiptCsv(lines,cost,lang)})}><Download className="h-4 w-4" aria-hidden="true"/>{ar?'تصدير CSV':'Export CSV'}</button>
   <button type="button" className={buttonClass} disabled={disabled||busy} onClick={()=>downloadCsv({filename:'receipt-template.csv',csv:receiptCsv([],cost,lang)+'\r\n'})}>{ar?'تنزيل قالب CSV':'Download CSV template'}</button>
  </div>
  <p className="text-xs text-slate-500">{ar?'استورد رمز الصنف واسم المنتج والوحدة والكمية وتكلفة الوحدة. نطابق المنتجات الموجودة بالرمز، ويمكنك إنشاء المنتجات الجديدة هنا بعد مراجعة بياناتها. التصدير يشمل أصناف المسودة فقط، ولا يتغير المخزون حتى تأكيد الاستلام.':'Import SKU, product name, unit, quantity and unit cost. Existing products match by SKU; new products can be created here after reviewing their details. Export includes only current draft items. Stock changes only after receipt confirmation.'}</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-emerald-700">{notice}</p>}
  {pending&&<div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
   <p className="text-sm font-medium">{ar?'الملف محفوظ هنا حتى اكتمال المطابقة. إنشاء منتج يحفظه في دليل المنتجات فقط؛ المخزون لا يتغير.':'Your file is retained here while you resolve it. Creating a product saves it to the catalogue only; stock does not change.'}</p>
   {missing&&<>
    <p className="text-sm">{ar?'السطر':'Row'} {pending.index+2}: <bdi>{missing.sku}</bdi>{missing.name&&` — ${missing.name}`} · {ar?'الكمية':'Quantity'}: {missing.quantity}</p>
    <ProductSearch {...{api,root,c,lang}} disabled={disabled||busy} onSelect={match} label={ar?'مطابقة مع منتج موجود':'Match an existing product'}/>
    {canCreate&&<button type="button" className={buttonClass} disabled={disabled||busy} onClick={()=>setCreating(true)}>{ar?'إنشاء المنتج وإكمال الاستيراد':'Create product and continue import'}</button>}
    {!canCreate&&<p className="text-sm text-slate-500">{ar?'إنشاء المنتجات يحتاج صلاحية إضافة المنتجات وعرض التكلفة. يمكنك مطابقة منتج موجود.':'Creating products requires product creation and cost access. You can match an existing product.'}</p>}
   </>}
   <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={disabled||busy} onClick={()=>process(pending.rows)}>{ar?'إعادة التحقق من الملف':'Retry retained file'}</button>
   <button type="button" className={buttonClass} disabled={disabled||busy} onClick={()=>{setPending(null);setError('');}}>{ar?'إلغاء الاستيراد':'Cancel import'}</button></div>
  </div>}
  {creating&&missing&&<ProductForm {...{api,c,lang}} cost path={`${root}/products`} initialName={missing.name} initialSku={missing.sku}
   initialPurchasePrice={missing.unitCost??''} draftScope={`receipt-import:${missing.sku}`}
   initialUnit={({قطعة:'PIECE',علبة:'BOX',كرتون:'CARTON',كيلوغرام:'KG',غرام:'GRAM',لتر:'LITRE',متر:'METRE'})[missing.unit]||missing.unit||'PIECE'}
   close={()=>setCreating(false)} done={(saved,product)=>{setCreating(false);if(saved&&product)match(product);}}/>}
 </div>;
}
