import { formatQuantity } from '@/lib/quantity';
import { ArrowRight } from 'lucide-react';
import CopyableCode from '@/components/CopyableCode';
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
 const planned=doc?.kind==='ORDER'&&!doc.locationId;
 const active=doc&&['DRAFT','PENDING','OPEN','PARTIAL'].includes(doc.status);
 return <section className="space-y-5"><button type="button" className={`${buttonClass} !bg-emerald-50 !text-emerald-700 !border-emerald-200 hover:!bg-emerald-100`} onClick={close}><ArrowRight aria-hidden="true" className={`h-4 w-4 ${lang==='ar'?'':'rotate-180'}`} />{c('back')}</button><Feedback {...{error,c}} notice={message} retry={reload}/>{!doc&&!error&&<p role="status">{c('loading')}</p>}
 {doc&&<><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{c(doc.kind)} · {c(doc.status)}</h2><p className="text-sm text-slate-500 break-all" dir="ltr">{doc.reference}</p></div><div className="flex flex-wrap gap-2">
 {manage&&doc.status==='DRAFT'&&<><button className={buttonClass} onClick={()=>edit(doc)}>{c('editDocument')}</button><button className={primaryClass} onClick={e=>ask(e,'submit')}>{c(doc.kind==='ORDER'?'releaseOrder':'submitDocument')}</button></>}
 {doc.kind==='RECEIPT'&&doc.status==='PENDING'&&<>{context.permissions['receiving.confirm']&&<button className={primaryClass} onClick={e=>ask(e,'confirm')}>{c('confirmReceipt')}</button>}{manage&&<button className={buttonClass} onClick={e=>ask(e,'reopen')}>{c('reopenDraft')}</button>}</>}
 {doc.kind==='ORDER'&&['OPEN','PARTIAL'].includes(doc.status)&&context.permissions['receiving.create']&&<button className={primaryClass} onClick={()=>receive(doc)}>{c('receiveRemaining')}</button>}
 {manage&&active&&context.permissions[doc.kind==='ORDER'?'purchasing.delete':'receiving.delete']&&<button className={buttonClass} onClick={e=>ask(e,'cancel')}>{c('cancelDocument')}</button>}
 </div></div>
 <dl className={`${panelClass} grid gap-4 sm:grid-cols-2`}>{[['selectedSupplier',doc.supplierName||'—'],...(planned?[]:[['selectedLocation',doc.locationName],['supplierReference',doc.supplierReference||'—']]),[planned?'orderDate':'documentDate',doc.documentDate],['createdBy',doc.actorName],...(doc.completedAt?[['completedBy',doc.completedName],['completedAt',new Date(doc.completedAt).toLocaleString(lang==='ar'?'ar-AE':'en-GB',{timeZone:context.business.timezone})]]:[])].map(([key,value])=><div key={key} className="min-w-0"><dt className="text-xs text-slate-500">{c(key)}</dt><dd className="text-sm font-medium mt-1 break-words">{value}</dd></div>)}</dl>
 {doc.orderId&&<p className="text-sm text-slate-500 break-all">{c('linkedOrder')}: <span dir="ltr">{doc.orderId}</span></p>}
 {planned?<Table c={c} headers={['productName','quantity','receivedQuantity']}>
  {doc.plannedItems.map(item=><tr key={item.id}>
   <td className="px-5 py-3 font-medium">{item.name}</td>
   <td className="px-5 py-3"><bdi>{formatQuantity(item.quantity)}</bdi></td>
   <td className="px-5 py-3"><bdi>{formatQuantity(item.receivedQuantity)}</bdi></td>
  </tr>)}
 </Table>:<> <p className="text-xs text-slate-500">{c('quantitiesBase')}</p>
 <Table c={c} tableClassName="min-w-[640px]" headers={['productName','barcodes','unit','baseQuantity',...(doc.kind==='ORDER'?['receivedQuantity']:[]),...(context.permissions['catalogue.cost']?['unitCost','totalValue']:[])]}>{doc.lines.map(l=><tr key={l.id}><td className="px-5 py-3"><span className="font-semibold">{l.name}</span><span className="block text-xs text-slate-500"><CopyableCode>{l.sku}</CopyableCode></span>{l.packName&&<span className="block text-xs text-slate-500">{formatQuantity(l.quantity)} × {l.packName} ({formatQuantity(l.factor)})</span>}</td><td className="px-5 py-3 text-start">{l.barcodes?.length?l.barcodes.map(barcode=><span key={barcode} className="block text-sm font-mono"><CopyableCode kind="barcode">{barcode}</CopyableCode></span>):'—'}</td><td className="px-5 py-3">{unitLabel(l.unit,c)}</td><td className="px-5 py-3 tabular-nums text-start"><bdi dir="ltr">{formatQuantity(l.baseQuantity)}</bdi></td>{doc.kind==='ORDER'&&<td className="px-5 py-3 tabular-nums text-start"><bdi dir="ltr">{formatQuantity(l.receivedQuantity)}</bdi></td>}{context.permissions['catalogue.cost']&&<><td className="px-5 py-3 tabular-nums text-start"><bdi dir="ltr">{l.unitCost}</bdi></td><td className="px-5 py-3 tabular-nums text-start"><bdi dir="ltr">{displayAmount(l.lineTotal)}</bdi></td></>}</tr>)}</Table>
 {doc.totalValue!==undefined&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 font-semibold"><span>{c('totalValue')}</span><bdi dir="ltr" className="tabular-nums">{displayAmount(doc.totalValue)} {doc.currency}</bdi></div>}
 </>}
 {doc.notes&&<div className={panelClass}><h3 className="text-sm font-semibold">{c('notes')}</h3><p className="text-sm mt-2 whitespace-pre-wrap break-words">{doc.notes}</p></div>}
 {doc.status==='COMPLETED'&&<p className="text-sm text-slate-500">{c('viewReceiptHint')}</p>}
 </>}
 {action&&<Modal {...{c,lang,busy}} returnFocus={trigger.current} title={c('confirmAction')} description={c(action==='confirm'?'confirmReceiptHint':action==='cancel'?'cancelDocumentHint':action==='reopen'?'reopenHint':'submitHint')} close={()=>setAction('')}><Feedback error={failure} c={c} retry={()=>{setAction('');reload();}}/><div className="flex flex-wrap gap-2"><button className={primaryClass} disabled={busy} onClick={change}>{c(busy?'saving':'confirm')}</button><button className={buttonClass} disabled={busy} onClick={()=>setAction('')}>{c('close')}</button></div></Modal>}
 </section>;
}
