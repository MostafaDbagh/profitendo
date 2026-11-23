import {cashClosingCopy} from './cashClosingCopy';
import Disclosure,{OptionalFields} from '../business-v2/Disclosure';
import {paymentFormCopy} from './paymentFormCopy';
import { Plus } from 'lucide-react';
import { currencyFormatter } from '../../lib/currencyFormat';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import PaymentReversal from './PaymentReversal';
import {useRef,useState} from 'react';
import {Field} from '../auth-v2/Fields';
import {useResource} from '../business-v2/useBusinessApi';
import {Feedback,Modal,Select,Table,Pager,buttonClass,primaryClass,panelClass} from '../business-v2/UI';
import {LocationChoice,DocumentPicker,decimalPattern,scale,format} from './Shared';
export function PaymentForm({context,api,c:parentCopy,lang,close,done,expensesOnly,withdrawalLocation,initialKind}){
 const text=paymentFormCopy[lang==='ar'?'ar':'en'],c=key=>text[key]||parentCopy(key),posting=useRef(false);
 const root=`/businesses/${context.business.id}`,supplier=context.permissions['catalogue.cost']&&context.permissions['purchasing.manage'],options=withdrawalLocation?['CASH_OUT']:expensesOnly?['EXPENSE']:[...(supplier?['SUPPLIER_PAYMENT','SUPPLIER_REFUND']:[]),'CUSTOMER_REFUND','EXPENSE','CASH_IN','CASH_OUT'];const [kind,setKind]=useState(options.includes(initialKind)?initialKind:options[0]),[location,setLocation]=useState(withdrawalLocation??null),[source,setSource]=useState(null),[balance,setBalance]=useState(null),[amount,setAmount]=useState(''),[method,setMethod]=useState('CASH'),[reference,setReference]=useState(''),[reason,setReason]=useState(''),[picker,setPicker]=useState(null),[review,setReview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),key=useRef(crypto.randomUUID()),last=useRef('');const linked=kind.includes('SUPPLIER')||kind==='CUSTOMER_REFUND';
 const draft=useLocalDraft(`payment:${withdrawalLocation ? `withdrawal:${withdrawalLocation.id}` : expensesOnly?'expense':initialKind||'all'}`,{kind,location,source,amount,method,reference,reason,clientKey:key.current,fingerprint:last.current},saved=>{setKind(withdrawalLocation?'CASH_OUT':expensesOnly?'EXPENSE':options.includes(saved.kind)?saved.kind:options[0]);setLocation(withdrawalLocation??saved.location);setSource(saved.source);setAmount(saved.amount);setMethod(saved.method);setReference(saved.reference);setReason(saved.reason);setReview(null);key.current=saved.clientKey;last.current=saved.fingerprint;});
 async function choose(r){setBusy(true);setError('');try{const b=await api(`${root}/workflows/balances/${r.id}?kind=${kind.startsWith('SUPPLIER')?'SUPPLIER':'CUSTOMER'}`);setSource(r);setBalance(b);setAmount(kind==='SUPPLIER_REFUND'?b.refundDue:b.outstanding);setPicker(null);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function save(){if(posting.current)return;posting.current=true;setBusy(true);setError('');const body={locationId:location.id,kind,...(linked?{sourceId:source.id}:{}),amount,method,reference,reason,confirm:true};if(last.current!==JSON.stringify(body)){last.current=JSON.stringify(body);key.current=crypto.randomUUID();}draft.checkpoint({clientKey:key.current,fingerprint:last.current});try{await api(`${root}/workflows/payments`,{method:'POST',body:{...body,clientKey:key.current}});draft.clear();done();}catch(e){setError(e.message);setReview(null);}finally{posting.current=false;setBusy(false);}}
 return <div className="mx-auto w-full max-w-3xl space-y-5"><div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-xl font-bold">{withdrawalLocation ? treasuryCopy[lang === 'ar' ? 'ar' : 'en'].withdraw : expensesOnly?c('EXPENSE'):c('recordPayment')}</h2><button className={buttonClass} disabled={busy} onClick={close}>{c('close')}</button></div><LocalDraftNotice {...{draft,lang,busy}}/><Feedback {...{c,error}}/><form className={`${panelClass} space-y-6`} onSubmit={e=>{e.preventDefault();if(!busy&&location&&(!linked||source))setReview(e.nativeEvent.submitter||e.currentTarget.querySelector('button[type=submit]'));}}><fieldset disabled={busy} className="space-y-4 min-w-0"><p className="text-sm text-slate-500">{c('paymentEntryHint')}</p>{!withdrawalLocation && !expensesOnly && <Select id="money-kind" label={c('recordType')} value={kind} onChange={e=>{setKind(e.target.value);setSource(null);setBalance(null);setAmount('');if(e.target.value.startsWith('CASH_'))setMethod('CASH');}}>{options.map(k=><option key={k} value={k}>{c(k)}</option>)}</Select>}{withdrawalLocation ? <p className="font-medium">{withdrawalLocation.name}</p> : <LocationChoice {...{context,api,c,lang}} value={location} onChange={l=>{setLocation(l);setSource(null);setBalance(null);if(linked)setAmount('');}}/>}{linked&&location&&<button type="button" className={`${buttonClass} ms-2`} onClick={e=>setPicker(e.currentTarget)}>{source?.reference||c(kind==='CUSTOMER_REFUND'?'chooseReturn':'chooseReceipt')}</button>}{balance&&<div className="bg-slate-50 rounded-lg p-3 text-sm">{c(kind==='SUPPLIER_REFUND'?'refundDue':'outstanding')}: <bdi>{kind==='SUPPLIER_REFUND'?balance.refundDue:balance.outstanding} {balance.currency}</bdi></div>}
 <div className="grid sm:grid-cols-2 gap-5 border-t border-slate-100 pt-5"><div className="[&_input]:text-xl [&_input]:font-semibold [&_input]:tabular-nums"><Field id="money-amount" label={`${c('amount')} (${context.business.baseCurrency})`} placeholder={c('moneyExample')} value={amount} onChange={e=>setAmount(e.target.value)} pattern={decimalPattern} inputMode="decimal" required/></div><Select id="money-method" label={c('salePayment')} value={method} disabled={kind.startsWith('CASH_')} onChange={e=>setMethod(e.target.value)}>{['CASH','CARD','TRANSFER'].map(k=><option key={k} value={k}>{c(k)}</option>)}</Select><div className="sm:col-span-2"><Field id="money-reason" label={c(kind==='EXPENSE'?'expenseReason':'recordReason')} placeholder={c(kind==='EXPENSE'?'expenseExample':'paymentReasonExample')} value={reason} onChange={e=>setReason(e.target.value)} required minLength={5} maxLength={2000}/></div></div>{method==='CASH'?<OptionalFields hasValue={Boolean(reference)}><Field id="money-reference" label={c('paymentReference')} placeholder={c('salePaymentReferencePlaceholder')} value={reference} onChange={e=>setReference(e.target.value)} required={method!=='CASH'} maxLength={150}/></OptionalFields>:<Field id="money-reference" label={c('paymentReference')} placeholder={c('salePaymentReferencePlaceholder')} value={reference} onChange={e=>setReference(e.target.value)} required={method!=='CASH'} maxLength={150}/>}</fieldset><div className="border-t border-slate-100 pt-5 flex justify-end"><button type="submit" className={`${primaryClass} w-full sm:w-auto`} disabled={busy||!location||linked&&!source}>{c('reviewPayment')}</button></div></form>
 {picker&&<DocumentPicker {...{api,c,lang}} path={kind==='CUSTOMER_REFUND'?`${root}/workflows/adjustments?kind=CUSTOMER_RETURN&status=COMPLETED&locationId=${location.id}`:`${root}/operations/purchases?kind=RECEIPT&status=COMPLETED&locationId=${location.id}`} returnFocus={picker} close={()=>setPicker(null)} onSelect={choose}/>}{review&&<Modal {...{c,lang,busy}} title={c('reviewPayment')} description={c('paymentConfirmHint')} returnFocus={review} close={()=>setReview(null)}><dl className="space-y-3 text-sm"><div>{c(kind)} · {location.name}</div><div className="font-bold text-lg"><bdi>{amount} {context.business.baseCurrency}</bdi></div><div>{c(method)} · {reference}</div><div>{source?.reference}</div><div>{reason}</div></dl><button className={`${primaryClass} mt-5`} disabled={busy} onClick={save}>{c(busy?'saving':'savePayment')}</button></Modal>}</div>;
}
const treasuryCopy = {
 ar: { withdraw:'تسجيل سحب نقدي', sales:'مبيعات نقدية', refunds:'مرتجعات نقدية', expenses:'مصروفات نقدية', withdrawals:'مسحوبات نقدية', current:'الرصيد الحالي', other:'صافي الحركات النقدية الأخرى', history:'سجل الإقفالات', noClosings:'لا توجد إقفالات بعد', withdrawalList:'المسحوبات', noWithdrawals:'لا توجد مسحوبات', locationHint:'اختر الموقع لعرض الرصيد والإقفالات والمسحوبات.' },
 en: { withdraw:'Record withdrawal', sales:'Cash sales', refunds:'Cash refunds', expenses:'Cash expenses', withdrawals:'Cash withdrawals', current:'Current balance', other:'Other net cash activity', history:'Closing history', noClosings:'No closings yet', withdrawalList:'Withdrawals', noWithdrawals:'No withdrawals yet', locationHint:'Choose a location to see its balance, closings, and withdrawals.' },
};

function CashHistory({api,c,text,location,root,money}) {
 const [page,setPage] = useState(1);
 const {data,error,reload} = useResource(api,`${root}/cash/history?locationId=${location.id}&page=${page}`);
 return <section className={`${panelClass} min-w-0 space-y-4`}>
  <h3 className="text-lg font-bold">{text.history}</h3>
  <Feedback {...{error,c}} retry={reload} />
  {!data && !error && <p role="status">{c('loading')}</p>}
  {data?.total === 0 && <p className="text-sm text-slate-500">{text.noClosings}</p>}
  {data?.items.length > 0 && <>
   <Table tools={false} headers={['cashDay','expected','counted','variance']} c={c}>
    {data.items.map(row => <tr key={row.id}>
     <td className="whitespace-nowrap p-3"><bdi>{row.day}</bdi></td>
     {['expected','counted','variance'].map(key => <td key={key} className="whitespace-nowrap p-3"><bdi>{money(row[key],row.currency)}</bdi></td>)}
    </tr>)}
   </Table>
   {data.total > data.pageSize && <Pager {...{data,setPage,c}} />}
  </>}
 </section>;
}

function WithdrawalHistory({api,c,text,location,root,money,timezone,lang,onDetails}) {
 const [page,setPage] = useState(1);
 const {data,error,reload} = useResource(api,`${root}/payments?locationId=${location.id}&kind=CASH_OUT&page=${page}`);
 return <section className={`${panelClass} min-w-0 space-y-4`}>
  <h3 className="text-lg font-bold">{text.withdrawalList}</h3>
  <Feedback {...{error,c}} retry={reload} />
  {!data && !error && <p role="status">{c('loading')}</p>}
  {data?.total === 0 && <p className="text-sm text-slate-500">{text.noWithdrawals}</p>}
  {data?.items.length > 0 && <>
   <Table tools={false} headers={['cashDay','amount','recordReason','status','actions']} c={c}>
    {data.items.map(row => <tr key={row.id}>
     <td className="whitespace-nowrap p-3"><bdi>{new Date(row.createdAt).toLocaleString(lang,{timeZone:timezone})}</bdi></td>
     <td className="whitespace-nowrap p-3"><bdi>{money(row.amount,row.currency)}</bdi></td>
     <td className="min-w-32 break-words p-3">{row.reason}</td>
     <td className="p-3">{c(row.reversalOfId?'reversalEntry':row.reversedBy?'paymentReversed':'paymentPosted')}</td>
     <td className="p-3"><button type="button" className={buttonClass} onClick={event => onDetails({entry:row,returnFocus:event.currentTarget})}>{c('paymentDetails')}</button></td>
    </tr>)}
   </Table>
   {data.total > data.pageSize && <Pager {...{data,setPage,c}} />}
  </>}
 </section>;
}

export function CashDay({context,api,c:parentCopy,lang,location,onDetails}) {
 const words=cashClosingCopy[lang==='ar'?'ar':'en'],c=key=>words[key]||parentCopy(key),posting=useRef(false);
 const {timezone} = context.business;
 const text = treasuryCopy[lang === 'ar' ? 'ar' : 'en'];
 const root = `/businesses/${context.business.id}/workflows`;
 const today = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [day,setDay]=useState(today),[opening,setOpening]=useState('0'),[counted,setCounted]=useState(''),[reason,setReason]=useState('');
 const [review,setReview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[historyVersion,setHistoryVersion]=useState(0);
 const {data,error:loadError,reload}=useResource(api,`${root}/cash?locationId=${location.id}&day=${day}`);
 const money = (value,currency) => currencyFormatter(lang,{style:'currency',currency}).format(value);
 const openingValue=scale(opening);
 const expected=data && openingValue!==null ? format(openingValue+scale(data.inflow)-scale(data.outflow)) : null;
 const countedValue=scale(counted),variance=expected!==null && countedValue!==null ? countedValue-scale(expected) : null;
 const needsReason=variance!==null && variance!==0n;
 const cashDraft=useLocalDraft(`cash:${location.id}`,{day,opening,counted,reason},saved=>{
  setDay(saved.day);setOpening(saved.opening);setCounted(saved.counted);setReason(saved.reason);setReview(null);
 });
 async function save() {
  if(posting.current)return;posting.current=true;
  setBusy(true);setError('');
  try {
   await api(`${root}/cash`,{method:'POST',body:{locationId:location.id,day,opening,counted,expected,reason,confirm:true}});
   cashDraft.clear();setHistoryVersion(version=>version+1);
  } catch(failure) { setError(failure.message); }
  finally {posting.current=false;setReview(null);reload();setBusy(false);}
 }
 const breakdown=data?.breakdown;
 const expenseValue = value => value == null ? null : format(-scale(value));
 const cards=data ? [
  [c('opening'),data.closed?.opening??(openingValue===null?null:opening)],
  [text.sales,breakdown?.sales],[text.refunds,expenseValue(breakdown?.refunds)],
  [text.expenses,expenseValue(breakdown?.expenses)],[text.withdrawals,expenseValue(breakdown?.withdrawals)],
  [text.current,data.closed?.counted??expected],
 ] : [];
 return <div className="space-y-4">
  <div className="max-w-xs"><Field id="cash-day" type="date" label={c('cashDay')} disabled={busy} value={day} max={today} required onChange={event=>{
   if(event.target.value){setDay(event.target.value);setOpening('0');setCounted('');setReason('');setError('');}
  }}/></div>
  <Feedback c={c} error={error||loadError} retry={reload} />
  {!data && !loadError && <p role="status">{c('loading')}</p>}
  {data && <Disclosure title={words.breakdown}>
   <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
    {cards.map(([label,value],index)=><div key={label} className={`min-w-0 rounded-xl border p-3 shadow-sm sm:p-4 ${index===5?'border-emerald-700 bg-emerald-700 text-white':'border-slate-200 bg-white text-slate-900'}`}>
     <dt className={`text-sm ${index===5?'text-emerald-50':'text-slate-600'}`}>{label}</dt>
     <dd className="mt-2 break-words text-base font-bold sm:text-lg"><bdi>{value==null?'—':money(value,data.currency)}</bdi></dd>
    </div>)}
   </dl>
   {breakdown?.other && scale(breakdown.other)!==0n && <p className="text-sm text-slate-600">{text.other} <bdi>{money(breakdown.other,data.currency)}</bdi></p>}
  </Disclosure>}
  <div className="max-w-2xl mx-auto">
   <section className={`${panelClass} min-w-0 space-y-4`}>
    <h3 className="text-lg font-bold">{c('closeCashDay')}</h3><p className="text-sm text-slate-600">{words.intro}</p>
    <LocalDraftNotice draft={cashDraft} {...{lang,busy}} />
    {data?.closed ? <div className="space-y-2 text-sm">
     <p className="font-semibold text-emerald-800">{c('cashClosed')}</p>
     {['expected','counted','variance'].map(key=><p key={key}>{c(key)} <bdi>{money(data.closed[key],data.closed.currency)}</bdi></p>)}
     {data.closed.reason && <p>{data.closed.reason}</p>}
    </div> : data && <form className="space-y-4" onSubmit={event=>{event.preventDefault();if(!busy&&openingValue!==null&&openingValue>=0n&&countedValue!==null&&countedValue>=0n&&(!needsReason||reason.trim().length>=5))setReview(event.nativeEvent.submitter||event.currentTarget.querySelector('button[type=submit]'));}}>
     <p className="flex justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm">
      <span className="text-slate-600">{c('expected')}</span><bdi className="font-bold">{expected===null?'—':money(expected,data.currency)}</bdi>
     </p>
     <fieldset disabled={busy} className="space-y-3">
      <Field id="cash-opening" label={c('opening')} value={opening} onChange={event=>setOpening(event.target.value)} pattern={decimalPattern} inputMode="decimal" required />
      <p className="text-xs text-slate-500">{words.openingHint}</p>
      <Field id="cash-counted" placeholder="0.00" label={c('counted')} value={counted} onChange={event=>setCounted(event.target.value)} pattern={decimalPattern} inputMode="decimal" required />
      {needsReason?<Field id="cash-reason" label={c('varianceReason')} placeholder={c('varianceExample')} value={reason} onChange={event=>setReason(event.target.value)} required minLength={5} maxLength={2000} />:<OptionalFields><Field id="cash-reason" label={words.note} value={reason} onChange={event=>setReason(event.target.value)} maxLength={2000}/></OptionalFields>}
     </fieldset>
     {variance!==null && <p role="status" className={variance===0n?'text-sm text-emerald-800':'text-sm text-amber-800'}>{variance===0n?words.match:<>{variance<0n?words.short:words.extra} <bdi>{money(format(variance<0n?-variance:variance),data.currency)}</bdi></>}</p>}
     <button type="submit" className={`${primaryClass} w-full`} disabled={busy||expected===null||openingValue<0n||countedValue===null||countedValue<0n||needsReason&&reason.trim().length<5}>{words.review}</button>
    </form>}
   </section>
  </div>
  <Disclosure title={words.history}><CashHistory key={historyVersion} {...{api,c,text,location,root,money}} /><WithdrawalHistory {...{api,c,text,location,root,money,timezone,lang,onDetails}} /></Disclosure>
  {review && <Modal {...{c,lang,busy}} title={c('closeCashDay')} description={c('cashCloseConfirm')} returnFocus={review} close={()=>setReview(null)}>
   <p><bdi>{day}</bdi> · {location.name}</p>
   <dl className="my-4 space-y-3">{[['expected',expected],['counted',counted],['variance',variance===null?null:format(variance)]].map(([label,value])=><div key={label} className="flex flex-wrap justify-between gap-2"><dt>{c(label)}</dt><dd className="font-semibold"><bdi>{value===null?'—':money(value,data.currency)}</bdi></dd></div>)}</dl>{reason&&<p className="mb-4 text-sm text-slate-600">{reason}</p>}
   <button type="button" className={primaryClass} disabled={busy} onClick={save}>{c('confirm')}</button>
  </Modal>}
 </div>;
}
export default function Payments({context,api,c,lang,mode,initialAction}){const expensesOnly=mode==='expenses';const [selected,setSelected]=useState(null),[success,setSuccess]=useState(''),[editing,setEditing]=useState(context.permissions['payments.manage']&&['new','refund'].includes(initialAction)?initialAction:false),[view,setView]=useState(!expensesOnly&&context.permissions['cash.close']?'cash':'entries'),[location,setLocation]=useState(null),[cashVersion,setCashVersion]=useState(0),[page,setPage]=useState(1),{data,error,reload}=useResource(api,`/businesses/${context.business.id}/workflows/payments?page=${page}${expensesOnly?'&kind=EXPENSE':''}`),shared={context,api,c,lang,expensesOnly};
 const text=treasuryCopy[lang==='ar'?'ar':'en'];
 const locations=useResource(api,view==='cash'?`/businesses/${context.business.id}/locations?state=active`:null);
 const selectedLocation=location??(locations.data?.total===1?locations.data.items[0]:null);
 if(editing)return <PaymentForm {...shared} initialKind={editing==='refund'?'CUSTOMER_REFUND':undefined} withdrawalLocation={editing==='withdrawal'?selectedLocation:undefined} close={()=>setEditing(false)} done={()=>{setEditing(false);setCashVersion(version=>version+1);reload();}}/>;
 return <div className="space-y-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-bold">{c(expensesOnly?'expenses':'payments')}</h2><p className="text-sm text-slate-500 mt-1">{c('paymentsHint')}</p></div>{context.permissions['payments.manage']&&(view==='cash'?<button type="button" className={primaryClass} disabled={!selectedLocation} onClick={()=>setEditing('withdrawal')}><Plus className="h-4 w-4" aria-hidden="true"/>{text.withdraw}</button>:<button className={primaryClass} onClick={()=>setEditing(true)}>{c('recordPayment')}</button>)}</div>{!expensesOnly&&context.permissions['cash.close']&&<div className="flex gap-2"><button className={view==='entries'?primaryClass:buttonClass} onClick={()=>setView('entries')}>{c('paymentHistory')}</button><button className={view==='cash'?primaryClass:buttonClass} onClick={()=>setView('cash')}>{c('dailyCash')}</button></div>}{view==='cash'?<><LocationChoice {...shared} value={selectedLocation} onChange={setLocation} all/>{selectedLocation ? <CashDay key={`${selectedLocation.id}:${cashVersion}`} {...shared} location={selectedLocation} onDetails={setSelected}/> : <p className="text-sm text-slate-600">{text.locationHint}</p>}</>:<><Feedback notice={success} {...{c,error}} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}{data&&<><Table c={c} headers={['recordType','selectedLocation','amount','salePayment','paymentReference','recordReason','status','actions']} empty={!data.items.length}>{data.items.map(r=><tr key={r.id}><td className="p-4">{c(r.kind)}</td><td className="p-4">{r.location.name}</td><td className="p-4 whitespace-nowrap"><bdi>{r.amount} {r.currency}</bdi></td><td className="p-4">{c(r.method)}</td><td className="p-4">{r.reference||'—'}</td><td className="p-4">{r.reason}</td><td className="p-4">{c(r.reversalOfId?'reversalEntry':r.reversedBy?'paymentReversed':'paymentPosted')}</td><td className="p-4"><button className={buttonClass} onClick={e=>setSelected({entry:r,returnFocus:e.currentTarget})}>{c(!r.reversalOfId&&!r.reversedBy&&context.permissions['payments.reverse']&&context.permissions['payments.manage']&&(!r.kind.startsWith('SUPPLIER')||(context.permissions['catalogue.cost']&&context.permissions['purchasing.manage']))?'reversePayment':'paymentDetails')}</button></td></tr>)}</Table><Pager {...{data,setPage,c}}/></>}</>}{selected&&<PaymentReversal {...shared} {...selected} close={()=>setSelected(null)} done={()=>{setSelected(null);setSuccess('reversalSaved');setCashVersion(version=>version+1);reload();}}/>}</div>;
}
