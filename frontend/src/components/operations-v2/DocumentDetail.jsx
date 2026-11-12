import { unitLabel } from '../catalogue-v2/units';
import { displayAmount } from './Totals';
import { useRef, useState } from 'react';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Modal, Table, buttonClass, primaryClass, panelClass } from '../business-v2/UI';
export default function DocumentDetail({id,context,api,c,lang,close,edit,receive,notice}){
 const path=`/businesses/${context.business.id}/operations/purchases/${id}`,{data:doc,error,reload}=useResource(api,path);
 const [action,setAction]=useState(''),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[message,setMessage]=useState(notice||''),trigger=useRef(null);
 async function change(){if(busy)return;setBusy(true);setFailure('');try{await api(`${path}/status`,{method:'POST',body:{revision:doc.revision,action,confirm:true}});setAction('');setMessage('documentChanged');reload();}catch(e){setFailure(e.message);}finally{setBusy(false);}}
 function ask(e,value){trigger.current=e.currentTarget;setFailure('');setAction(value);}
 const manage=doc&&(doc.kind==='ORDER'?context.permissions['purchasing.manage']:context.permissions['receiving.create']);
 const active=doc&&['DRAFT','PENDING','OPEN','PARTIAL'].includes(doc.status);
 return <section className="space-y-5"><button className={buttonClass} onClick={close}>{c('back')}</button><Feedback {...{error,c}} notice={message} retry={reload}/>{!doc&&!error&&<p role="status">{c('loading')}</p>}
 {doc&&<><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{c(doc.kind)} · {c(doc.status)}</h2><p className="text-sm text-slate-500 break-all" dir="ltr">{doc.reference}</p></div><div className="flex flex-wrap gap-2">
 {manage&&doc.status==='DRAFT'&&<><button className={buttonClass} onClick={()=>edit(doc)}>{c('editDocument')}</button><button className={primaryClass} onClick={e=>ask(e,'submit')}>{c(doc.kind==='ORDER'?'releaseOrder':'submitDocument')}</button></>}
 {doc.kind==='RECEIPT'&&doc.status==='PENDING'&&<>{context.permissions['receiving.confirm']&&<button className={primaryClass} onClick={e=>ask(e,'confirm')}>{c('confirmReceipt')}</button>}{manage&&<button className={buttonClass} onClick={e=>ask(e,'reopen')}>{c('reopenDraft')}</button>}</>}
 {doc.kind==='ORDER'&&['OPEN','PARTIAL'].includes(doc.status)&&context.permissions['receiving.create']&&<button className={primaryClass} onClick={()=>receive(doc)}>{c('receiveRemaining')}</button>}
 {manage&&active&&context.permissions[doc.kind==='ORDER'?'purchasing.delete':'receiving.delete']&&<button className={buttonClass} onClick={e=>ask(e,'cancel')}>{c('cancelDocument')}</button>}
 </div></div>
 <dl className={`${panelClass} grid gap-4 sm:grid-cols-2`}>{[['selectedSupplier',doc.supplierName],['selectedLocation',doc.locationName],['documentDate',doc.documentDate],['supplierReference',doc.supplierReference||'—'],['createdBy',doc.actorName],...(doc.completedAt?[['completedBy',doc.completedName],['completedAt',new Date(doc.completedAt).toLocaleString(lang==='ar'?'ar-AE':'en-GB',{timeZone:context.business.timezone})]]:[])].map(([key,value])=><div key={key} className="min-w-0"><dt className="text-xs text-slate-500">{c(key)}</dt><dd className="text-sm font-medium mt-1 break-words">{value}</dd></div>)}</dl>
 {doc.orderId&&<p className="text-sm text-slate-500 break-all">{c('linkedOrder')}: <span dir="ltr">{doc.orderId}</span></p>}
 <p className="text-xs text-slate-500">{c('quantitiesBase')}</p>
 <Table c={c} tableClassName="min-w-[640px]" headers={['productName','unit','baseQuantity',...(doc.kind==='ORDER'?['receivedQuantity']:[]),...(context.permissions['catalogue.cost']?['unitCost','totalValue']:[])]}>{doc.lines.map(l=><tr key={l.id}><td className="px-5 py-3"><span className="font-semibold">{l.name}</span><span className="block text-xs text-slate-500" dir="ltr">{l.sku}</span>{l.barcodes.length>0&&<span className="block text-xs text-slate-500 break-all" dir="ltr">{l.barcodes.join(' · ')}</span>}{l.packName&&<span className="block text-xs text-slate-500">{l.quantity} × {l.packName} ({l.factor})</span>}</td><td className="px-5 py-3">{unitLabel(l.unit,c)}</td><td className="px-5 py-3 tabular-nums" dir="ltr">{l.baseQuantity}</td>{doc.kind==='ORDER'&&<td className="px-5 py-3 tabular-nums" dir="ltr">{l.receivedQuantity}</td>}{context.permissions['catalogue.cost']&&<><td className="px-5 py-3 tabular-nums" dir="ltr">{l.unitCost}</td><td className="px-5 py-3 tabular-nums" dir="ltr">{displayAmount(l.lineTotal)}</td></>}</tr>)}</Table>
 {doc.totalValue!==undefined&&<p className="text-end font-semibold">{c('totalValue')}: <span dir="ltr">{displayAmount(doc.totalValue)} {doc.currency}</span></p>}
 {doc.notes&&<div className={panelClass}><h3 className="text-sm font-semibold">{c('notes')}</h3><p className="text-sm mt-2 whitespace-pre-wrap break-words">{doc.notes}</p></div>}
 {doc.status==='COMPLETED'&&<p className="text-sm text-slate-500">{c('viewReceiptHint')}</p>}
 </>}
 {action&&<Modal {...{c,lang,busy}} returnFocus={trigger.current} title={c('confirmAction')} description={c(action==='confirm'?'confirmReceiptHint':action==='cancel'?'cancelDocumentHint':action==='reopen'?'reopenHint':'submitHint')} close={()=>setAction('')}><Feedback error={failure} c={c} retry={()=>{setAction('');reload();}}/><div className="flex flex-wrap gap-2"><button className={primaryClass} disabled={busy} onClick={change}>{c(busy?'saving':'confirm')}</button><button className={buttonClass} disabled={busy} onClick={()=>setAction('')}>{c('close')}</button></div></Modal>}
 </section>;
}
