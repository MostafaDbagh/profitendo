import { useState } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { Field } from '../auth-v2/Fields';
import { Feedback, buttonClass, panelClass, primaryClass } from './UI';

const copy = {
  en: {
    title:'Owner PIN', hint:'Use a 4–8 digit PIN to protect sensitive sections such as profit, partners, and treasury.',
    on:'Enabled', off:'Disabled', pin:'PIN', password:'Current account password', save:'Save PIN', remove:'Disable PIN',
    mfa:'Manage two-factor authentication', saved:'Owner PIN settings saved.', unlock:'Unlock section', locked:'This section is protected by your owner PIN.',
    unlockHint:'Enter your PIN to unlock sensitive sections for 15 minutes on this session.',
    OWNER_PIN_INCORRECT:'The PIN is incorrect.',
    OWNER_PIN_PASSWORD_INCORRECT:'The account password is incorrect.',
  },
  ar: {
    title:'رمز المالك PIN', hint:'رمز من ٤ إلى ٨ أرقام لحماية الأقسام الحساسة مثل الأرباح والشركاء والخزينة.',
    on:'مفعّل', off:'غير مفعّل', pin:'رمز PIN', password:'كلمة مرور الحساب الحالية', save:'حفظ رمز PIN', remove:'إلغاء تفعيل الرمز',
    mfa:'إدارة المصادقة الثنائية', saved:'تم حفظ إعدادات رمز المالك.', unlock:'فتح القسم', locked:'هذا القسم محمي برمز المالك.',
    unlockHint:'أدخل رمز المالك لفتح الأقسام الحساسة لمدة ١٥ دقيقة في هذه الجلسة.',
    OWNER_PIN_INCORRECT:'رمز PIN غير صحيح.',
    OWNER_PIN_PASSWORD_INCORRECT:'كلمة مرور الحساب غير صحيحة.',
  },
};

const pinPattern = '[0-9]{4,8}';
const isPin = value => /^[0-9]{4,8}$/.test(value);

export function OwnerPinSettings({context, api, c, lang, onPinStatus, onSection}) {
  const text = copy[lang === 'ar' ? 'ar' : 'en'];
  const t = key => text[key] ?? c(key);
  const enabled = Boolean(context.ownerPin?.enabled);
  const [pin,setPin] = useState(''), [password,setPassword] = useState('');
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [saved,setSaved] = useState(false);

  async function configure(nextPin) {
    if (busy || !password) return;
    setBusy(true);setError('');setSaved(false);
    try {
      onPinStatus(await api(`/businesses/${context.business.id}/owner-pin`, {
        method:'PUT', body:{pin:nextPin,password},
      }));
      setPin('');setPassword('');setSaved(true);
    } catch (failure) {setError(failure.message);}
    finally {setBusy(false);}
  }

  return <section className={`${panelClass} max-w-3xl space-y-4`} aria-labelledby="owner-pin-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="owner-pin-title" className="flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" />{text.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{text.hint}</p>
      </div>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${enabled?'bg-emerald-50 text-emerald-800':'bg-slate-100 text-slate-600'}`}>{text[enabled?'on':'off']}</span>
    </div>
    <Feedback error={error} c={t} />
    {saved && <p role="status" className="text-sm text-emerald-700">{text.saved}</p>}
    <form className="space-y-4" onSubmit={event=>{event.preventDefault(); if(isPin(pin)) configure(pin);}}>
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
        <Field id="owner-pin-setting" label={text.pin} type="password" dir="ltr" inputMode="numeric" autoComplete="new-password"
          pattern={pinPattern} maxLength={8} value={pin} onChange={event=>setPin(event.target.value)} required />
        <Field id="owner-pin-password" label={text.password} type="password" autoComplete="current-password" maxLength={128}
          value={password} onChange={event=>setPassword(event.target.value)} required />
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryClass} disabled={busy||!isPin(pin)||!password}>{busy?c('saving'):text.save}</button>
        <button type="button" className={buttonClass} onClick={()=>onSection('security')}>{text.mfa}</button>
        {enabled && <button type="button" className={buttonClass} disabled={busy||!password} onClick={()=>configure(null)}>{text.remove}</button>}
      </div>
    </form>
  </section>;
}

export function OwnerPinUnlock({context,api,c,lang,onPinStatus}) {
  const text = copy[lang === 'ar' ? 'ar' : 'en'];
  const [pin,setPin] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState('');
  async function unlock(event) {
    event.preventDefault();
    if (busy || !isPin(pin)) return;
    setBusy(true);setError('');
    try {
      onPinStatus(await api(`/businesses/${context.business.id}/owner-pin/unlock`, {method:'POST',body:{pin}}));
    } catch (failure) {setError(failure.message);setPin('');}
    finally {setBusy(false);}
  }

  return <section className={`${panelClass} max-w-xl space-y-4`}>
    <h2 className="flex items-center gap-2 font-bold"><LockKeyhole className="h-5 w-5 text-emerald-700" aria-hidden="true" />{text.locked}</h2>
    <p className="text-sm text-slate-600">{text.unlockHint}</p>
    <Feedback error={error} c={key=>text[key]??c(key)} />
    <form onSubmit={unlock} className="flex flex-wrap items-end gap-3">
      <Field id="owner-pin-unlock" label={text.pin} type="password" dir="ltr" inputMode="numeric" autoComplete="off"
        pattern={pinPattern} maxLength={8} value={pin} onChange={event=>setPin(event.target.value)} required disabled={busy} />
      <button type="submit" className={primaryClass} disabled={busy||!isPin(pin)}>{text.unlock}</button>
    </form>
  </section>;
}
