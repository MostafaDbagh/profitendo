import {PageHeader} from '../page-layout/PageLayout';
import LocationChips from '../business-v2/LocationChips';
import ReceiptCsv from './ReceiptCsv';
import RequiredMark from '../RequiredMark';
import Disclosure from '../business-v2/Disclosure';
import { selectInputOnFocus } from '../../lib/selectInputOnFocus';
import SupplierForm from './SupplierForm';
import { formatQuantity } from '@/lib/quantity';
import CopyableCode from '@/components/CopyableCode';
import ScanModeSelect from './ScanModeSelect';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import ProductEntryHelp from './ProductEntryHelp';
import ProductSearch from './ProductSearch';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { unitLabel } from '../catalogue-v2/units';
import Totals, {displayAmount} from './Totals';
import ReceiptSteps from './ReceiptSteps';
import { useEffect, useId, useRef, useState } from 'react';
import { Field, inputClass } from '../auth-v2/Fields';
import { Feedback, buttonClass, primaryClass, panelClass } from '../business-v2/UI';
import SupplierSearch from './SupplierSearch';
import './receipt-line.css';
const scaled=v=>{const [w,f='']=v.split('.');return BigInt(w)*10000n+BigInt(f.padEnd(4,'0'));};
const fixed=n=>`${n/10000n}.${String(n%10000n).padStart(4,'0')}`;
export default function DocumentEditor({context,api,c,lang,kind,document:doc,seed,close,done,embedded=false,onBusyChange}){
 const formId=useId(),productSearchRef=useRef(null);
 const cost=context.permissions['catalogue.cost'],root=`/businesses/${context.business.id}`,source=doc||seed;
 const [clientKey,setClientKey]=useState(()=>crypto.randomUUID()),[location,setLocation]=useState(source?.locationId?{id:source.locationId,name:source.locationName}:null),[supplier,setSupplier]=useState(source?.supplierId?{id:source.supplierId,name:source.supplierName}:null);
 const [date,setDate]=useState(doc?.documentDate||new Date().toLocaleDateString('en-CA')),[reference,setReference]=useState(doc?.supplierReference||''),[notes,setNotes]=useState(doc?.notes||'');
 const [lines,setLines]=useState(()=>source?.lines.map(l=>({...l,productId:l.productId,quantity:formatQuantity(doc?l.baseQuantity:fixed(scaled(l.baseQuantity)-scaled(l.receivedQuantity))),unitCost:l.unitCost??''})).filter(l=>scaled(l.quantity)>0n)||[]);
 const [scan,setScan]=useState(''),[mode,setMode]=useState('once'),[scanning,setScanning]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [addingSupplier,setAddingSupplier]=useState(false);
 const [importing,setImporting]=useState(false);
 useEffect(()=>{onBusyChange?.(busy||scanning||importing);return ()=>onBusyChange?.(false);},[busy,scanning,importing,onBusyChange]);
 const plannedReceipt=Boolean(seed?.plannedItems?.length||doc?.lines.some(line=>line.plannedItemId));
 const canChooseSupplier=!doc&&!seed?.supplierId;
 const [focusProduct,setFocusProduct]=useState('');
 const scanRef=useRef(null),scanLock=useRef(false),scanQueue=useRef([]),trigger=useRef(null),quantityRefs=useRef({});
 useEffect(()=>{if(focusProduct&&quantityRefs.current[focusProduct]){quantityRefs.current[focusProduct].focus();quantityRefs.current[focusProduct].select();setFocusProduct('');}},[focusProduct,lines]);
 const draft=useLocalDraft(`purchase:${kind}:${doc?.id||seed?.id||'new'}:${doc?.revision||0}`,{clientKey,location,supplier,date,reference,notes,lines,scan,mode},saved=>{setClientKey(saved.clientKey);setLocation(saved.location);setSupplier(saved.supplier);setDate(saved.date);setReference(saved.reference);setNotes(saved.notes);setLines(saved.lines.map(l=>({...l,quantity:formatQuantity(l.quantity)})));setScan(saved.scan);setMode(saved.mode);});
 function add(product,repeated=false){
  setError('');setNotice('lineAdded');
  setLines(old=>{const exists=old.find(l=>l.productId===product.id);if(exists&&repeated&&!/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(exists.quantity||'')){setError('INVALID_QUANTITY');return old;}if(exists)return repeated?old.map(l=>l.productId===product.id?{...l,quantity:formatQuantity(fixed(scaled(l.quantity||'0')+10000n))}:l):old;
   return [...old,{productId:product.id,name:product.name,sku:product.sku,unit:product.unit,quantity:'1',unitCost:product.purchasePrice||''}];});
  if(!repeated)setFocusProduct(product.id);
 }
 function addPlannedProduct(item, product) {
  if (lines.some(line => line.productId === product.id)) {
   setError('duplicatePlannedProduct');
   return;
  }
  setError('');
  setLines(current => [...current, {
   productId: product.id, plannedItemId: item.id, name: product.name, sku: product.sku, unit: product.unit,
   quantity: formatQuantity(fixed(scaled(item.quantity) - scaled(item.receivedQuantity))),
   unitCost: product.purchasePrice ?? '',
  }]);
  setFocusProduct(product.id);
 }
 async function lookup(e){
  e.preventDefault();if(busy||importing||!scan.trim())return;
  scanQueue.current.push({barcode:scan.trim(),mode});setScan('');
  if(scanLock.current)return;
  scanLock.current=true;setScanning(true);setError('');
  try{while(scanQueue.current.length){
   const next=scanQueue.current.shift();
   try{draft.checkpoint({});const result=await api(`${root}/products/barcode?value=${encodeURIComponent(next.barcode)}`);add(result.product,next.mode==='repeat');}
   catch(e){setError(e.message);}
   if(next.mode==='repeat')scanRef.current?.focus();
  }}finally{scanLock.current=false;setScanning(false);}
 }
 function edit(index,key,value){setLines(old=>old.map((l,i)=>i===index?{...l,[key]:value}:l));}
 async function save(e){e.preventDefault();if(busy||scanning||importing)return;if(!lines.length){setError('noLines');return;}setBusy(true);setError('');
  try{const common={documentDate:date,supplierReference:reference,notes,lines:lines.map(l=>({productId:l.productId,quantity:l.quantity,...(l.plannedItemId?{plannedItemId:l.plannedItemId}:{}),...(cost?{unitCost:l.unitCost}:{} )}))};
   const result=await api(doc?`${root}/operations/purchases/${doc.id}`:`${root}/operations/purchases`,{method:doc?'PATCH':'POST',body:doc?{...common,revision:doc.revision}:{...common,clientKey,kind,locationId:location?.id,supplierId:supplier?.id,...(seed?{orderId:seed.id}:{})}});
   draft.clear();done(result);
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const amountPattern=/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/;
 const lineTotal=line=>{
  if(!amountPattern.test(line.quantity)||!amountPattern.test(line.unitCost))return '—';
  const value=scaled(line.quantity)*scaled(line.unitCost);
  return displayAmount(`${value/100000000n}.${String(value%100000000n).padStart(8,'0')}`);
 };
 const validNumber='(0|[1-9][0-9]{0,13})([.][0-9]{1,4})?';
 const addingPurchase=kind==='RECEIPT'&&!doc&&!seed;
 return <section className="mx-auto w-full max-w-5xl space-y-5">
 <header className="flex flex-wrap items-center justify-between gap-3">
  {(addingPurchase||!embedded)&&<PageHeader title={addingPurchase?(lang==='ar'?'إضافة شراء':'Add purchase'):c(kind==='ORDER'?'newOrder':'newReceipt')}/>}
  <button type="button" className={buttonClass} disabled={busy||scanning||importing} onClick={close}>
   <ArrowRight aria-hidden="true" className={`h-4 w-4 ${lang==='ar'?'':'rotate-180'}`}/>
   {embedded?(lang==='ar'?'عرض سجل المشتريات':'Show purchase history'):c('back')}
  </button>
 </header>
 {kind==='RECEIPT'&&!seed&&!plannedReceipt&&<ReceiptCsv {...{api,root,lang,cost,lines}} disabled={busy||scanning} onBusy={setImporting} onImport={rows=>{setLines(old=>[...old,...rows]);setError('');}}/>}
 {kind==='RECEIPT'&&<ReceiptSteps stage={0} canConfirm={context.permissions['receiving.confirm']} c={c}/>}
 <div className={`${panelClass} grid gap-4 sm:grid-cols-2 lg:grid-cols-3`}>
 <LocationChips {...{context,api,c,lang}} value={location} onChange={setLocation} disabled={busy||importing} documentLocation={source?.locationId?{id:source.locationId,name:source.locationName}:null} required/>
 <div className="min-w-0 space-y-2">
  <SupplierSearch {...{api,c,lang}} path={`${root}/operations/suppliers`} value={supplier} onSelect={setSupplier}
   disabled={busy||importing||!canChooseSupplier} required={kind==='ORDER'}
   labelAction={canChooseSupplier&&context.permissions['suppliers.create']&&<button type="button" disabled={busy||scanning||importing}
   className="rounded text-sm font-semibold text-emerald-700 underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50"
   onClick={e=>{trigger.current=e.currentTarget;setAddingSupplier(true);}}>{c('addSupplier')}</button>}/>
 </div>
 <Field id="document-date" form={formId} label={c('documentDate')} type="date" className={`${inputClass} min-h-11`}
  value={date} disabled={busy||importing} required onChange={e=>setDate(e.target.value)}/>
 <Field id="supplier-reference" wrapperClassName="min-w-0 sm:col-start-1" form={formId} label={c('supplierReference')} placeholder={c('supplierReferencePlaceholder')}
  value={reference} maxLength={120} disabled={busy||importing} onChange={e=>setReference(e.target.value)}/>
 <div className="min-w-0 lg:col-span-2">
  <label htmlFor="document-notes" className="mb-1.5 block text-sm font-medium text-slate-700">{c('notes')}</label>
  <input id="document-notes" form={formId} className={inputClass} placeholder={c('notesPlaceholder')}
   maxLength={2000} value={notes} disabled={busy||importing} onChange={e=>setNotes(e.target.value)}/>
 </div>
 </div>
 {seed?.plannedItems?.length>0&&<div className={`${panelClass} space-y-3`}>
  <h3 className="font-semibold">{lang==='ar'?'أصناف طلب الشراء':'Planned items'}</h3>
  <p className="text-sm text-slate-600">{lang==='ar'?'اختر منتج المخزون المقابل لكل صنف استلمته.':'Choose the inventory product for each planned item you received.'}</p>
  {seed.plannedItems.filter(item=>scaled(item.quantity)>scaled(item.receivedQuantity)).map(item=><div key={item.id} className="space-y-2 border-t border-slate-100 pt-3">
   <p id={`planned-product-${item.id}`} className="text-sm font-medium">{item.name} · <bdi>{formatQuantity(fixed(scaled(item.quantity)-scaled(item.receivedQuantity)))}</bdi></p>
   {!lines.some(line=>line.plannedItemId===item.id) &&
    <ProductSearch {...{api,root,c,lang,context}} disabled={busy} describedBy={`planned-product-${item.id}`} onSelect={product=>addPlannedProduct(item,product)}/>}
  </div>)}
 </div>}
 <section className={`${panelClass} space-y-4`}>
 <h3 className="font-bold text-slate-900">{lang==='ar'?'الأصناف':'Items'}</h3>
 {!seed&&!plannedReceipt&&<div className="space-y-3">
 <ProductSearch {...{api,root,c,lang,context}} disabled={busy||importing} onSelect={add} inputRef={productSearchRef}/>
 <ProductEntryHelp compact lang={lang} canCreate={context.permissions['catalogue.create']&&cost}/>
 <Disclosure title={c('scanOptional')} hasValue={Boolean(scan)||mode==='repeat'}>
 <form onSubmit={lookup} className="grid gap-3 lg:grid-cols-[16rem_minmax(0,1fr)] items-end">
 <ScanModeSelect value={mode} onChange={setMode} disabled={busy||scanning||importing} {...{c,lang}}/>
 <div className="min-w-0"><label className="text-sm font-medium block mb-1.5" htmlFor="receipt-scan">{c('receivingBarcode')}<RequiredMark/></label><div className="flex gap-2"><input ref={scanRef} id="receipt-scan" className={`${inputClass} h-11 flex-1 min-w-0`} dir="ltr" placeholder={lang==='ar'?'امسح الباركود أو أدخل رمز الصنف':'Scan barcode or enter SKU'} required maxLength={128} value={scan} disabled={busy||importing} onChange={e=>setScan(e.target.value)}/><button className={`${buttonClass} h-11 shrink-0`} disabled={busy||importing}>{lang==='ar'?(scanning?'جارٍ البحث…':'إضافة'):(scanning?'Searching…':'Add')}</button></div></div>
 </form>
 </Disclosure>
 </div>}
 {notice&&<p role="status" className="text-sm text-emerald-700">{c(notice)}</p>}<LocalDraftNotice {...{draft,lang}} busy={busy||importing}/><Feedback {...{error,c}}/>
 <form id={formId} onSubmit={save} className="space-y-5">
 {lines.length>0&&<p className="text-xs text-slate-500">{c('quantitiesBase')} · {context.business.baseCurrency}</p>}
 <ul className="receipt-items space-y-3">
  {lines.map((line,index)=><li key={line.productId} data-cost={cost?'visible':'hidden'} className="receipt-line grid items-start gap-x-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
   <div className="receipt-line-product min-w-0">
    <h4 className="break-words font-semibold">{line.name}</h4>
    <p className="mt-1 text-xs text-slate-500"><CopyableCode>{line.sku}</CopyableCode> · {unitLabel(line.unit,c)}</p>
   </div>
   <div className="receipt-line-field [grid-area:quantity]">
    <label htmlFor={`line-quantity-${index}`} className="mb-1.5 block text-sm font-medium text-slate-700">{c('quantity')}<RequiredMark/></label>
    <input ref={el=>quantityRefs.current[line.productId]=el} id={`line-quantity-${index}`} {...selectInputOnFocus}
     className={inputClass} dir="ltr" inputMode="decimal" pattern={validNumber} placeholder={c('lineQuantityPlaceholder')}
     required value={line.quantity} disabled={busy||importing} onChange={e=>edit(index,'quantity',e.target.value)}
     onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(scanRef.current?.closest('details')?.open)scanRef.current.focus();else if(cost)document.getElementById(`line-cost-${index}`)?.focus();}}}/>
   </div>
   {cost&&<>
    <Field wrapperClassName="receipt-line-field [grid-area:cost]" id={`line-cost-${index}`} label={c('unitCost')} placeholder={c('costPlaceholder')} dir="ltr" inputMode="decimal"
     pattern={validNumber} required value={line.unitCost} disabled={busy||importing} onChange={e=>edit(index,'unitCost',e.target.value)}/>
    <div className="receipt-line-total min-w-0 text-sm">
     <p className="text-slate-500">{c('total')}</p>
     <p className="flex min-h-[var(--page-control-height)] items-center break-all font-bold tabular-nums"><bdi dir="ltr">{lineTotal(line)} {context.business.baseCurrency}</bdi></p>
    </div>
   </>}
   <button type="button" className="[grid-area:remove] inline-flex size-[var(--page-control-height)] items-center justify-center justify-self-end self-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
    disabled={busy||importing} aria-label={`${c('remove')} ${line.name}`} onClick={()=>setLines(old=>old.filter((_,j)=>index!==j))}>
    <Trash2 className="h-4 w-4" aria-hidden="true"/>
   </button>
  </li>)}
 </ul>
 {!lines.length&&<p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">{c('noLines')}</p>}
 {!seed&&!plannedReceipt&&<button type="button" className={`${buttonClass} border-dashed`} disabled={busy||importing}
  onClick={()=>productSearchRef.current?.focus()}><Plus aria-hidden="true"/>{lang==='ar'?'إضافة صنف':'Add item'}</button>}
 <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4">
  <button type="submit" className={primaryClass} disabled={busy||scanning||importing||!location||(kind==='ORDER'&&!supplier)||!lines.length}>
   {c(busy?'saving':kind==='RECEIPT'?'reviewReceipt':'saveDraft')}
  </button>
  {lines.length>0&&<Totals {...{lines,c,cost}} currency={context.business.baseCurrency}/>}
 </div></form>
 </section>
 {addingSupplier&&<SupplierForm path={`${root}/operations/suppliers`} {...{api,c,lang}}
  returnFocus={trigger.current} close={()=>setAddingSupplier(false)}
  done={saved=>{setSupplier(saved);setAddingSupplier(false);}}/>}
 </section>;
}
