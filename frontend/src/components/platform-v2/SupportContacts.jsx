import {PageHeader} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import { useEffect, useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { Feedback, panelClass, primaryClass } from '../business-v2/UI';
import { useResource } from '../business-v2/useBusinessApi';

export default function SupportContacts({api,c,lang}) {
  const ar=lang==='ar';
  const path='/platform/support-contacts';
  const {data,error,reload}=useResource(api,path);
  const [form,setForm]=useState(null);
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[saved,setSaved]=useState(false);
  useEffect(()=>{if(data){setForm(data);setSaved(false);}},[data]);

  async function save(event) {
    event.preventDefault();
    if(busy)return;
    setBusy(true);setFailure('');setSaved(false);
    try {
      setForm(await api(path,{method:'PATCH',body:form}));
      setSaved(true);
    } catch(e){setFailure(e.message);}
    finally{setBusy(false);}
  }

  return <section className={`${panelClass} max-w-3xl space-y-4`} aria-labelledby="admin-support-contacts">
    <PageHeader title={ar?'بيانات التواصل مع الدعم':'Support contact settings'} titleId="admin-support-contacts"/>
    <p className="text-sm text-slate-600">{ar
      ? 'تظهر هذه البيانات في تبويب التواصل والدعم لجميع الأنشطة. أدخل أرقام الهاتف بصيغة دولية. اترك أي حقل فارغًا لإخفائه.'
      : 'These details appear in Contact & Support for all businesses. Use international phone numbers. Leave a field blank to hide it.'}</p>
    <Feedback error={failure||error} c={key=>key==='REVISION_CONFLICT'
      ? (ar?'تغيّرت الإعدادات. أعد التحميل قبل الحفظ.':'Settings changed. Reload before saving.')
      : key==='VALIDATION_ERROR'
        ? (ar?'تحقق من صيغة أرقام الهاتف والبريد الإلكتروني.':'Check the phone number and email formats.')
        : c(key)} retry={(error||failure==='REVISION_CONFLICT')?()=>{setFailure('');reload();}:undefined}/>
    {saved&&<p role="status" className="text-sm text-emerald-700">{ar?'تم حفظ بيانات التواصل.':'Contact settings saved.'}</p>}
    {!form&&!error&&<LoadingState>{c('loading')}</LoadingState>}
    {form&&<form className="space-y-4" onSubmit={save}>
      <fieldset disabled={busy||Boolean(error)||failure==='REVISION_CONFLICT'} className="grid gap-4 sm:grid-cols-2">
        {[
          ['phone',ar?'الهاتف':'Phone','tel','+1 202 555 0141'],
          ['whatsapp',ar?'واتساب':'WhatsApp','tel','+1 202 555 0142'],
          ['email',ar?'البريد الإلكتروني':'Email','email','support@profitlens.example'],
        ].map(([key,label,type,placeholder])=><Field key={key} id={`support-contact-${key}`} {...{label,placeholder}} type={type==='tel'?'text':type} inputMode={type==='tel'?'tel':undefined}
          dir="ltr" maxLength={type==='tel'?32:254} value={form[key]}
          onChange={event=>{setSaved(false);setForm({...form,[key]:event.target.value});}}/>)}
      </fieldset>
      <button type="submit" className={primaryClass} disabled={busy||Boolean(error)||failure==='REVISION_CONFLICT'}>
        {busy?(ar?'جارٍ الحفظ…':'Saving…'):(ar?'حفظ بيانات التواصل':'Save contact details')}
      </button>
    </form>}
  </section>;
}
