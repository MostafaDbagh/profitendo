import {useState} from 'react';
import {Lightbulb,Send} from 'lucide-react';
import {Field,inputClass} from '../auth-v2/Fields';
import {Feedback,panelClass,primaryClass} from './UI';
import Select from './SettingsSelect';
import SupportInbox from '../support-v2/Support';
import {translator} from '../support-v2/copy';

export default function ServiceRequests({context,api,lang}){
 const ar=lang==='ar',c=translator(lang);
 const [category,setCategory]=useState('FEATURE'),[subject,setSubject]=useState(''),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false),[version,setVersion]=useState(0);
 async function submit(event){
  event.preventDefault();if(busy)return;setBusy(true);setError('');setSent(false);
  try{await api('/support/tickets',{method:'POST',body:{businessId:context.business.id,category,subject:subject.trim(),body:body.trim()}});setSubject('');setBody('');setSent(true);setVersion(v=>v+1);}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <section className="space-y-5 max-w-3xl" aria-labelledby="service-request-heading">
  <form className={`${panelClass} space-y-5`} onSubmit={submit}>
   <div className="flex items-start gap-3"><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Lightbulb className="h-5 w-5" aria-hidden="true"/></span><div><h2 id="service-request-heading" className="text-lg font-bold text-slate-900">{ar?'طلب خدمة أو ميزة جديدة':'Request a service or feature'}</h2><p className="mt-1 text-sm text-slate-500">{ar?'أخبرنا بما يساعد نشاطك. سيصل طلبك إلى إدارة المنصة، ويمكنك متابعة الرد هنا.':'Tell us what would help your business. Your request goes to the platform team, and you can follow replies here.'}</p></div></div>
   <Feedback error={error} c={c}/>
   {sent&&<p role="status" className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">{ar?'تم إرسال طلبك. يمكنك متابعته ضمن طلباتك أدناه.':'Request sent. You can follow it in your requests below.'}</p>}
   <fieldset disabled={busy} className="space-y-4">
    <Select id="service-request-type" label={ar?'نوع الطلب':'Request type'} value={category} onChange={e=>setCategory(e.target.value)} disabled={busy}><option value="SERVICE">{c('SERVICE')}</option><option value="FEATURE">{c('FEATURE')}</option></Select>
    <Field id="service-request-subject" label={ar?'عنوان الطلب':'Request title'} placeholder={ar?'مثال: إضافة تقرير أرباح شهري':'e.g. Add a monthly profit report'} value={subject} onChange={e=>setSubject(e.target.value)} required minLength={3} maxLength={160}/>
    <div><label htmlFor="service-request-description" className="block text-sm font-medium text-slate-700 mb-1.5">{ar?'التفاصيل وكيف سيساعدك الطلب':'Details and how this would help'}</label><textarea id="service-request-description" className={`${inputClass} min-h-36 resize-y`} rows={5} required minLength={2} maxLength={5000} value={body} onChange={e=>setBody(e.target.value)} placeholder={ar?'اشرح الخدمة أو الميزة المطلوبة والمشكلة التي تريد حلها…':'Describe the service or feature you need and the problem it would solve…'}/></div>
   </fieldset>
   <button type="submit" className={primaryClass} disabled={busy||subject.trim().length<3||body.trim().length<2}><Send className="h-4 w-4" aria-hidden="true"/>{busy?(ar?'جارٍ الإرسال…':'Sending…'):(ar?'إرسال الطلب':'Send request')}</button>
  </form>
  <SupportInbox key={`${context.business.id}:${version}`} {...{api,lang}} businessId={context.business.id} requestOnly heading={ar?'طلباتي للخدمات والميزات':'My service and feature requests'}/>
 </section>;
}
