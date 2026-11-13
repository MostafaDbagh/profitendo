import {useEffect, useState} from 'react';
import {primaryClass} from './UI';

// Keep an open workspace aware of expiry and externally confirmed renewals.
// This is explanatory UI only; the server checks entitlement on every write.
export default function SubscriptionNotice({context, api, lang, section, onSection}) {
  const [access, setAccess] = useState(context.subscriptionAccess);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setAccess(context.subscriptionAccess);
  }, [context.subscriptionAccess]);
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const updated = await api(`/businesses/${context.business.id}`, {signal:controller.signal});
        if (!controller.signal.aborted) { setAccess(updated.subscriptionAccess); setNow(Date.now()); }
      } catch { /* Preserve the last known state; page requests expose connection errors. */ }
    }
    refresh();
    const interval = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {controller.abort(); clearInterval(interval); window.removeEventListener('focus', refresh);};
  }, [api, context.business.id, section]);
  useEffect(() => {
    if (!access?.active || !access.endsAt || new Date(access.endsAt).getTime() <= now) return;
    const remaining = new Date(access.endsAt).getTime() - Date.now();
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(remaining + 25, 2147483647)));
    return () => clearTimeout(timer);
  }, [access, now]);
  const ended = access?.status === 'EXPIRED' || (access?.active && access.endsAt && new Date(access.endsAt).getTime() <= now);
  if (!ended && access?.status !== 'REVIEW') return null;
  const ar = lang === 'ar', owner = context.permissions['billing.manage'];
  return <aside data-testid="subscription-notice" aria-live="polite" className="rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4">
    <div className="flex-1 min-w-0">
      <h2 className="font-semibold text-amber-950">{access.status === 'REVIEW' ? (ar ? 'الدفع قيد المراجعة' : 'Payment under review') : access.paid ? (ar ? 'انتهت فترة اشتراكك' : 'Your subscription period has ended') : (ar ? 'انتهت تجربتك المجانية' : 'Your free trial has ended')}</h2>
      <p className="mt-2 text-sm leading-relaxed text-amber-900">{ar ? 'يمكنك الاستمرار في الوصول إلى لوحة التحكم والاطلاع على بياناتك الحالية. تتطلب العمليات المدفوعة اشتراكاً نشطاً.' : 'You can still access your dashboard and view your existing data. Paid operations require an active subscription.'} {!owner && (ar ? 'تواصل مع مالك النشاط لتجديد الاشتراك.' : 'Contact your business owner to renew.')}</p>
    </div>
    {owner && section !== 'billing' && <button type="button" className={`${primaryClass} shrink-0`} onClick={() => onSection('billing')}>{ar ? 'إدارة الاشتراك' : 'Manage subscription'}</button>}
  </aside>;
}
