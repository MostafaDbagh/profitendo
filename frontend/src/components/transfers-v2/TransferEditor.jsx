import LocationChips from '../business-v2/LocationChips';
import RequiredMark from '../RequiredMark';
import { selectInputOnFocus } from '../../lib/selectInputOnFocus';
import { formatQuantity } from '@/lib/quantity';
import { ArrowRight } from 'lucide-react';
import CopyableCode from '@/components/CopyableCode';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { unitLabel } from '../catalogue-v2/units';
import { useEffect, useRef, useState } from 'react';
import { inputClass } from '../auth-v2/Fields';
import { Feedback, buttonClass, primaryClass, panelClass } from '../business-v2/UI';
import ProductSearch from '../operations-v2/ProductSearch';
import Totals from '../operations-v2/Totals';
export default function TransferEditor({context,api,c,lang,document:doc,close,done}){
 const root=`/businesses/${context.business.id}`;
 const [clientKey,setClientKey]=useState(()=>crypto.randomUUID()),[source,setSource]=useState(doc?{id:doc.sourceId,name:doc.sourceName}:null),[destination,setDestination]=useState(doc?{id:doc.destinationId,name:doc.destinationName}:null);
 const [lines,setLines]=useState(()=>doc?.lines.map(line=>({...line,quantity:formatQuantity(line.quantity)}))||[]),[notes,setNotes]=useState(doc?.notes||''),[scan,setScan]=useState(''),[focusId,setFocusId]=useState(''),[busy,setBusy]=useState(false),[scanning,setScanning]=useState(false),[error,setError]=useState('');
 const [stock,setStock]=useState(null);
 const productIds=lines.map(line=>line.productId).sort().join(',');
 const stockPath=source&&productIds?`${root}/transfers/availability?locationId=${source.id}&products=${productIds}`:null;
 useEffect(()=>{
  if(!stockPath)return;
  const controller=new AbortController();
  api(stockPath,{signal:controller.signal}).then(values=>{
   if(!controller.signal.aborted)setStock({path:stockPath,values});
  }).catch(error=>{
   if(!controller.signal.aborted)setStock({path:stockPath,error:error.message});
  });
  return ()=>controller.abort();
 },[api,stockPath]);
 const availability=stock?.path===stockPath?stock?.values:null;
 const exceedsStock=line=>availability&&Number(line.quantity)>Number(availability[line.productId]);
 const insufficientStock=lines.some(exceedsStock);
 const quantityRefs=useRef({}),scanLock=useRef(false);
 useEffect(()=>{if(focusId&&quantityRefs.current[focusId]){quantityRefs.current[focusId].focus();quantityRefs.current[focusId].select();setFocusId('');}},[focusId,lines]);
 function add(p){setLines(old=>old.some(l=>l.productId===p.id)?old:[...old,{productId:p.id,name:p.name,sku:p.sku,unit:p.unit,quantity:'1'}]);setFocusId(p.id);}
 const draft=useLocalDraft(`transfer:${doc?.id||'new'}:${doc?.revision||0}`,{clientKey,source,destination,lines,notes,scan},saved=>{setClientKey(saved.clientKey);setSource(saved.source);setDestination(saved.destination);setLines(saved.lines.map(line=>({...line,quantity:formatQuantity(line.quantity)})));setNotes(saved.notes);setScan(saved.scan);});
 async function lookup(e){e.preventDefault();if(scanLock.current||busy)return;scanLock.current=true;setScanning(true);setError('');try{const r=await api(`${root}/products/barcode?value=${encodeURIComponent(scan.trim())}`);add(r.product);setScan('');}catch(e){setError(e.message);}finally{scanLock.current=false;setScanning(false);}}
 async function save(e){e.preventDefault();if(busy||scanning||insufficientStock)return;if(source?.id===destination?.id){setError('TRANSFER_SAME_LOCATION');return;}setError('');setBusy(true);
  try{const data={notes,lines:lines.map(l=>({productId:l.productId,quantity:l.quantity}))};draft.checkpoint({});const result=await api(doc?`${root}/transfers/${doc.id}`:`${root}/transfers`,{method:doc?'PATCH':'POST',body:doc?{...data,revision:doc.revision}:{...data,clientKey,sourceId:source?.id,destinationId:destination?.id}});draft.clear();done(result);}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <section className="space-y-5"><button className={buttonClass} disabled={busy||scanning} onClick={close}><ArrowRight aria-hidden="true" className={`h-4 w-4 shrink-0 ${lang==='ar'?'':'rotate-180'}`} />{c('back')}</button><div><h2 className="text-lg font-bold">{c(doc?'editTransfer':'newTransfer')}</h2></div>
 <div className={`${panelClass} grid gap-4 sm:grid-cols-2`}>{[['source',source,'sourceLocation','chooseTransferSource'],['destination',destination,'destinationLocation','chooseDestination']].map(([key,value,label,choose])=><div key={key} className="min-w-0"><p className="text-sm font-medium mb-2">{c(label)}<RequiredMark/></p><LocationChips {...{context,api,c,lang}} value={value} label={c(choose)} onChange={key==='source'?setSource:setDestination} disabled={!!doc||busy||scanning} excludeId={key==='source'?destination?.id:source?.id}/></div>)}</div>
 <div className={`${panelClass} space-y-3`}><form onSubmit={lookup} className="space-y-2"><label htmlFor="transfer-scan" className="block text-sm font-medium">{c('scanBarcode')}<RequiredMark/></label><div className="grid sm:flex gap-2"><input id="transfer-scan" className={`${inputClass} flex-1 min-w-0`} dir="ltr" value={scan} placeholder="001234567890" required maxLength={128} disabled={busy||scanning} onChange={e=>setScan(e.target.value)}/><button className={buttonClass} disabled={busy||scanning}>{c(scanning?'loading':'findProduct')}</button></div></form><p className="text-xs text-slate-500">{c('transferScanHint')}</p><ProductSearch {...{api,root,c,lang,context}} disabled={busy||scanning} onSelect={add}/></div>
 <LocalDraftNotice {...{draft,lang,busy}}/><Feedback error={error||(stock?.path===stockPath?stock?.error:undefined)} c={c}/>
 <form className="space-y-4" onSubmit={save}><div className="space-y-3">{lines.map((line,i)=><div key={line.productId} className={`${panelClass} space-y-3`}><div className="flex justify-between gap-2 items-start"><div className="min-w-0"><h3 className="font-semibold break-words">{line.name}</h3><p className="text-xs text-slate-500"><CopyableCode>{line.sku}</CopyableCode> · {unitLabel(line.unit,c)}</p></div><button type="button" className={buttonClass} disabled={busy} aria-label={`${c('remove')} ${line.name}`} onClick={()=>setLines(old=>old.filter(l=>l.productId!==line.productId))}>{c('remove')}</button></div><label htmlFor={`transfer-quantity-${i}`} className="text-sm font-medium block">{c('quantity')}<RequiredMark/></label><input id={`transfer-quantity-${i}`} ref={el=>quantityRefs.current[line.productId]=el} className={inputClass} required inputMode="decimal" {...selectInputOnFocus} dir="ltr" pattern="(0|[1-9][0-9]{0,13})([.][0-9]{1,4})?" placeholder={c('transferQuantityPlaceholder')} value={line.quantity} disabled={busy} onChange={e=>setLines(old=>old.map((l,j)=>i===j?{...l,quantity:e.target.value}:l))}/>
 {availability&&<span className={`block text-xs ${exceedsStock(line)?'text-red-700':'text-slate-600'}`}>
  {lang==='ar'?'المتاح في موقع الإرسال':'Available at source'}: <bdi>{formatQuantity(availability[line.productId])}</bdi> {unitLabel(line.unit,c)}
 </span>}
 {exceedsStock(line)&&<p role="alert" className="text-sm text-red-700">{lang==='ar'?'الكمية المطلوبة أكبر من المتاح.':'Requested quantity exceeds available stock.'}</p>}
 </div>)}</div>
 {!lines.length&&<p className="text-sm text-slate-500">{c('noLines')}</p>}<Totals {...{lines,c}} cost={false}/>
 <div><label htmlFor="transfer-notes" className="text-sm font-medium block mb-1.5">{c('notes')}</label><textarea id="transfer-notes" className={inputClass} placeholder={c('transferNotesPlaceholder')} maxLength={2000} value={notes} disabled={busy} onChange={e=>setNotes(e.target.value)}/></div><button className={primaryClass} disabled={busy||scanning||!source||!destination||!lines.length||insufficientStock}>{c(busy?'saving':'saveDraft')}</button></form>

 </section>;
}
