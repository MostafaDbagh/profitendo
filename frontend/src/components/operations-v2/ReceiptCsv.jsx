import {useId,useRef,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {buttonClass,primaryClass} from '../business-v2/UI';
import {inputClass} from '../auth-v2/Fields';
import {downloadCsv} from '../completion-v2/Shared';
import {useLocalDraft,LocalDraftNotice} from '../../lib/localDraft';
import ProductSearch from './ProductSearch';
import ProductForm from '../catalogue-v2/ProductForm';
import {receiptCsv,csvCell} from './receiptCsvUtils';
import {readReceiptWorkbook} from './readReceiptWorkbook';
import {importFields,fieldLabels,detectMapping,readCsvGrid,mappedRows,inspectRows,readyLines,canApply,unitCode,decimal} from './receiptImport';
const messages={
 CREATE_DETAILS:['أدخل اسم المنتج وتكلفة الوحدة أولاً، أو استخدم إضافة المنتج.','Enter the product name and unit cost first, or use Add product.'],
 CREATE_FAILED:['تعذرت إضافة المنتج. راجع بيانات السطر وأعد المحاولة.','Could not add the product. Check the row and retry.'],
 MISSING:['هذا المنتج غير موجود في قائمة منتجاتك النشطة. أضفه أولاً.','This item is not in your active product list. Add it first.'],
 AMBIGUOUS:['يوجد أكثر من تطابق. اختر المنتج الصحيح.','Multiple matches. Select the correct product.'],
 QUANTITY:['أدخل كمية موجبة حتى ٤ منازل عشرية.','Enter a positive quantity with up to 4 decimal places.'],
 COST:['تحقق من تكلفة الوحدة وسعر البيع.','Check unit cost and selling price.'],
 IDENTIFIER:['أدخل رمز الصنف أو الباركود أو الاسم.','Enter SKU, barcode or name.'],
 UNIT:['الوحدة لا تطابق الوحدة الأساسية للمنتج. صححها والكمية.','Unit differs from the product base unit. Correct the unit and quantity.'],
 DUPLICATE:['منتج مكرر في الملف. عدّل السطر أو استبعده.','Duplicate product in file. Edit or exclude this row.'],
 CONFLICT:['المنتج موجود في المسودة بكمية أو تكلفة مختلفة.','Product already exists in the draft with different quantity or cost.'],
 LIMIT:['المسودة تتجاوز ١٠٠ صنف. استبعد بعض الصفوف.','Draft exceeds 100 items. Exclude some rows.'],
 LOOKUP:['تعذر التحقق. أعد المحاولة.','Could not verify. Retry.'],
 READY:['جاهز','Ready'],EXISTS:['موجود في المسودة — لن يتكرر','Already in draft — will not duplicate'],SKIPPED:['مستبعد','Excluded'],
 MAPPING:['اختر عمود الكمية ومعرّف المنتج، ولا تربط نفس الحقل مرتين.','Map quantity and a product identifier; map each field only once.'],
 CSV:['استخدم ملفاً بحد أقصى ١ ميغابايت و١٠٠ صنف و١٠٠ عمود، مع صف عناوين.','Use a file up to 1 MB, 100 items and 100 columns, with a header row.'],
 WORKBOOK:['تعذر قراءة Excel. استخدم XLSX دون خلايا مدمجة، بحد أقصى ١٠٠ صنف و١٠٠ عمود لكل ورقة.','Could not read Excel. Use XLSX without merged cells, up to 100 items and 100 columns per sheet.'],
 FORMULA:['حوّل الصيغ والروابط والتواريخ إلى قيم نصية أو رقمية قبل الاستيراد.','Convert formulas, links and dates to plain text or numbers before importing.']
};
export default function ReceiptCsv({api,root,lang,cost,lines,onImport,disabled,onBusy,context,c}){
 const ar=lang==='ar',file=useRef(null),lock=useRef(false),footerHintId=useId();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [sheets,setSheets]=useState([]),[sheet,setSheet]=useState(0),[mapping,setMapping]=useState([]),[rows,setRows]=useState([]),[active,setActive]=useState(null),[creating,setCreating]=useState(false);
 const draft=useLocalDraft('receipt-import-review',{sheets,sheet,mapping,rows},saved=>{setSheets(saved.sheets);setSheet(saved.sheet);setMapping(saved.mapping);setRows(saved.rows);});
 const text=key=>(messages[key]||messages.LOOKUP)[ar?0:1];
 const fields=importFields.filter(key=>cost||!['unitCost','sellingPrice'].includes(key));
 const label=key=>fieldLabels[ar?'ar':'en'][importFields.indexOf(key)];
 const canCreate=Boolean(cost&&context?.permissions['catalogue.create']&&context?.permissions['catalogue.cost']);
 async function run(action){
  if(disabled||lock.current)return;lock.current=true;setBusy(true);onBusy(true);setError('');setNotice('');
  try{await action();}catch(e){setError(text(e.message));}finally{lock.current=false;setBusy(false);onBusy(false);}
 }
 function reset(){setSheets([]);setRows([]);setMapping([]);setActive(null);setCreating(false);setError('');setNotice('');draft.clear();}
 async function upload(event){
  const selected=event.target.files?.[0];event.target.value='';if(!selected)return;
  await run(async()=>{
   if(selected.size>1000000)throw Error('CSV');
   const incoming=/\.xlsx$/i.test(selected.name||'')?await readReceiptWorkbook(await selected.arrayBuffer()):[{name:ar?'CSV':'CSV',grid:readCsvGrid(await selected.text())}];
   setSheets(incoming);setSheet(0);setMapping(detectMapping(incoming[0].grid[0]).map(key=>fields.includes(key)?key:''));setRows([]);setActive(null);setCreating(false);
  });
 }
 async function review(){await run(async()=>{const next=mappedRows(sheets[sheet].grid,mapping,cost);setRows(await inspectRows(next,api,root,lines,cost));});}
 function edit(index,key,value){setRows(previous=>previous.map((row,i)=>i===index?{...row,[key]:value,status:null,...(['sku','barcode','name'].includes(key)?{product:null}:{})}:row));}
 async function check(){await run(async()=>setRows(await inspectRows(rows,api,root,lines,cost)));}
 async function apply(){await run(async()=>{
  const checked=await inspectRows(rows,api,root,lines,cost);setRows(checked);
  if(!canApply(checked))return;
  const items=readyLines(checked);if(items.length)onImport(items);
  reset();setNotice(ar?'أُضيفت الأصناف إلى مسودة الشراء. لا يتغير المخزون حتى تأكيد الاستلام.':'Items added to the purchase draft. Stock changes only after confirming receipt.');
 });}
 async function autoAdd(index){
  if(!canCreate||rows[index]?.status!=='MISSING'||rows[index]?.skip)return;
  await run(async()=>{
   // Recheck first: a previous request or another user may have created it already.
   const checked=await inspectRows(rows,api,root,lines,cost);setRows(checked);
   const row=checked[index];if(row.status!=='MISSING')return;
   if(!row.name?.trim()||row.name.trim().length<2||!decimal(row.unitCost))throw Error('CREATE_DETAILS');
   let product;
   try{
    product=await api(`${root}/products`,{method:'POST',body:{
     name:row.name.trim(),...(row.sku?.trim()?{sku:row.sku.trim()}:{}),
     unit:unitCode(row.unit?.trim()),purchasePrice:decimal(row.unitCost),
     sellingPrice:decimal(row.sellingPrice)||'0',barcodes:row.barcode?.trim()?[row.barcode.trim()]:[],
     minimumStock:'0',active:true,
    }});
   }catch(e){setError(c?.(e.message)&&c(e.message)!==e.message?c(e.message):text('CREATE_FAILED'));return;}
   const linked=checked.map((item,i)=>i===index?{...item,product,sku:product.sku,name:product.name,status:null}:item);
   setRows(linked);
   setRows(await inspectRows(linked,api,root,lines,cost));
   setNotice(ar?'تمت إضافة المنتج. أضف الأصناف المراجعة إلى المسودة للمتابعة.':'Product added. Add the reviewed items to the draft to continue.');
  });
 }
 function match(product){if(product.active===false)return;setRows(previous=>previous.map((row,i)=>i===active?{...row,product,sku:product.sku,name:product.name,status:null}:row));setActive(null);}
 function exportReview(){
  const headers=fields.map(label);
  downloadCsv({filename:'purchase-import-review.csv',csv:[headers.map(csvCell).join(','),...rows.map(row=>fields.map(key=>csvCell(row[key])).join(','))].join('\r\n')});
 }
 const current=active==null?null:rows[active];
 const needsRecheck=rows.some(row=>!row.skip&&!row.status);
 const footerHint=busy?(ar?'جارٍ التحقق من الأصناف…':'Checking items…'):disabled?(ar?'أكمل العملية الحالية للمتابعة.':'Finish the current operation to continue.'):!canApply(rows)?(needsRecheck?(ar?'أعد التحقق بعد تعديل الصفوف.':'Recheck the edited rows.'):(ar?'صحّح الصفوف المحددة أو استبعدها للمتابعة.':'Correct or exclude the highlighted rows to continue.')):'';
 const quietAction='inline-flex min-h-9 items-center justify-center rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 underline underline-offset-4 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50';
 return <div className="space-y-3">
  <div className="flex flex-wrap gap-2">
   <input ref={file} type="file" accept=".csv,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" aria-label={ar?'استيراد ملف':'Import file'} onChange={upload} disabled={disabled||busy}/>
   <button type="button" className={buttonClass} disabled={disabled||busy} onClick={()=>file.current.click()}><Upload className="h-4 w-4" aria-hidden="true"/>{busy?(ar?'جارٍ التحقق…':'Checking…'):(ar?'استيراد CSV / Excel':'Import CSV / Excel')}</button>
   <button type="button" className={buttonClass} disabled={disabled||busy||!lines.length} onClick={()=>downloadCsv({filename:'receipt-items.csv',csv:receiptCsv(lines,cost,lang)})}><Download className="h-4 w-4" aria-hidden="true"/>{ar?'تصدير المسودة CSV':'Export draft CSV'}</button>
   <button type="button" className={buttonClass} disabled={disabled||busy} onClick={()=>downloadCsv({filename:'receipt-template.csv',csv:receiptCsv([],cost,lang)+'\r\n'})}>{ar?'تنزيل قالب CSV':'Download CSV template'}</button>
  </div>
  <p className="text-xs text-slate-500">{ar?'حتى ١٠٠ عمود و١٠٠ صنف. نستخدم الحقول المدعومة فقط ونتجاهل البقية. راجع المطابقة والكميات قبل الإضافة؛ الكميات بالوحدة الأساسية.':'Up to 100 columns and 100 items. Only supported fields are used; extra columns are ignored. Review matches and base-unit quantities before adding.'}</p>
  <LocalDraftNotice {...{draft,lang,busy}}/>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-emerald-700">{notice}</p>}
  {!!sheets.length&&<section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" aria-label={ar?'مراجعة الاستيراد':'Import review'}>
   {!rows.length&&<>
    {sheets.length>1&&<label className="block text-sm">{ar?'ورقة Excel':'Worksheet'}<select className={inputClass} value={sheet} disabled={busy||disabled} onChange={e=>{const i=Number(e.target.value);setSheet(i);setMapping(detectMapping(sheets[i].grid[0]).map(key=>fields.includes(key)?key:''));}}>{sheets.map((item,i)=><option key={i} value={i}>{item.name}</option>)}</select></label>}
    <h3 className="font-semibold">{ar?'مطابقة الأعمدة':'Map columns'}</h3>
    <p className="text-sm text-slate-500">{ar?'الأعمدة غير المعروفة تُتجاهل تلقائياً. يمكنك ربطها بحقل مدعوم.':'Unrecognized columns are ignored automatically. You can map them to a supported field.'}</p>
    <div className="grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{sheets[sheet].grid[0].map((header,i)=><label key={i} className="min-w-0 text-sm"><span className="block truncate" title={header}>{header||`${ar?'عمود':'Column'} ${i+1}`}</span><select aria-label={`${ar?'ربط العمود':'Map column'} ${i+1}`} className={inputClass} value={mapping[i]} disabled={busy||disabled} onChange={e=>setMapping(old=>old.map((key,n)=>n===i?e.target.value:key))}><option value="">{ar?'تجاهل':'Ignore'}</option>{fields.map(key=><option key={key} value={key}>{label(key)}</option>)}</select></label>)}</div>
    <button type="button" className={primaryClass} disabled={busy||disabled} onClick={review}>{ar?'معاينة الأصناف':'Preview items'}</button>
   </>}
   {!!rows.length&&<>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{ar?'مراجعة الأصناف':'Review items'} ({rows.length})</h3><button type="button" className={buttonClass} onClick={exportReview} disabled={busy||disabled}><Download className="h-4 w-4" aria-hidden="true"/>{ar?'تصدير المعاينة CSV':'Export preview CSV'}</button></div>
    <p className="text-sm text-slate-500">{ar?'الصفوف الحمراء تحتاج تصحيحاً أو إضافة المنتج أولاً. يمكنك تصديرها أو استبعادها. الإضافة التلقائية تنشئ المنتج من بيانات السطر عند الضغط عليها فقط؛ المخزون لا يتغير.':'Red rows need correction or the product added first. You can export or exclude them. Auto-add creates the product from the row only when clicked; stock stays unchanged.'}</p>
    <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[850px] text-start text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-start">{ar?'تضمين':'Include'}</th>{fields.map(key=><th key={key} className="p-2 text-start">{label(key)}</th>)}<th className="p-2 text-start">{ar?'الحالة':'Status'}</th></tr></thead><tbody>{rows.map((row,index)=>{
     const problem=row.status&&!['READY','EXISTS','SKIPPED'].includes(row.status);
     return <tr key={index} data-import-row={row.sourceRow} className={problem?'border-t border-red-200 bg-red-50':'border-t border-slate-100'}>
      <td className="p-2"><label className="flex items-center gap-2"><input type="checkbox" checked={!row.skip} disabled={busy||disabled} onChange={e=>edit(index,'skip',!e.target.checked)} aria-label={`${ar?'تضمين السطر':'Include row'} ${row.sourceRow}`}/>{row.sourceRow}</label></td>
      {fields.map(key=><td key={key} className="p-2"><input aria-label={`${label(key)} ${row.sourceRow}`} className={`${inputClass} min-w-24 ${problem?'!border-red-200 !bg-red-50':''}`} value={row[key]||''} disabled={busy||disabled||row.skip} maxLength={key==='name'?160:128} onChange={e=>edit(index,key,e.target.value)} inputMode={['quantity','unitCost','sellingPrice'].includes(key)?'decimal':undefined}/></td>)}
      <td className="min-w-64 space-y-2 p-2"><p className={problem?'text-red-700':'text-slate-600'}>{row.status?text(row.status):(ar?'أعد التحقق بعد التعديل':'Recheck after editing')}</p>
       {row.product&&<p className="text-xs text-slate-500">{row.product.name} · <bdi>{row.product.sku}</bdi> · {row.product.unit}</p>}
       {problem&&<div className="flex flex-wrap gap-2">{canCreate&&row.status==='MISSING'?<button type="button" className={primaryClass} disabled={busy||disabled||row.skip} onClick={()=>autoAdd(index)}>{ar?'إضافة تلقائية':'Auto-add'}</button>:<button type="button" className={buttonClass} disabled={busy||disabled} onClick={()=>setActive(index)}>{ar?'اختيار منتج':'Choose product'}</button>}{canCreate&&row.status==='MISSING'&&<button type="button" className={buttonClass} disabled={busy||disabled} onClick={()=>{setActive(index);setCreating(true);}}>{ar?'إضافة المنتج':'Add product'}</button>}</div>}
      </td></tr>;
    })}</tbody></table></div>
    {current&&!creating&&<div className="space-y-2 rounded-lg border border-slate-200 p-3"><p>{ar?'مطابقة السطر':'Match row'} {current.sourceRow}</p><ProductSearch {...{api,root,c,lang}} disabled={disabled||busy} onSelect={match}/><button type="button" className={buttonClass} onClick={()=>setActive(null)}>{ar?'إغلاق المطابقة':'Close matching'}</button></div>}
   </>}
   <div className="space-y-2 border-t border-slate-200 pt-3" dir={ar?'rtl':'ltr'}>
    {!!rows.length&&footerHint&&<p id={footerHintId} role="status" className="text-sm text-slate-600">{footerHint}</p>}
    <div role="group" aria-label={ar?'إجراءات الاستيراد':'Import actions'} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
     {!!rows.length&&<>
      <button type="button" className={`${primaryClass} w-full sm:w-auto`} disabled={busy||disabled||!canApply(rows)} aria-describedby={footerHint?footerHintId:undefined} onClick={apply}>{ar?'إضافة إلى المسودة':'Add to draft'}</button>
      <div className="flex flex-wrap items-center gap-2">
       <button type="button" className={buttonClass} disabled={busy||disabled} onClick={check}>{ar?'إعادة التحقق':'Recheck rows'}</button>
       <button type="button" className={quietAction} disabled={busy||disabled} onClick={()=>{setRows([]);setActive(null);}}>{ar?'تعديل ربط الأعمدة':'Change column mapping'}</button>
      </div>
     </>}
     <button type="button" className={`${quietAction} self-start sm:ms-auto sm:self-auto`} disabled={busy||disabled} onClick={reset}>{ar?'إلغاء الاستيراد':'Cancel import'}</button>
    </div>
   </div>
  </section>}
  {creating&&current&&<ProductForm {...{api,c,lang}} cost path={`${root}/products`} initialName={current.name||''} initialSku={current.sku||''} initialPurchasePrice={decimal(current.unitCost)} initialSellingPrice={decimal(current.sellingPrice)} initialBarcodes={current.barcode||''} initialUnit={unitCode(current.unit)} draftScope={`receipt-import:${current.sku||current.name||current.sourceRow}`} close={()=>{setCreating(false);setActive(null);}} done={(saved,product)=>{setCreating(false);if(saved&&product)match(product);else setActive(null);}}/>}
 </div>;
}
