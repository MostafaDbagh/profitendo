import BillingSummary from './BillingSummary';
import { Link } from 'react-router-dom';
import PaidAccess from './PaidAccess';
import { useEffect, useRef, useState } from 'react';
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
  const refreshStatus = useRef(reload);
  refreshStatus.current = reload;
  useEffect(() => {
    const refresh = () => refreshStatus.current();
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 60000);
    return () => { window.removeEventListener('focus', refresh); clearInterval(timer); };
  }, []);
  async function start() { setBusy(true); setFailure(''); try { await api(`${path}/trial`,{method:'POST',body:{planId:selected.id}}); setSelected(null); setNotice('started'); reload(); } catch(e) { setFailure(e.message); } finally { setBusy(false); } }
  return <section className="space-y-7"><div className="space-y-2"><h2 className="text-2xl font-bold text-slate-900">{c('billing')}</h2><p className="text-sm text-slate-500">{lang==='ar'?'خطتك، حدود الاستخدام، وسجل المدفوعات في مكان واحد.':'Your plan, usage limits, and payment history in one place.'}</p></div><Feedback error={error} notice={notice} c={c} retry={error==='BILLING_MFA_SETUP_REQUIRED'?undefined:reload} />{error==='BILLING_MFA_SETUP_REQUIRED'&&<Link className={primaryClass} to="?tab=security">{c('security')}</Link>}{!data && !error && <p role="status">{c('loading')}</p>}{data && <>
    <BillingSummary {...{data,context,c,lang}} />
    {data.status === 'NOT_STARTED' && !data.plans.some(p=>p.trialDays>0&&p.priceMinor===null) && <p className="text-sm text-slate-500">{c('PLAN_UNAVAILABLE')}</p>}
    {data.status === 'NOT_STARTED' && <div className="grid lg:grid-cols-2 gap-4">{data.plans.filter(p=>p.trialDays>0&&p.priceMinor===null).map(p=><div key={p.id} className={`${panelClass} space-y-4`}><h3 className="font-bold">{planName(p,lang)}</h3><dl className="space-y-2 text-sm">{['trialDays','maxMembers','maxWarehouses','maxShops'].map(k=><div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{c(k)}</dt><dd className="font-semibold">{p[k]}</dd></div>)}</dl><button className={primaryClass} onClick={e=>{trigger.current=e.currentTarget;setFailure('');setSelected(p);}}>{c('startTrial')}</button></div>)}</div>}
    <PaidAccess businessId={context.business.id} {...{api,lang}}/>
    <div className="grid xl:grid-cols-3 gap-6 items-start">
      <div className="xl:col-span-2 min-w-0"><Receipts businessId={context.business.id} timezone={context.business.timezone} {...{api,c,lang}} /></div>
      <Cancellation businessId={context.business.id} {...{api,c,lang}} />
    </div>
  </>}{selected && <Modal title={c('startTrial')} description={c('trialHint')} {...{c,lang,busy}} returnFocus={trigger.current} close={()=>setSelected(null)}><p className="font-semibold">{planName(selected,lang)} · {selected.trialDays} {c('trialDays')}</p><Feedback error={failure} c={c}/><div className="flex flex-wrap justify-end gap-2 rtl:flex-row-reverse"><button className={buttonClass} disabled={busy} onClick={()=>setSelected(null)}>{c('cancel')}</button><button className={primaryClass} disabled={busy} onClick={start}>{c(busy?'saving':'startTrial')}</button></div></Modal>}</section>;
}
