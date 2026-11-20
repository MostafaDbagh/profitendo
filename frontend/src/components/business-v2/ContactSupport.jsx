import { Mail, MessageCircle, Phone } from 'lucide-react';
import ServiceRequests from './ServiceRequests';
import { panelClass } from './UI';

export default function ContactSupport({context, api, c, lang}) {
  const ar=lang==='ar';
  const channels=[
    {Icon:Phone,label:ar?'الهاتف':'Phone',value:'+1 202 555 0141'},
    {Icon:MessageCircle,label:ar?'واتساب':'WhatsApp',value:'+1 202 555 0142'},
    {Icon:Mail,label:ar?'البريد الإلكتروني':'Email',value:'support@profitlens.example'},
  ];

  return <div className="max-w-3xl space-y-5">
    <h2 className="text-xl font-bold">{c('contactSupport')}</h2>
    <section className={`${panelClass} space-y-3`} aria-labelledby="support-channels">
      <div>
        <h3 id="support-channels" className="font-semibold">{ar?'طرق التواصل':'Contact channels'}</h3>
        <p className="mt-1 text-sm text-slate-600">
          {ar?'بيانات التواصل أدناه تجريبية. للتواصل مع الدعم، أرسل طلبًا من النموذج أدناه.':'The contact details below are examples. Use the request form below to contact support.'}
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        {channels.map(({Icon,label,value})=><div key={label} className="min-w-0 rounded-lg border border-slate-200 px-3 py-3">
          <dt className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true"/>{label}
          </dt>
          <dd className="mt-1 break-words text-sm text-slate-600"><bdi dir="ltr">{value}</bdi></dd>
        </div>)}
      </dl>
    </section>
    <ServiceRequests {...{context,api,lang}}/>
  </div>;
}
