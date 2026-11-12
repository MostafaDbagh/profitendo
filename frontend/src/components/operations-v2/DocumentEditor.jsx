import { unitLabel } from '../catalogue-v2/units';
import Totals from './Totals';
import { useEffect, useRef, useState } from 'react';
import { Field, inputClass } from '../auth-v2/Fields';
import { Feedback, Select, buttonClass, primaryClass, panelClass } from '../business-v2/UI';
import RecordPicker from './RecordPicker';
const scaled=v=>{const [w,f='']=v.split('.');return BigInt(w)*10000n+BigInt(f.padEnd(4,'0'));};
const fixed=n=>`${n/10000n}.${String(n%10000n).padStart(4,'0')}`;
export default function DocumentEditor({context,api,c,lang,kind,document:doc,seed,close,done}){
 const cost=context.permissions['catalogue.cost'],root=`/businesses/${context.business.id}`,source=doc||seed;
 const [clientKey]=useState(()=>crypto.randomUUID()),[location,setLocation]=useState(source?{id:source.locationId,name:source.locationName}:null),[supplier,setSupplier]=useState(source?{id:source.supplierId,name:source.supplierName}:null);
 const [date,setDate]=useState(doc?.documentDate||new Date().toLocaleDateString('en-CA')),[reference,setReference]=useState(doc?.supplierReference||''),[notes,setNotes]=useState(doc?.notes||'');
 const [lines,setLines]=useState(()=>source?.lines.map(l=>({...l,productId:l.productId,quantity:doc?l.baseQuantity:fixed(scaled(l.baseQuantity)-scaled(l.receivedQuantity)),unitCost:l.unitCost??''})).filter(l=>scaled(l.quantity)>0n)||[]);
 const [picker,setPicker]=useState(''),[scan,setScan]=useState(''),[mode,setMode]=useState('once'),[scanning,setScanning]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [focusProduct,setFocusProduct]=useState('');
 const scanRef=useRef(null),scanLock=useRef(false),scanQueue=useRef([]),trigger=useRef(null),quantityRefs=useRef({});
 useEffect(()=>{if(focusProduct&&quantityRefs.current[focusProduct]){quantityRefs.current[focusProduct].focus();quantityRefs.current[focusProduct].select();setFocusProduct('');}},[focusProduct,lines]);
 function add(product,repeated=false){
  setError('');setNotice('lineAdded');
  setLines(old=>{const exists=old.find(l=>l.productId===product.id);if(exists&&repeated&&!/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(exists.quantity||'')){setError('INVALID_QUANTITY');return old;}if(exists)return repeated?old.map(l=>l.productId===product.id?{...l,quantity:fixed(scaled(l.quantity||'0')+10000n)}:l):old;
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
   try{const result=await api(`${root}/products/barcode?value=${encodeURIComponent(next.barcode)}`);add(result.product,next.mode==='repeat');}
   catch(e){setError(e.message);}
   if(next.mode==='repeat')scanRef.current?.focus();
  }}finally{scanLock.current=false;setScanning(false);}
 }
 function edit(index,key,value){setLines(old=>old.map((l,i)=>i===index?{...l,[key]:value}:l));}
 async function save(e){e.preventDefault();if(busy||scanning)return;if(!lines.length){setError('noLines');return;}setBusy(true);setError('');
  try{const common={documentDate:date,supplierReference:reference,notes,lines:lines.map(l=>({productId:l.productId,quantity:l.quantity,...(cost?{unitCost:l.unitCost}:{} )}))};
   const result=await api(doc?`${root}/operations/purchases/${doc.id}`:`${root}/operations/purchases`,{method:doc?'PATCH':'POST',body:doc?{...common,revision:doc.revision}:{...common,clientKey,kind,locationId:location?.id,supplierId:supplier?.id,...(seed?{orderId:seed.id}:{})}});
   done(result);
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const validNumber='(0|[1-9][0-9]{0,13})([.][0-9]{1,4})?';
 return <section className="space-y-5"><button className={buttonClass} disabled={busy||scanning} onClick={close}>{c('back')}</button><div><h2 className="text-lg font-bold">{c(kind==='ORDER'?'newOrder':'newReceipt')}</h2><p className="text-sm text-slate-500 mt-1">{c(kind==='ORDER'?'orderHint':'documentHint')}</p></div>
 <div className={panelClass}><div className="grid gap-4 sm:grid-cols-2">{[['location',location,'chooseLocation'],['supplier',supplier,'chooseSupplier']].map(([key,value,label])=><div key={key}><p className="text-sm font-medium mb-2">{c(key==='location'?'selectedLocation':'selectedSupplier')}</p><button type="button" className={buttonClass} disabled={busy||!!source} onClick={e=>{trigger.current=e.currentTarget;setPicker(key);}}>{value?.name||c(label)}</button></div>)}</div></div>
 {!seed&&<div className={`${panelClass} space-y-4`}><Select id="receipt-scan-mode" label={c('scanMode')} value={mode} disabled={busy||scanning} onChange={e=>setMode(e.target.value)}><option value="once">{c('scanOnce')}</option><option value="repeat">{c('scanRepeated')}</option></Select>
 <form onSubmit={lookup} className="space-y-2"><label className="text-sm font-medium block" htmlFor="receipt-scan">{c('receivingBarcode')}</label><div className="grid gap-2 sm:flex"><input ref={scanRef} id="receipt-scan" className={`${inputClass} flex-1 min-w-0`} dir="ltr" placeholder={c('scanPlaceholder')} required maxLength={128} value={scan} disabled={busy} onChange={e=>setScan(e.target.value)}/><button className={buttonClass} disabled={busy}>{c(scanning?'scanBusy':'findProduct')}</button></div></form>
 <div className="flex flex-wrap gap-2 items-center"><button type="button" className={buttonClass} disabled={busy} onClick={e=>{trigger.current=e.currentTarget;setPicker('product');}}>{c('selectProduct')}</button><p className="text-xs text-slate-500">{c('searchProductHint')}</p></div>
 </div>}
 {notice&&<p role="status" className="text-sm text-emerald-700">{c(notice)}</p>}<Feedback {...{error,c}}/>
 <form onSubmit={save} className="space-y-5"><div className="grid sm:grid-cols-2 gap-4"><Field id="document-date" label={c('documentDate')} type="date" value={date} disabled={busy} required onChange={e=>setDate(e.target.value)}/><Field id="supplier-reference" label={c('supplierReference')} placeholder={c('supplierReferencePlaceholder')} value={reference} maxLength={120} disabled={busy} onChange={e=>setReference(e.target.value)}/></div>
 <p className="text-xs text-slate-500">{c('quantitiesBase')} · {context.business.baseCurrency}</p>
 <div className="space-y-3">{lines.map((l,i)=><div key={l.productId} className={`${panelClass} space-y-3`}><div className="flex flex-wrap gap-2 justify-between"><div><h3 className="font-semibold">{l.name}</h3><p className="text-xs text-slate-500"><span dir="ltr">{l.sku}</span> · {unitLabel(l.unit,c)}</p></div><button type="button" className={buttonClass} disabled={busy} aria-label={`${c('remove')} ${l.name}`} onClick={()=>setLines(old=>old.filter((_,j)=>i!==j))}>{c('remove')}</button></div><div className="grid sm:grid-cols-2 gap-4"><div><label htmlFor={`line-quantity-${i}`} className="text-sm font-medium block mb-1.5">{c('quantity')}</label><input ref={el=>quantityRefs.current[l.productId]=el} id={`line-quantity-${i}`} className={inputClass} dir="ltr" inputMode="decimal" pattern={validNumber} placeholder={c('lineQuantityPlaceholder')} required value={l.quantity} disabled={busy} onChange={e=>edit(i,'quantity',e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();scanRef.current?.focus();}}}/></div>{cost&&<Field id={`line-cost-${i}`} label={c('unitCost')} placeholder={c('costPlaceholder')} dir="ltr" inputMode="decimal" pattern={validNumber} required value={l.unitCost} disabled={busy} onChange={e=>edit(i,'unitCost',e.target.value)}/>}</div></div>)}</div>
 <Totals {...{lines,c,cost}} currency={context.business.baseCurrency}/>
 {!lines.length&&<p className="text-sm text-slate-500">{c('noLines')}</p>}
 <div><label htmlFor="document-notes" className="block text-sm font-medium mb-1.5">{c('notes')}</label><textarea id="document-notes" className={inputClass} placeholder={c('notesPlaceholder')} maxLength={2000} value={notes} disabled={busy} onChange={e=>setNotes(e.target.value)}/></div>
 <button className={primaryClass} disabled={busy||scanning||!location||!supplier||!lines.length}>{c(busy?'saving':'saveDraft')}</button></form>
 {picker&&<RecordPicker {...{api,c,lang}} path={picker==='location'?`${root}/locations?state=active`:picker==='supplier'?`${root}/operations/suppliers?state=active`:`${root}/products?state=active`} title={c(picker==='location'?'chooseLocation':picker==='supplier'?'chooseSupplier':'selectProduct')} returnFocus={trigger.current} close={()=>setPicker('')} onSelect={row=>{if(picker==='location')setLocation(row);else if(picker==='supplier')setSupplier(row);else add(row);setPicker('');}}/>}
 </section>;
}
