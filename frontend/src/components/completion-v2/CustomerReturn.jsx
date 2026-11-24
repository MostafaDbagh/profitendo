import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import {useLocalDraft,LocalDraftNotice} from '../../lib/localDraft';
import {useRef,useState} from 'react';
import {RotateCcw} from 'lucide-react';
import {Field} from '../auth-v2/Fields';
import {Feedback,Select,buttonClass,primaryClass,panelClass} from '../business-v2/UI';
import {useResource} from '../business-v2/useBusinessApi';
import {DocumentPicker,decimalPattern,scale} from './Shared';
import {unitLabel} from '../catalogue-v2/units';
import AdjustmentDetail from './AdjustmentDetail';

export function returnCopy(c,lang){
 const ar=lang==='ar';
 const labels={chooseSource:ar?'اختر فاتورة البيع الأصلية':'Choose the original sale',chooseSourceHint:ar?'اختر الفاتورة التي تحتوي على المنتجات التي يعيدها الزبون.':'Choose the sale containing the items the customer is returning.',returnCredit:ar?'مبلغ الإرجاع':'Return amount',stockChange:ar?'التغيير في المخزون القابل للبيع':'Change in sellable stock',RESTOCK:ar?'سليم — يعود للمخزون':'Sellable — put back in stock',DAMAGED:ar?'تالف — لا يعود للمخزون':'Damaged — keep out of stock',approveRecord:ar?'تأكيد الإرجاع':'Confirm return',approveRecordHint:ar?'سيُحدّث المخزون ويُسجّل المبلغ المستحق للزبون. دفع المال للزبون يُسجّل بشكل منفصل.':'This updates stock and records the amount owed to the customer. Record the actual refund separately.'};
 return key=>labels[key]||c(key);
}
export default function CustomerReturn({context,api,c:parentCopy,lang,close,initialSale}){
 const c=returnCopy(parentCopy,lang),ar=lang==='ar',root=`/businesses/${context.business.id}`;
 const [busy,setBusy]=useState(false),[sale,setSale]=useState(initialSale||null),[picker,setPicker]=useState(null),[doc,setDoc]=useState(null);
 const resource=useResource(api,sale?`${root}/workflows/adjustments/source/${sale.id}?kind=CUSTOMER_RETURN`:null);
 if(doc)return <AdjustmentDetail {...{doc,api,c,lang,close}} done={setDoc}/>;
 return <PageLayout as="div" className="max-w-3xl mx-auto">
  <PageHeader title={ar?'إرجاع منتجات من الزبون':'Customer return'} accessory={<button className={buttonClass} disabled={busy} onClick={close}>{c('back')}</button>}/>
  <ol className="flex flex-wrap gap-3 text-sm text-slate-600" aria-label={ar?'خطوات الإرجاع':'Return steps'}>{(ar?['اختر الفاتورة','اختر المنتجات','راجع المبلغ والمخزون']:['Choose sale','Select items','Review refund and stock']).map((label,i)=><li key={label} className={i===(sale?1:0)?'font-semibold text-emerald-700':''}>{`${i+1}. ${label}`}</li>)}</ol>
  <div className={`${panelClass} space-y-3`}><p>{sale?.reference||c('chooseSourceHint')}</p><button className={buttonClass} disabled={busy} onClick={e=>setPicker(e.currentTarget)}>{sale?(ar?'اختيار فاتورة أخرى':'Choose another sale'):c('chooseSource')}</button></div>
  <Feedback c={c} error={resource.error} retry={resource.reload}/>
  {sale&&!resource.data&&!resource.error&&<LoadingState>{c('loading')}</LoadingState>}
  {resource.data&&<ReturnItems key={sale.id} {...{api,c,lang,root}} source={{...resource.data,id:sale.id}} done={setDoc} onBusy={setBusy}/>}
  {picker&&<DocumentPicker {...{api,c,lang}} path={`${root}/sales?status=COMPLETED`} returnFocus={picker} close={()=>setPicker(null)} onSelect={r=>{if(r.id===sale?.id)resource.reload();setSale(r);setPicker(null);}}/>}
 </PageLayout>;
}
export function ReturnItems({source,api,c,lang,root,done,onBusy=()=>{}}){
 const ar=lang==='ar',[rows,setRows]=useState(()=>source.lines.filter(l=>scale(l.remaining)>0n).map(l=>({...l,selected:false,quantity:'',condition:'RESTOCK'}))),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const posting=useRef(false),key=useRef(crypto.randomUUID()),fingerprint=useRef('');
 const draft=useLocalDraft(`customer-return:${source.id}`,{rows,reason,clientKey:key.current,fingerprint:fingerprint.current},saved=>{
  setRows(source.lines.filter(line=>scale(line.remaining)>0n).map(line=>{const prior=saved.rows.find(row=>row.id===line.id);return {...line,selected:!!prior?.selected,quantity:prior?.quantity||'',condition:prior?.condition==='DAMAGED'?'DAMAGED':'RESTOCK'};}));
  setReason(saved.reason);key.current=saved.clientKey;fingerprint.current=saved.fingerprint;
 });
 const update=(id,patch)=>setRows(old=>old.map(r=>r.id===id?{...r,...patch}:r));
 async function review(e){
  e.preventDefault();if(posting.current)return;
  const selected=rows.filter(r=>r.selected);
  if(!selected.length||selected.some(r=>scale(r.quantity)===null||scale(r.quantity)<=0n||scale(r.quantity)>scale(r.remaining))){setError('RETURN_INPUT_QUANTITY');return;}
  if(reason.trim().length<5){setError('RETURN_INPUT_REASON');return;}
  const body={kind:'CUSTOMER_RETURN',locationId:source.locationId,sourceId:source.id,reason,lines:selected.map(r=>({productId:r.productId,sourceLineId:r.id,quantity:r.quantity,condition:r.condition}))};
  const next=JSON.stringify(body);if(next!==fingerprint.current){fingerprint.current=next;key.current=crypto.randomUUID();}
  draft.checkpoint({clientKey:key.current,fingerprint:fingerprint.current});
  posting.current=true;setBusy(true);onBusy(true);setError('');
  try{const result=await api(`${root}/workflows/adjustments`,{method:'POST',body:{...body,clientKey:key.current}});draft.clear();done(result);}catch(e){setError(e.message);
   if(e.message==='RETURN_QUANTITY_EXCEEDED')try{const fresh=await api(`${root}/workflows/adjustments/source/${source.id}?kind=CUSTOMER_RETURN`);setRows(old=>old.map(row=>({...row,remaining:fresh.lines.find(line=>line.id===row.id)?.remaining||'0.0000'})));}catch{/* Keep the original rejection and entered values if refresh is unavailable. */}
  }finally{posting.current=false;setBusy(false);onBusy(false);}
 }
 return <form onSubmit={review} className="space-y-4"><Feedback {...{c,error}}/><LocalDraftNotice {...{draft,lang,busy}}/>
  {!rows.length?<p className={panelClass}>{ar?'أُرجعت جميع منتجات هذه الفاتورة. لا توجد كميات أخرى للإرجاع.':'All items from this sale have already been returned.'}</p>:<><p className="text-sm text-slate-600">{ar?'حدد المنتجات التي أعادها الزبون، ثم أدخل كمياتها.':'Select the items the customer brought back, then enter their quantities.'}</p>
  <fieldset disabled={busy} className="space-y-3 min-w-0">{rows.map((r,i)=><div className={`${panelClass} space-y-3`} key={r.id}>
   <label className="flex gap-3 items-center min-h-11 cursor-pointer font-semibold"><input type="checkbox" className="h-5 w-5 accent-emerald-600" checked={r.selected} onChange={e=>update(r.id,{selected:e.target.checked})}/>{r.name}</label>
   <p className="text-sm text-slate-500">{`${ar?'المتاح للإرجاع':'Available to return'}: ${r.remaining} ${unitLabel(r.unit,c)}`}</p>
   {r.selected&&<><div className="grid sm:grid-cols-2 gap-4"><Field id={`return-quantity-${i}`} label={ar?'الكمية المرتجعة':'Quantity returned'} required inputMode="decimal" pattern={decimalPattern} value={r.quantity} onChange={e=>update(r.id,{quantity:e.target.value})}/><Select id={`return-condition-${i}`} label={ar?'حالة المنتج':'Item condition'} value={r.condition} onChange={e=>update(r.id,{condition:e.target.value})}>{['RESTOCK','DAMAGED'].map(k=><option value={k} key={k}>{c(k)}</option>)}</Select></div><p className="text-sm text-slate-600">{r.condition==='DAMAGED'?(ar?'لن تُضاف هذه الكمية للمخزون القابل للبيع.':'These items will not be added to sellable stock.'):(ar?'تُضاف هذه الكمية للمخزون بعد تأكيد الإرجاع.':'These items go back into stock after the return is confirmed.')}</p></>}
  </div>)}<Field id="return-reason" label={ar?'لماذا أُرجعت المنتجات؟':'Why were the items returned?'} value={reason} onChange={e=>setReason(e.target.value)} required minLength={5} maxLength={2000}/></fieldset>
  <p className="text-sm text-slate-500">{ar?'الخطوة التالية تحفظ مسودة وتعرض المبلغ الصحيح من الفاتورة. لن يتغير المخزون قبل التأكيد.':'The next step saves a draft and shows the exact amount from the sale. Stock changes only after confirmation.'}</p>
  <button className={primaryClass} disabled={busy||!rows.some(r=>r.selected)}><RotateCcw aria-hidden="true"/>{busy?c('saving'):(ar?'مراجعة المبلغ والمخزون':'Review refund and stock')}</button></>}
 </form>;
}
