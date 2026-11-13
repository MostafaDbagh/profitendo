import {useRef,useState} from 'react';
import {Field} from '../auth-v2/Fields';
import {Feedback,Modal,primaryClass} from '../business-v2/UI';
export default function PaymentReversal({entry,returnFocus,context,api,c,lang,close,done}){
 const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef(null),supplier=entry.kind.startsWith('SUPPLIER');
 const canReverse=!entry.reversalOfId&&!entry.reversedBy&&context.permissions['payments.reverse']&&context.permissions['payments.manage']&&(!supplier||(context.permissions['catalogue.cost']&&context.permissions['purchasing.manage']));
 const timestamp=value=>new Intl.DateTimeFormat(lang,{dateStyle:'medium',timeStyle:'short',timeZone:context.business.timezone}).format(new Date(value));
 async function submit(event){event.preventDefault();setBusy(true);setError('');
  if(!request.current||request.current.reason!==reason)request.current={clientKey:crypto.randomUUID(),reason,confirm:true};
  try{await api(`/businesses/${context.business.id}/workflows/payments/${entry.id}/reverse`,{method:'POST',body:request.current});done();}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <Modal {...{c,lang,busy,returnFocus,close}} title={c(canReverse?'reversePayment':'paymentDetails')} description={c('reversalHint')}>
  <div className="space-y-2 text-sm break-words"><div className="font-semibold">{c(entry.kind)} · {entry.location.name}</div><div className="text-lg font-bold"><bdi>{entry.amount} {entry.currency}</bdi></div><div>{c(entry.method)} · {entry.reference||'—'}</div><div>{entry.reason}</div><div><bdi>{entry.actorName}</bdi> · <bdi>{timestamp(entry.createdAt)}</bdi></div><div className="text-xs text-slate-500">{c('entryId')}: <bdi>{entry.id}</bdi></div></div>
  {entry.reversedBy&&<div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm break-words"><p className="font-semibold">{c('paymentReversed')}</p><p>{entry.reversedBy.reason}</p><p><bdi>{entry.reversedBy.actorName}</bdi> · <bdi>{timestamp(entry.reversedBy.createdAt)}</bdi></p><p className="text-xs mt-1"><bdi>{entry.reversedBy.id}</bdi></p></div>}
  {entry.reversalOf&&<div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm break-words"><p className="font-semibold">{c('originalEntry')}</p><p>{entry.reversalOf.reason}</p><p><bdi>{entry.reversalOf.actorName}</bdi> · <bdi>{timestamp(entry.reversalOf.createdAt)}</bdi></p><p className="text-xs mt-1"><bdi>{entry.reversalOf.id}</bdi></p></div>}
  {canReverse&&<form className="mt-5 space-y-4" onSubmit={submit}><Feedback {...{c,error}}/><Field id="reversal-reason" label={c('reversalReason')} placeholder={c('reversalReasonExample')} value={reason} onChange={e=>setReason(e.target.value)} required minLength={5} maxLength={2000} disabled={busy}/><label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy} className="mt-1 accent-emerald-600"/><span>{c('reversalConfirm')}</span></label><button className={primaryClass} disabled={busy||!confirmed}>{c('confirmReversal')}</button></form>}
 </Modal>;
}
