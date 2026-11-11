import { useRef, useState } from 'react';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Modal, Table, buttonClass, primaryClass, panelClass } from '../business-v2/UI';
import TransferHistory from './TransferHistory';
export default function TransferDetail({id,context,api,c,lang,close,edit,record,notice}){
 const path=`/businesses/${context.business.id}/transfers/${id}`,{data:doc,error,reload}=useResource(api,path);
 const [action,setAction]=useState(''),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[message,setMessage]=useState(notice||''),trigger=useRef(null);
 async function change(){if(busy)return;setBusy(true);setFailure('');try{await api(`${path}/status`,{method:'POST',body:{revision:doc.revision,action,confirm:true}});setAction('');setMessage('transferUpdated');reload();}catch(e){setFailure(e.message);}finally{setBusy(false);}}
 function ask(e,value){trigger.current=e.currentTarget;setFailure('');setAction(value);}
 return <section className="space-y-5"><button className={buttonClass} onClick={close}>{c('back')}</button><Feedback {...{error,c}} notice={message} retry={reload}/>{!doc&&!error&&<p role="status">{c('loading')}</p>}
 {doc&&<><div className="flex flex-wrap justify-between gap-3 items-start"><div><h2 className="font-bold text-lg">{c('transfers')} · {c(`transferStatus${doc.status}`)}</h2><p className="text-sm text-slate-500" dir="ltr">{doc.reference}</p></div><div className="flex flex-wrap gap-2">
 {doc.capabilities.edit&&<button className={buttonClass} onClick={()=>edit(doc)}>{c('editTransfer')}</button>}
 {doc.capabilities.dispatch&&<button className={primaryClass} onClick={e=>ask(e,'dispatch')}>{c('dispatchTransfer')}</button>}
 {doc.capabilities.cancel&&<button className={buttonClass} onClick={e=>ask(e,'cancel')}>{c('cancelTransfer')}</button>}
 {doc.capabilities.receive&&<button className={primaryClass} onClick={()=>record(doc,'RECEIVE')}>{c('receiveTransfer')}</button>}
 {doc.capabilities.resolve&&<><button className={buttonClass} onClick={()=>record(doc,'RETURN')}>{c('returnTransfer')}</button><button className={buttonClass} onClick={()=>record(doc,'LOSS')}>{c('lossTransfer')}</button></>}
 </div></div>
 <dl className={`${panelClass} grid gap-4 sm:grid-cols-2`}>{[['sourceLocation',doc.sourceName],['destinationLocation',doc.destinationName],['createdBy',doc.actorName],...(doc.dispatchedAt?[['dispatchedBy',doc.dispatchedName],['dispatchedAt',new Date(doc.dispatchedAt).toLocaleString(lang==='ar'?'ar-AE':'en-GB',{timeZone:context.business.timezone})]]:[])].map(([label,value])=><div key={label} className="min-w-0"><dt className="text-xs text-slate-500">{c(label)}</dt><dd className="mt-1 text-sm font-medium break-words">{value}</dd></div>)}</dl>
 <p className="text-sm text-slate-500">{c('transferBaseHint')}</p><Table headers={['productName','unit','transferQuantity','receivedQuantity','returned','lost','inTransit']} c={c} tableClassName="min-w-[760px]">{doc.lines.map(line=><tr key={line.id}><td className="px-5 py-3"><span className="font-semibold">{line.name}</span><span className="block text-xs text-slate-500" dir="ltr">{line.sku}</span></td><td className="px-5 py-3">{c(line.unit)}</td>{['quantity','received','returned','lost','inTransit'].map(k=><td key={k} className="px-5 py-3 tabular-nums" dir="ltr">{line[k]}</td>)}</tr>)}</Table>
 {doc.notes&&<div className={panelClass}><h3 className="text-sm font-semibold">{c('notes')}</h3><p className="text-sm whitespace-pre-wrap break-words mt-2">{doc.notes}</p></div>}
 {doc.status==='COMPLETED'&&<p className="text-sm text-slate-500">{c('transferClosedHint')}</p>}
 {!Object.values(doc.capabilities).some(Boolean)&&!['COMPLETED','CANCELLED'].includes(doc.status)&&<p className="text-sm text-slate-500">{c('transferUnavailable')}</p>}
 <TransferHistory key={doc.revision} {...{path,api,c,lang}} timezone={context.business.timezone}/>
 </>}
 {action&&<Modal {...{c,lang,busy}} title={c(action==='dispatch'?'dispatchTransfer':'cancelTransfer')} description={c(action==='dispatch'?'dispatchHint':'cancelTransferHint')} returnFocus={trigger.current} close={()=>setAction('')}>
  <p className="text-sm font-semibold">{c('sourceLocation')}: <bdi>{doc.sourceName}</bdi> · {c('destinationLocation')}: <bdi>{doc.destinationName}</bdi></p><Feedback error={failure} c={c} retry={()=>{setAction('');reload();}}/><div className="flex flex-wrap gap-2"><button className={primaryClass} disabled={busy} onClick={change}>{c(busy?'saving':'confirm')}</button><button className={buttonClass} disabled={busy} onClick={()=>setAction('')}>{c('close')}</button></div>
 </Modal>}
 </section>;
}
