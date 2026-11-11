import { useRef, useState } from 'react';
import { Field, inputClass } from '../auth-v2/Fields';
import { Feedback, Modal, buttonClass, primaryClass, panelClass } from '../business-v2/UI';
import Totals from '../operations-v2/Totals';
const scaled=v=>{const [w,f='']=v.split('.');return BigInt(w)*10000n+BigInt(f.padEnd(4,'0'));};
export default function TransferEventForm({doc,kind,context,api,c,lang,close,done}){
 const [clientKey]=useState(()=>crypto.randomUUID()),[values,setValues]=useState({}),[reason,setReason]=useState(''),[review,setReview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),trigger=useRef(null);
 const outstanding=doc.lines.filter(l=>scaled(l.inTransit)>0n),destination=kind==='RECEIVE'?doc.destinationName:doc.sourceName;
 function prepare(e){e.preventDefault();setError('');
  const lines=outstanding.filter(l=>scaled(values[l.id]||'0')>0n).map(l=>({...l,quantity:values[l.id]}));
  if(!lines.length){setError('transferEventEmpty');return;}
  if(lines.some(l=>scaled(l.quantity)>scaled(l.inTransit))){setError('TRANSFER_QUANTITY_EXCEEDED');return;}
  setReview(lines);
 }
 async function confirm(){if(busy)return;setBusy(true);setError('');try{const result=await api(`/businesses/${context.business.id}/transfers/${doc.id}/events`,{method:'POST',body:{clientKey,revision:doc.revision,kind,reason,confirm:true,lines:review.map(l=>({lineId:l.id,quantity:l.quantity}))}});done(result.transfer);}catch(e){setError(e.message);}finally{setBusy(false);}}
 const hint=kind==='RECEIVE'?'receiveTransferHint':kind==='RETURN'?'returnTransferHint':'lossTransferHint';
 return <section className="space-y-5"><button className={buttonClass} disabled={busy} onClick={close}>{c('back')}</button><div><h2 className="text-lg font-bold">{c(kind==='RECEIVE'?'receiveTransfer':kind==='RETURN'?'returnTransfer':'lossTransfer')}</h2><p className="text-sm text-slate-500 mt-1">{c(hint)}</p><p className="mt-2 text-sm font-semibold">{c('sourceLocation')}: <bdi>{doc.sourceName}</bdi> · {c('destinationLocation')}: <bdi>{doc.destinationName}</bdi></p><p className="text-sm text-slate-500" dir="ltr">{doc.reference}</p></div>
 {!review&&<Feedback {...{error,c}}/>}<form onSubmit={prepare} className="space-y-4">
 {outstanding.map((l,i)=><div key={l.id} className={`${panelClass} space-y-3`}><h3 className="font-semibold">{l.name}</h3><p className="text-sm text-slate-500">{c('inTransit')}: <span dir="ltr">{l.inTransit}</span> · {c(l.unit)}</p><Field id={`event-quantity-${i}`} label={c('quantity')} inputMode="decimal" dir="ltr" placeholder="0" pattern="(0|[1-9][0-9]{0,13})([.][0-9]{1,4})?" required value={values[l.id]??'0'} disabled={busy} onChange={e=>setValues(old=>({...old,[l.id]:e.target.value}))}/></div>)}
 <div><label htmlFor="transfer-reason" className="block text-sm font-medium mb-1.5">{c('transferReason')}</label><textarea id="transfer-reason" className={inputClass} placeholder={c(kind==='RECEIVE'?'receiveReasonPlaceholder':kind==='RETURN'?'transferReasonPlaceholder':'lossReasonPlaceholder')} value={reason} required={kind!=='RECEIVE'} minLength={kind!=='RECEIVE'?5:undefined} maxLength={2000} disabled={busy} onChange={e=>setReason(e.target.value)}/></div>
 <button ref={trigger} className={primaryClass} disabled={busy||!outstanding.length}>{c('reviewTransferEvent')}</button></form>
 {review&&<Modal {...{c,lang,busy}} title={c('confirmTransferEvent')} description={c('transferEventWarning')} close={()=>setReview(null)} returnFocus={trigger.current}>
  <div className="space-y-4 min-w-0"><p className="font-semibold">{c(`transferEvent${kind}`)}</p><p className="text-sm">{kind==='LOSS'?<>{c('sourceLocation')}: <bdi>{doc.sourceName}</bdi> · {c('destinationLocation')}: <bdi>{doc.destinationName}</bdi></>:destination}</p><ul className="space-y-2 text-sm">{review.map(l=><li key={l.id} className="flex flex-wrap justify-between gap-2"><span className="break-words">{l.name}</span><span><span dir="ltr">{l.quantity}</span> {c(l.unit)}</span></li>)}</ul><Totals lines={review} c={c} cost={false}/><p className="text-sm whitespace-pre-wrap break-words">{reason}</p><Feedback {...{error,c}} retry={['REVISION_CONFLICT','TRANSFER_QUANTITY_EXCEEDED','IDEMPOTENCY_CONFLICT'].includes(error)?close:undefined}/><div className="flex flex-wrap gap-2"><button className={primaryClass} disabled={busy} onClick={confirm}>{c(busy?'saving':'confirm')}</button><button className={buttonClass} disabled={busy} onClick={()=>setReview(null)}>{c('close')}</button></div></div>
 </Modal>}
 </section>;
}
