import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import CustomerReturn from '../completion-v2/CustomerReturn';
import SaleSteps from './SaleSteps';
import { saleStaff } from './saleStaff';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { useRef,useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { Feedback,Modal,Select,Table,Pager,buttonClass,primaryClass,panelClass } from '../business-v2/UI';
import { useResource } from '../business-v2/useBusinessApi';
import Editor from './Editor';
import PaymentMethod from './PaymentMethod';
import Receipt,{money} from './Receipt';
function SaleDetail({doc,setDoc,path,api,c,lang,edit,close,onReturn,initialCheckout}){
 const payment=initialCheckout?.payment;
 const [method,setMethod]=useState(payment?.method ?? 'CASH');
 const [received,setReceived]=useState(method==='CREDIT' ? '0' : initialCheckout?.error==='TOTAL_CHANGED' ? doc.total : payment?.received ?? doc.total);
 const [reference,setReference]=useState(payment?.reference ?? '');
 const [busy,setBusy]=useState(false), [error,setError]=useState(initialCheckout?.error ?? ''), [cancel,setCancel]=useState(null);
 const key=useRef(initialCheckout?.checkoutKey ?? crypto.randomUUID());
 const last=useRef(initialCheckout?.checkoutKey ? JSON.stringify({revision:doc.revision,expectedTotal:doc.total,confirm:true,payment:{method,received,reference}}) : '');
 const draft=useLocalDraft(`checkout:${doc.id}:${doc.revision}`,{method,received,reference,clientKey:key.current,fingerprint:last.current},saved=>{setMethod(saved.method);setReceived(saved.received);setReference(saved.reference);key.current=saved.clientKey;last.current=saved.fingerprint;});
 async function complete(e){e.preventDefault();if(busy)return;setBusy(true);setError('');const content={revision:doc.revision,expectedTotal:doc.total,confirm:true,payment:{method,received,reference}};const fingerprint=JSON.stringify(content);if(last.current!==fingerprint){key.current=crypto.randomUUID();last.current=fingerprint;}draft.checkpoint({clientKey:key.current,fingerprint:last.current});
 try{const result=await api(`${path}/${doc.id}/checkout`,{method:'POST',body:{...content,clientKey:key.current}});draft.clear();setDoc(result);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function cancelDraft(){setBusy(true);setError('');try{setDoc(await api(`${path}/${doc.id}/cancel`,{method:'POST',body:{revision:doc.revision,confirm:true}}));setCancel(null);}catch(e){setError(e.message);setCancel(null);}finally{setBusy(false);}}
 return <PageLayout as="div"><PageHeader title={c(doc.status==='COMPLETED'?'saleReceipt':'saleQuote')} accessory={<>{doc.status==='COMPLETED'&&onReturn&&<button className={buttonClass} onClick={onReturn}>{lang==='ar'?'إرجاع منتجات':'Return items'}</button>}{doc.status==='COMPLETED'&&<button type="button" className={primaryClass} onClick={()=>window.print()}>{c('printReceipt')}</button>}<button className={buttonClass} disabled={busy} onClick={close}>{c('close')}</button></>}/>{doc.status!=='CANCELLED'&&<SaleSteps step={doc.status==='COMPLETED'?2:1} lang={lang}/>}<Feedback {...{c,error}}/><div className={`grid gap-5 items-start ${doc.capabilities.checkout?'lg:grid-cols-2':'grid-cols-1 max-w-2xl mx-auto w-full'}`}><div className={`${panelClass} ${doc.capabilities.checkout?'order-2 lg:order-1':''}`} data-print-invoice={doc.status==='COMPLETED'?true:undefined}><Receipt {...{doc,c,lang}}/></div><div className="space-y-5 order-1 lg:order-2">
 {doc.capabilities.checkout&&<form onSubmit={complete} className={`${panelClass} space-y-4`}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{lang==='ar'?'تحصيل الدفع':'Take payment'}</h3><strong className="text-lg text-emerald-700"><bdi>{money(doc.total,doc,lang)}</bdi></strong></div><LocalDraftNotice {...{draft,lang,busy}}/><p className="text-sm text-slate-600">{c('saleQuoteHint')}</p><fieldset disabled={busy} className="space-y-4"><PaymentMethod {...{method,reference,c,lang}} onMethod={next=>{setMethod(next);setReference('');setReceived(next==='CREDIT'?'0':doc.total);}} onReference={setReference}/>
 {method==='CASH'&&<Field id="sale-received" label={`${c('saleReceived')} (${doc.currency})`} placeholder={c('saleReceivedPlaceholder')} value={received} onChange={e=>setReceived(e.target.value)} inputMode="decimal" required pattern="(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?"/>}<p className="text-sm text-slate-500">{c(method==='CREDIT'?'saleCreditHint':'salePaymentHint')}</p><button className={`${primaryClass} w-full`} disabled={busy}>{c(busy?'saving':method==='CREDIT'?'confirmCreditSale':'completeSale')}</button></fieldset></form>}
 <div className="flex flex-wrap gap-2">{doc.capabilities.edit&&<button className={buttonClass} disabled={busy} onClick={edit}>{c('saleEdit')}</button>}{doc.capabilities.cancel&&<button className={buttonClass} disabled={busy} onClick={e=>setCancel(e.currentTarget)}>{c('saleCancel')}</button>}</div></div></div>
 {cancel&&<Modal {...{c,lang,busy}} title={c('saleConfirmCancel')} description={c('saleConfirmCancelHint')} returnFocus={cancel} close={()=>setCancel(null)}><div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={()=>setCancel(null)}>{c('close')}</button><button className={primaryClass} disabled={busy} onClick={cancelDraft}>{c('confirm')}</button></div></Modal>}</PageLayout>;
}
export default function Sales({context,api,c,lang,initialAction}){
 const path=`/businesses/${context.business.id}/sales`,[page,setPage]=useState(1),[status,setStatus]=useState(''),[doc,setDoc]=useState(null),[initialCheckout,setInitialCheckout]=useState(null),[returning,setReturning]=useState(false),[editing,setEditing]=useState(['new','setup'].includes(initialAction) && !!context.permissions['sales.create']),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const resource=useResource(api,`${path}?page=${page}${status?`&status=${status}`:''}`);
 const close=()=>{setEditing(false);setDoc(null);setInitialCheckout(null);setError('');resource.reload();};
 async function open(id){setLoading(true);setError('');try{setDoc(await api(`${path}/${id}`));}catch(e){setError(e.message);}finally{setLoading(false);}}
 if(returning&&doc)return <CustomerReturn {...{context,api,c,lang}} initialSale={doc} close={()=>setReturning(false)}/>;
 if(editing)return <Editor {...{context,api,c,lang,doc,close}} done={(sale,checkout)=>{setInitialCheckout(checkout ?? null);setDoc(sale);setEditing(false);resource.reload();}}/>;
 if(doc)return <SaleDetail key={`${doc.id}-${doc.revision}`} initialCheckout={doc.status==='DRAFT'?initialCheckout:null} {...{doc,setDoc,path,api,c,lang,close}} edit={()=>setEditing(true)} onReturn={context.permissions['returns.create']&&context.permissions['returns.view']?()=>setReturning(true):undefined}/>;
 return <PageLayout as="div" title={c('sales')} actions={[
  {id:'new-sale',label:c('newSale'),variant:'primary',visible:!!context.permissions['sales.create'],onClick:()=>setEditing(true)},
 ]}><Feedback c={c} error={error||resource.error} retry={resource.reload}/>{!resource.data&&!resource.error&&<LoadingState>{c('loading')}</LoadingState>}<Table showRows={!!resource.data} filters={<div className="max-w-xs"><Select id="sales-status" label={c('saleStatus')} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{c('saleAll')}</option>{['DRAFT','COMPLETED','CANCELLED'].map(s=><option key={s} value={s}>{c(s)}</option>)}</Select></div>} filtersActive={Boolean(status)} c={c} headers={['reference','saleShop','saleCustomerName','saleStaff','status','saleTotal','actions']} empty={!resource.data?.items.length}>{resource.data?.items.map(row=><tr key={row.id}><td className="px-5 py-4"><bdi>{row.reference}</bdi></td><td className="px-5 py-4">{row.locationName}</td><td className="px-5 py-4"><bdi>{row.customerName?.trim() || '—'}</bdi></td><td className="px-5 py-4"><span>{saleStaff(row,c).label}: </span><bdi className="font-semibold text-emerald-700">{saleStaff(row,c).name}</bdi></td><td className="px-5 py-4">{c(row.status)}</td><td className="px-5 py-4 whitespace-nowrap">{money(row.total,row,lang)}</td><td className="px-5 py-4"><button className={buttonClass} disabled={loading} onClick={()=>open(row.id)}>{c('openDocument')}</button></td></tr>)}</Table>
 {resource.data&&<Pager data={resource.data} {...{setPage,c}}/>}</PageLayout>;
}
