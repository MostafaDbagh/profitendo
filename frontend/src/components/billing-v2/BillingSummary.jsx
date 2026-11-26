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
  const endsAt = data.paidUntil || data.subscription?.trialEndsAt;
  const labels = {teamPlaces:t('Team seats','أعضاء الفريق'), maxWarehouses:t('Warehouses','المستودعات'), maxShops:t('Stores','المتاجر')};
  return <section aria-label={t('Current subscription','الاشتراك الحالي')} className={plan ? 'grid gap-3 md:grid-cols-2' : ''}>
    <div className="relative flex min-h-48 flex-col justify-center overflow-hidden rounded-2xl bg-[#045756] py-6 ps-5 pe-[32%] text-white sm:ps-7">
      <img src="/billing-storefront.png" alt="" className="pointer-events-none absolute bottom-0 end-0 h-[90%] w-[30%] object-contain object-bottom opacity-80 ltr:-scale-x-100" />
      <div className="relative space-y-3">
        <p className="text-sm font-bold text-amber-200">{t('Your current plan','خطتك الحالية')}</p>
        <h3 className="break-words text-2xl font-bold leading-snug sm:text-3xl">{plan ? planName(plan,lang) : t('Choose your first plan','اختر خطتك الأولى')}</h3>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${data.active?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-900'}`}><ShieldCheck size={17} aria-hidden="true" />{status}</span>
        {plan && endsAt && <p className="flex items-center gap-2 text-sm font-semibold leading-relaxed"><CalendarDays className="shrink-0 text-amber-200" size={19} aria-hidden="true" /><span>{data.paidUntil?t('Paid period ends','نهاية الفترة المدفوعة'):c('trialEnds')} · <time dateTime={endsAt}>{new Date(endsAt).toLocaleDateString(lang==='ar'?'ar':'en',{day:'numeric',month:'long',year:'numeric',timeZone:context.business.timezone})}</time> <bdi>({context.business.timezone})</bdi></span></p>}
        {data.status==='AWAITING_ACTIVATION'&&<p className="text-sm text-white/90">{t('Your payment was received. Super Admin will confirm it and activate your subscription.','تم استلام دفعتك. ستؤكدها إدارة المنصة وتفعّل اشتراكك.')}</p>}
        {data.status==='EXPIRED' && <p className="text-sm text-white/90 max-w-xl">{c('expiredHint')}</p>}
        {!plan && <p className="text-sm text-white/90">{t('Start with a free trial, or explore a paid plan below.','ابدأ بتجربة مجانية، أو استعرض الخطط المدفوعة أدناه.')}</p>}
      </div>
    </div>
    {plan && <div className="flex flex-col justify-center gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-5 sm:px-7">
      <dl className="space-y-4">{usage.map(({key,icon:Icon,used,limit}) => <div key={key} className="grid grid-cols-[1fr_auto] items-center gap-y-2">
        <dt className="flex items-center gap-2 font-bold"><Icon className="h-5 w-5 shrink-0 text-teal-800" aria-hidden="true" />{labels[key]}</dt>
        <dd className="tabular-nums"><strong>{used}</strong> {t('of','من')} {limit}</dd>
        <div aria-hidden="true" className="col-span-2 h-2 overflow-hidden rounded-full bg-gray-200"><div className={`h-full rounded-full ${used>=limit&&used>0?'bg-amber-500':'bg-emerald-600'}`} style={{width:`${limit>0?Math.min(100,used/limit*100):used>0?100:0}%`}} /></div>
      </div>)}</dl>
      <p className="text-xs leading-relaxed text-slate-500">{c('reservedHint')}</p>
    </div>}
  </section>;
}
