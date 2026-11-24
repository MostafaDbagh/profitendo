import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import { Mail, MessageCircle, Phone } from 'lucide-react';
import ServiceRequests from './ServiceRequests';
import { Feedback, panelClass } from './UI';
import { useResource } from './useBusinessApi';

export default function ContactSupport({context, api, c, lang}) {
  const ar=lang==='ar';
  const {data,error,reload}=useResource(api,'/support/contacts');
  const channels=[
    {Icon:Phone,label:ar?'الهاتف':'Phone',value:data?.phone,href:`tel:${data?.phone}`},
    {Icon:MessageCircle,label:ar?'واتساب':'WhatsApp',value:data?.whatsapp,href:`https://wa.me/${data?.whatsapp?.slice(1)}`},
    {Icon:Mail,label:ar?'البريد الإلكتروني':'Email',value:data?.email,href:`mailto:${data?.email}`},
  ].filter(channel=>channel.value);

  return <PageLayout as="div" className="max-w-3xl">
    <PageHeader title={c('contactSupport')}/>
    <section className={`${panelClass} space-y-3`} aria-labelledby="support-channels">
      <div>
        <h3 id="support-channels" className="font-semibold">{ar?'طرق التواصل':'Contact channels'}</h3>
      </div>
      <Feedback {...{c,error}} retry={reload}/>
      {!data&&!error&&<LoadingState>{c('loading')}</LoadingState>}
      {data&&!channels.length&&<p className="text-sm text-slate-600">
        {ar?'يمكنك التواصل مع الدعم من خلال نموذج الطلب أدناه.':'Use the request form below to contact support.'}
      </p>}
      {channels.length>0&&<dl className="grid gap-3 sm:grid-cols-3">
        {channels.map(({Icon,label,value,href})=><div key={label} className="min-w-0 rounded-lg border border-slate-200 px-3 py-3">
          <dt className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true"/>{label}
          </dt>
          <dd className="mt-1 break-words text-sm text-slate-600"><a href={href} className="text-emerald-700 underline-offset-4 hover:underline focus-visible:underline"><bdi dir="ltr">{value}</bdi></a></dd>
        </div>)}
      </dl>}
    </section>
    <ServiceRequests {...{context,api,lang}}/>
  </PageLayout>;
}
