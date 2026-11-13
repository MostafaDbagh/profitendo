import {useEffect,useState} from 'react';
import {useResource} from '../business-v2/useBusinessApi';
import {buttonClass,primaryClass,panelClass} from '../business-v2/UI';
import {Switch} from '../ui/switch';
export default function OnboardingPolicy({api,lang}){
 const ar=lang==='ar',{data,error,reload}=useResource(api,'/platform/onboarding-policy');
 const [draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[saved,setSaved]=useState(false);
 useEffect(()=>{setDraft(data);setSaved(false);},[data]);
 const rows=[['emailRequired',ar?'طلب تأكيد البريد الإلكتروني':'Require email verification'],['ownerPhoneRequired',ar?'طلب تأكيد هاتف صاحب النشاط':'Require owner phone verification'],['welcomeEnabled',ar?'إرسال رسالة ترحيب بالبريد الإلكتروني':'Send a welcome email']];
 async function save(){setBusy(true);setFailure('');setSaved(false);try{setDraft(await api('/platform/onboarding-policy',{method:'PATCH',body:draft}));setSaved(true);}catch(e){setFailure(e.message);}finally{setBusy(false);}}
 return <section className={`${panelClass} max-w-2xl`}><h2 className="text-xl font-bold">{ar?'إعدادات التسجيل':'Registration settings'}</h2>
 <p className="mt-2 text-sm text-slate-500">{ar?'تحكّم في التحقق ورسائل الترحيب. تفعيل التحقق يشمل الحسابات الحالية غير المؤكدة أيضًا. المصادقة بتطبيق Authenticator تبقى اختيارية.':'Control verification and welcome emails. Enabling verification also applies to existing unverified accounts. Authenticator MFA remains optional.'}</p>
 <p className="mt-2 text-sm text-slate-500">{ar?'جهّز خدمة البريد والرسائل النصية قبل تفعيلها. تُرسل رسالة الترحيب بعد تأكيد البريد واستكمال التحقق المطلوب.':'Configure email and SMS delivery before enabling them. Welcome emails are sent after email verification and any required phone verification.'}</p>
 {(error||failure)&&<div role="alert" className="my-4 text-red-700">{(error||failure)==='REVISION_CONFLICT'?(ar?'تغيّرت الإعدادات. أعد التحميل قبل الحفظ.':'Settings changed. Reload before saving.'):(ar?'تعذّر حفظ أو تحميل الإعدادات. حاول مجددًا.':'Could not save or load settings. Try again.')} <button className={buttonClass} onClick={reload}>{ar?'إعادة التحميل':'Reload'}</button></div>}
 {!draft&&!error&&<p role="status">{ar?'جارٍ التحميل…':'Loading…'}</p>}
 {draft&&<form onSubmit={e=>{e.preventDefault();save();}}><div className="my-6 divide-y divide-slate-100">{rows.map(([key,label])=><div key={key} className="flex items-center justify-between gap-4 py-4"><label htmlFor={`policy-${key}`} className="text-sm font-medium">{label}</label><span dir="ltr"><Switch id={`policy-${key}`} checked={draft[key]} disabled={busy} onCheckedChange={value=>{setDraft({...draft,[key]:value});setSaved(false);}}/></span></div>)}</div><button className={primaryClass} disabled={busy} type="submit">{busy?(ar?'جارٍ الحفظ…':'Saving…'):(ar?'حفظ الإعدادات':'Save settings')}</button>{saved&&<p role="status" className="mt-3 text-sm text-emerald-700">{ar?'تم حفظ الإعدادات.':'Settings saved.'}</p>}</form>}
 </section>;
}
