import { CalendarDays, ShieldCheck, Store, Users, Warehouse } from 'lucide-react';
import { planName } from './copy';

export default function BillingSummary({ data, context, c, lang }) {
  const t = (en, ar) => lang === 'ar' ? ar : en;
  const plan = data.subscription?.plan;
  const status = data.status==='EXPIRED' && data.paidUntil ? t('Subscription expired','انتهى الاشتراك') : ({ ACTIVE:t('Paid subscription active','اشتراك مدفوع نشط'), CANCELLED_PAID:t('Cancelled · access until period end','ملغى — متاح حتى نهاية الفترة'), REVIEW:t('Payment under review','الدفع قيد المراجعة') })[data.status] || c(data.status);
  const usage = plan ? [
    { key:'teamPlaces', icon:Users, used:data.usage.reservedMembers, limit:plan.maxMembers },
    { key:'maxWarehouses', icon:Warehouse, used:data.locationUsage?.maxWarehouses ?? 0, limit:plan.maxWarehouses },
    { key:'maxShops', icon:Store, used:data.locationUsage?.maxShops ?? 0, limit:plan.maxShops },
  ] : [];
  return <section aria-label={t('Current subscription','الاشتراك الحالي')} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="h-1 bg-emerald-500" />
    <div className="p-5 md:p-6 flex flex-col sm:flex-row sm:items-start justify-between gap-5">
      <div className="space-y-3 min-w-0">
        <p className="text-xs font-semibold text-slate-500">{t('YOUR CURRENT PLAN','خطتك الحالية')}</p>
        <h3 className="text-2xl font-bold text-slate-900 break-words">{plan ? planName(plan,lang) : t('Choose your first plan','اختر خطتك الأولى')}</h3>
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${data.active?'border-emerald-200 bg-emerald-50 text-emerald-700':'border-amber-200 bg-amber-50 text-amber-800'}`}><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />{status}</span>
        {data.status==='EXPIRED' && <p className="text-sm text-slate-500 max-w-xl">{c('expiredHint')}</p>}
        {!plan && <p className="text-sm text-slate-500">{t('Start with a free trial, or explore a paid plan below.','ابدأ بتجربة مجانية، أو استعرض الخطط المدفوعة أدناه.')}</p>}
      </div>
      {plan && <div className="rounded-lg bg-slate-50 border border-slate-100 p-4 sm:min-w-56 space-y-2">
        <p className="flex items-center gap-2 text-xs text-slate-500"><CalendarDays className="w-4 h-4" aria-hidden="true" />{data.paidUntil?t('Access until','متاح حتى'):c('trialEnds')}</p>
        <p className="text-sm font-semibold text-slate-800">{new Date(data.paidUntil || data.subscription.trialEndsAt).toLocaleDateString(lang==='ar'?'ar':'en',{day:'numeric',month:'long',year:'numeric',timeZone:context.business.timezone})}</p>
        <p className="text-xs text-slate-500">{context.business.timezone}</p>
      </div>}
    </div>
    {plan && <div className="border-t border-slate-100 p-5 md:p-6 space-y-4">
      <dl className="grid sm:grid-cols-3 gap-5 sm:gap-6">{usage.map(({key,icon:Icon,used,limit}) => <div key={key} className="min-w-0">
        <dt className="flex items-center gap-2 text-sm text-slate-500"><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{c(key)}</dt>
        <dd className="mt-2"><span className="text-2xl font-semibold tabular text-slate-900" dir="ltr">{used} <span className="text-sm font-normal text-slate-400">/ {limit}</span></span>
          <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${used>=limit&&used>0?'bg-amber-500':'bg-emerald-500'}`} style={{width:`${limit>0?Math.min(100,used/limit*100):used>0?100:0}%`}} /></div>
        </dd>
      </div>)}</dl>
      <p className="text-xs text-slate-500">{c('reservedHint')}</p>
    </div>}
  </section>;
}
