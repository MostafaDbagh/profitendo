import PaidAccess from './PaidAccess';
import { useRef, useState } from 'react';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Modal, primaryClass, buttonClass, panelClass } from '../business-v2/UI';
import Receipts from './Receipts';
import Cancellation from './Cancellation';
import { billingCopy, planName } from './copy';
export default function Subscription({ context, api, lang }) {
  const c = key => billingCopy[lang]?.[key] || billingCopy.en[key] || billingCopy[lang].failed;
  const path = `/billing/businesses/${context.business.id}`, { data, error, reload } = useResource(api,path);
  const [selected,setSelected] = useState(null), [busy,setBusy] = useState(false), [failure,setFailure] = useState(''), [notice,setNotice] = useState('');
  const trigger = useRef(null);
  async function start() { setBusy(true); setFailure(''); try { await api(`${path}/trial`,{method:'POST',body:{planId:selected.id}}); setSelected(null); setNotice('started'); reload(); } catch(e) { setFailure(e.message); } finally { setBusy(false); } }
  return <section className="space-y-5"><h2 className="text-lg font-bold">{c('billing')}</h2><Feedback error={error} notice={notice} c={c} retry={reload} />{!data && !error && <p role="status">{c('loading')}</p>}{data && <>
    <div className={`${panelClass} space-y-4`}><p className={`text-sm font-semibold ${data.active ? 'text-emerald-700' : 'text-slate-600'}`}>{({ACTIVE:lang==='ar'?'اشتراك مدفوع نشط':'Paid subscription active',CANCELLED_PAID:lang==='ar'?'ملغى — متاح حتى نهاية الفترة':'Cancelled · access until period end',REVIEW:lang==='ar'?'الدفع قيد المراجعة':'Payment under review'})[data.status]||c(data.status)}</p><p className="text-sm text-slate-500">{!data.checkoutAvailable&&!data.paidUntil&&c('paidUnavailable')}</p>{data.status === 'EXPIRED' && <p className="text-sm text-slate-600">{c('expiredHint')}</p>}
      {data.subscription && <><h3 className="font-bold">{planName(data.subscription.plan,lang)}</h3><p className="text-sm text-slate-600">{data.paidUntil?(lang==='ar'?'متاح حتى':'Access until'):c('trialEnds')}: {new Date(data.paidUntil||data.subscription.trialEndsAt).toLocaleString(lang === 'ar' ? 'ar' : 'en',{timeZone:context.business.timezone})}</p><dl className="grid sm:grid-cols-3 gap-4"><div><dt className="text-sm text-slate-500">{c('teamPlaces')}</dt><dd className="font-semibold mt-1"><span dir="ltr">{data.usage.reservedMembers} / {data.subscription.plan.maxMembers}</span></dd></div>{['maxWarehouses','maxShops'].map(k=><div key={k}><dt className="text-sm text-slate-500">{c(k)}</dt><dd className="font-semibold mt-1"><span dir="ltr">{data.locationUsage?.[k] ?? 0} / {data.subscription.plan[k]}</span></dd></div>)}</dl><p className="text-xs text-slate-500">{c('reservedHint')}</p></>}
    </div>
    {data.status === 'NOT_STARTED' && !data.plans.some(p=>p.trialDays>0&&p.priceMinor===null) && <p className="text-sm text-slate-500">{c('PLAN_UNAVAILABLE')}</p>}
    {data.status === 'NOT_STARTED' && <div className="grid lg:grid-cols-2 gap-4">{data.plans.filter(p=>p.trialDays>0&&p.priceMinor===null).map(p=><div key={p.id} className={`${panelClass} space-y-4`}><h3 className="font-bold">{planName(p,lang)}</h3><dl className="space-y-2 text-sm">{['trialDays','maxMembers','maxWarehouses','maxShops'].map(k=><div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{c(k)}</dt><dd className="font-semibold">{p[k]}</dd></div>)}</dl><button className={primaryClass} onClick={e=>{trigger.current=e.currentTarget;setFailure('');setSelected(p);}}>{c('startTrial')}</button></div>)}</div>}
    <PaidAccess businessId={context.business.id} {...{api,lang}}/>
    <Cancellation businessId={context.business.id} {...{api,c,lang}} />
    <Receipts businessId={context.business.id} timezone={context.business.timezone} {...{api,c,lang}} />
  </>}{selected && <Modal title={c('startTrial')} description={c('trialHint')} {...{c,lang,busy}} returnFocus={trigger.current} close={()=>setSelected(null)}><p className="font-semibold">{planName(selected,lang)} · {selected.trialDays} {c('trialDays')}</p><Feedback error={failure} c={c}/><div className="flex flex-wrap justify-end gap-2"><button className={buttonClass} disabled={busy} onClick={()=>setSelected(null)}>{c('cancel')}</button><button className={primaryClass} disabled={busy} onClick={start}>{c(busy?'saving':'startTrial')}</button></div></Modal>}</section>;
}
