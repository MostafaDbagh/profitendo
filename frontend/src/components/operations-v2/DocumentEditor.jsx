import RequiredMark from '../RequiredMark';
import Disclosure, {OptionalFields} from '../business-v2/Disclosure';
import { selectInputOnFocus } from '../../lib/selectInputOnFocus';
import SupplierForm from './SupplierForm';
import { formatQuantity } from '@/lib/quantity';
import CopyableCode from '@/components/CopyableCode';
import ScanModeSelect from './ScanModeSelect';
import { ArrowRight, ChevronDown } from 'lucide-react';
import ProductEntryHelp from './ProductEntryHelp';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { unitLabel } from '../catalogue-v2/units';
import Totals from './Totals';
import ReceiptSteps from './ReceiptSteps';
import { useEffect, useRef, useState } from 'react';
import { Field, inputClass } from '../auth-v2/Fields';
import { Feedback, buttonClass, primaryClass, panelClass } from '../business-v2/UI';
import RecordPicker from './RecordPicker';
const scaled=v=>{const [w,f='']=v.split('.');return BigInt(w)*10000n+BigInt(f.padEnd(4,'0'));};
const fixed=n=>`${n/10000n}.${String(n%10000n).padStart(4,'0')}`;
export default function DocumentEditor({context,api,c,lang,kind,document:doc,seed,close,done}){
 const cost=context.permissions['catalogue.cost'],root=`/businesses/${context.business.id}`,source=doc||seed;
 const [clientKey,setClientKey]=useState(()=>crypto.randomUUID()),[location,setLocation]=useState(source?.locationId?{id:source.locationId,name:source.locationName}:null),[supplier,setSupplier]=useState(source?.supplierId?{id:source.supplierId,name:source.supplierName}:null);
 const [date,setDate]=useState(doc?.documentDate||new Date().toLocaleDateString('en-CA')),[reference,setReference]=useState(doc?.supplierReference||''),[notes,setNotes]=useState(doc?.notes||'');
 const [lines,setLines]=useState(()=>source?.lines.map(l=>({...l,productId:l.productId,quantity:formatQuantity(doc?l.baseQuantity:fixed(scaled(l.baseQuantity)-scaled(l.receivedQuantity))),unitCost:l.unitCost??''})).filter(l=>scaled(l.quantity)>0n)||[]);
 const [picker,setPicker]=useState(''),[scan,setScan]=useState(''),[mode,setMode]=useState('once'),[scanning,setScanning]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [addingSupplier,setAddingSupplier]=useState(false);
 const [plannedItem,setPlannedItem]=useState(null);
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
 async function lookup(e){
  e.preventDefault();if(busy||!scan.trim())return;
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
 async function save(e){e.preventDefault();if(busy||scanning)return;if(!lines.length){setError('noLines');return;}setBusy(true);setError('');
  try{const common={documentDate:date,supplierReference:reference,notes,lines:lines.map(l=>({productId:l.productId,quantity:l.quantity,...(l.plannedItemId?{plannedItemId:l.plannedItemId}:{}),...(cost?{unitCost:l.unitCost}:{} )}))};
   const result=await api(doc?`${root}/operations/purchases/${doc.id}`:`${root}/operations/purchases`,{method:doc?'PATCH':'POST',body:doc?{...common,revision:doc.revision}:{...common,clientKey,kind,locationId:location?.id,supplierId:supplier?.id,...(seed?{orderId:seed.id}:{})}});
   draft.clear();done(result);
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const validNumber='(0|[1-9][0-9]{0,13})([.][0-9]{1,4})?';
 return <section className="space-y-5"><button type="button" className={buttonClass} disabled={busy||scanning} onClick={close}><ArrowRight aria-hidden="true" className={`h-4 w-4 ${lang==='ar'?'':'rotate-180'}`} />{c('back')}</button><div><h2 className="text-lg font-bold">{c(kind==='ORDER'?'newOrder':'newReceipt')}</h2><p className="text-sm text-slate-500 mt-1">{c(kind==='ORDER'?'orderHint':'receiptEntryHint')}</p></div>
 {kind==='RECEIPT'&&<ReceiptSteps stage={0} canConfirm={context.permissions['receiving.confirm']} c={c}/>}
 <div className={panelClass}><div className="grid gap-4 sm:grid-cols-2">{[['location',location,'chooseLocation'],['supplier',supplier,'chooseSupplier']].map(([key,value,label])=><div key={key}><div className="mb-2 flex flex-wrap items-center justify-between gap-2">
 <p className="text-sm font-medium">{c(key==='location'?'selectedLocation':'selectedSupplier')}<RequiredMark/></p>
 {key==='supplier'&&canChooseSupplier&&context.permissions['suppliers.create']&&<button type="button" disabled={busy||scanning}
  className="rounded text-sm font-semibold text-emerald-700 underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50"
  onClick={e=>{trigger.current=e.currentTarget;setAddingSupplier(true);}}>{c('addSupplier')}</button>}
 </div><button type="button" className={`${buttonClass} w-full !justify-between min-h-11 text-start`} disabled={busy||!!doc||Boolean(key==='location'?seed?.locationId:seed?.supplierId)} onClick={e=>{trigger.current=e.currentTarget;setPicker(key);}}><span className="min-w-0 truncate">{value?.name||c(label)}</span><ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true"/></button></div>)}</div></div>
 {seed?.plannedItems?.length>0&&<div className={`${panelClass} space-y-3`}>
  <h3 className="font-semibold">{lang==='ar'?'أصناف طلب الشراء':'Planned items'}</h3>
  <p className="text-sm text-slate-600">{lang==='ar'?'اختر منتج المخزون المقابل لكل صنف استلمته.':'Choose the inventory product for each planned item you received.'}</p>
  {seed.plannedItems.filter(item=>scaled(item.quantity)>scaled(item.receivedQuantity)).map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
   <span className="text-sm font-medium">{item.name} · <bdi>{formatQuantity(fixed(scaled(item.quantity)-scaled(item.receivedQuantity)))}</bdi></span>
   <button type="button" className={buttonClass} disabled={busy||lines.some(line=>line.plannedItemId===item.id)} onClick={event=>{
    trigger.current=event.currentTarget;setPlannedItem(item);setPicker('product');
   }}>{c('selectProduct')}</button>
  </div>)}
 </div>}
 {!seed&&!plannedReceipt&&<div className={`${panelClass} space-y-3`}>

 <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-3"><button type="button" className={buttonClass} disabled={busy} onClick={e=>{trigger.current=e.currentTarget;setPicker('product');}}>{c('selectProduct')}</button><p className="text-xs text-slate-500">{lang==='ar'?'اختر المنتج، ثم أدخل الكمية في صفّه أدناه.':'Choose a product, then enter its quantity below.'}</p></div><ProductEntryHelp compact lang={lang} canCreate={context.permissions['catalogue.create']&&cost}/></div>
 <Disclosure title={c('scanOptional')} hasValue={Boolean(scan)||mode==='repeat'}>
 <form onSubmit={lookup} className="grid gap-3 lg:grid-cols-[16rem_minmax(0,1fr)] items-end">
 <ScanModeSelect value={mode} onChange={setMode} disabled={busy||scanning} {...{c,lang}}/>
 <div className="min-w-0"><label className="text-sm font-medium block mb-1.5" htmlFor="receipt-scan">{c('receivingBarcode')}<RequiredMark/></label><div className="flex gap-2"><input ref={scanRef} id="receipt-scan" className={`${inputClass} h-11 flex-1 min-w-0`} dir="ltr" placeholder={lang==='ar'?'امسح الباركود أو أدخل رمز الصنف':'Scan barcode or enter SKU'} required maxLength={128} value={scan} disabled={busy} onChange={e=>setScan(e.target.value)}/><button className={`${buttonClass} h-11 shrink-0`} disabled={busy}>{lang==='ar'?(scanning?'جارٍ البحث…':'إضافة'):(scanning?'Searching…':'Add')}</button></div></div>
 </form>
 </Disclosure>
 </div>}
 {notice&&<p role="status" className="text-sm text-emerald-700">{c(notice)}</p>}<LocalDraftNotice {...{draft,lang,busy}}/><Feedback {...{error,c}}/>
 <form onSubmit={save} className="space-y-5"><div className={`${panelClass} grid sm:grid-cols-2 gap-4`}><Field id="document-date" label={c('documentDate')} type="date" value={date} disabled={busy} required onChange={e=>setDate(e.target.value)}/></div>
 {lines.length>0&&<p className="text-xs text-slate-500">{c('quantitiesBase')} · {context.business.baseCurrency}</p>}
 <div className="space-y-3">{lines.map((l,i)=><div key={l.productId} className={`${panelClass} space-y-3`}><div className="flex flex-wrap gap-2 justify-between"><div><h3 className="font-semibold">{l.name}</h3><p className="text-xs text-slate-500"><CopyableCode>{l.sku}</CopyableCode> · {unitLabel(l.unit,c)}</p></div><button type="button" className={buttonClass} disabled={busy} aria-label={`${c('remove')} ${l.name}`} onClick={()=>setLines(old=>old.filter((_,j)=>i!==j))}>{c('remove')}</button></div><div className="grid sm:grid-cols-2 gap-4"><div><label htmlFor={`line-quantity-${i}`} className="text-sm font-medium block mb-1.5">{c('quantity')}<RequiredMark/></label><input ref={el=>quantityRefs.current[l.productId]=el} id={`line-quantity-${i}`} {...selectInputOnFocus} className={inputClass} dir="ltr" inputMode="decimal" pattern={validNumber} placeholder={c('lineQuantityPlaceholder')} required value={l.quantity} disabled={busy} onChange={e=>edit(i,'quantity',e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(scanRef.current?.closest('details')?.open)scanRef.current.focus();else if(cost)document.getElementById(`line-cost-${i}`)?.focus();}}}/></div>{cost&&<Field id={`line-cost-${i}`} label={c('unitCost')} placeholder={c('costPlaceholder')} dir="ltr" inputMode="decimal" pattern={validNumber} required value={l.unitCost} disabled={busy} onChange={e=>edit(i,'unitCost',e.target.value)}/>}</div></div>)}</div>

 {!lines.length&&<p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-center text-slate-500">{c('noLines')}</p>}
 <OptionalFields hasValue={Boolean(reference||notes)}><Field id="supplier-reference" label={c('supplierReference')} placeholder={c('supplierReferencePlaceholder')} value={reference} maxLength={120} disabled={busy} onChange={e=>setReference(e.target.value)}/><div><label htmlFor="document-notes" className="block text-sm font-medium mb-1.5">{c('notes')}</label><textarea rows={2} id="document-notes" className={inputClass} placeholder={c('notesPlaceholder')} maxLength={2000} value={notes} disabled={busy} onChange={e=>setNotes(e.target.value)}/></div></OptionalFields>
 <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4">
  <button type="submit" className={primaryClass} disabled={busy||scanning||!location||!supplier||!lines.length}>
   {c(busy?'saving':kind==='RECEIPT'?'reviewReceipt':'saveDraft')}
  </button>
  {lines.length>0&&<Totals {...{lines,c,cost}} currency={context.business.baseCurrency}/>}
 </div></form>
 {addingSupplier&&<SupplierForm path={`${root}/operations/suppliers`} {...{api,c,lang}}
  returnFocus={trigger.current} close={()=>setAddingSupplier(false)}
  done={saved=>{setSupplier(saved);setAddingSupplier(false);}}/>}
 {picker&&<RecordPicker {...{api,c,lang}} path={picker==='location'?`${root}/locations?state=active`:picker==='supplier'?`${root}/operations/suppliers?state=active`:`${root}/products?state=active`} onAddSupplier={picker==='supplier'&&canChooseSupplier&&context.permissions['suppliers.create']?()=>{setPicker('');setAddingSupplier(true);}:undefined} emptyHelp={picker==='product'?<ProductEntryHelp lang={lang} canCreate={context.permissions['catalogue.create']&&cost}/>:null} title={c(picker==='location'?'chooseLocation':picker==='supplier'?'chooseSupplier':'selectProduct')} returnFocus={trigger.current} close={()=>{setPicker('');setPlannedItem(null);}} onSelect={row=>{if(picker==='location')setLocation(row);else if(picker==='supplier')setSupplier(row);else if(plannedItem){
   if(lines.some(line=>line.productId===row.id)){setError('duplicatePlannedProduct');setPicker('');setPlannedItem(null);return;}
   setError('');
   setLines(current=>[...current,{productId:row.id,plannedItemId:plannedItem.id,name:row.name,sku:row.sku,unit:row.unit,
    quantity:formatQuantity(fixed(scaled(plannedItem.quantity)-scaled(plannedItem.receivedQuantity))),unitCost:row.purchasePrice??''}]);
  }else add(row);setPicker('');setPlannedItem(null);}}/>}
 </section>;
}
