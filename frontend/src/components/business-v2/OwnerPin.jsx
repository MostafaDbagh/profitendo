import { useRef, useState } from 'react';
import { LockKeyhole, ShieldCheck, X } from 'lucide-react';
import { Field } from '../auth-v2/Fields';
import OwnerPinField from '../auth-v2/OwnerPinField';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { useResource } from './useBusinessApi';
import { Feedback, buttonClass, panelClass, primaryClass } from './UI';

const copy = {
  en: {
    passwordPlaceholder:'Enter your password to enable or disable PIN', disablePasswordHint:'Enter your current password to disable PIN.',
    pinHint:'Enter 6 digits.', title:'Owner PIN', hint:'Use a 6-digit PIN to protect sensitive sections such as profit, partners, and treasury.',
    on:'Enabled', off:'Disabled', pin:'PIN', password:'Current account password', save:'Save PIN', remove:'Disable PIN',
    saved:'Owner PIN settings saved.',
    enableBrowser:'Enable PIN sign-in on this browser', disableBrowser:'Turn off PIN sign-in on this browser', browserDisabled:'PIN sign-in is off on this browser.',
    remembered:'PIN sign-in is enabled on this browser for 30 days.', trustedOnly:'Saving the PIN enables PIN sign-in on this browser. Only save it on a browser you control.',
    OWNER_PIN_DEVICE_UNAVAILABLE:'PIN sign-in is unavailable for this account.', unlock:'Unlock section', locked:'This section is protected by your owner PIN.',
    unlockHint:'Enter your PIN to unlock sensitive sections for 15 minutes on this session.',
    OWNER_PIN_INCORRECT:'The PIN is incorrect.',
    OWNER_PIN_PASSWORD_INCORRECT:'The account password is incorrect.',
  },
  ar: {
    passwordPlaceholder:'أدخل كلمة المرور لتفعيل الرمز أو إيقافه', disablePasswordHint:'أدخل كلمة مرور حسابك الحالية لإلغاء تفعيل الرمز.',
    pinHint:'أدخل ٦ أرقام.', title:'رمز المالك PIN', hint:'رمز من ٦ أرقام لحماية الأقسام الحساسة مثل الأرباح والشركاء والخزينة.',
    on:'مفعّل', off:'غير مفعّل', pin:'رمز PIN', password:'كلمة مرور الحساب الحالية', save:'حفظ رمز PIN', remove:'إلغاء تفعيل الرمز',
    saved:'تم حفظ إعدادات رمز المالك.',
    enableBrowser:'تفعيل تسجيل الدخول بالرمز في هذا المتصفح', disableBrowser:'إيقاف تسجيل الدخول بالرمز في هذا المتصفح', browserDisabled:'تم إيقاف تسجيل الدخول بالرمز في هذا المتصفح.',
    remembered:'تم تفعيل تسجيل الدخول بالرمز في هذا المتصفح لمدة ٣٠ يومًا.', trustedOnly:'يُفعّل حفظ الرمز تسجيل الدخول به في هذا المتصفح. احفظه فقط في متصفح تستخدمه أنت.',
    OWNER_PIN_DEVICE_UNAVAILABLE:'تسجيل الدخول بالرمز غير متاح لهذا الحساب.', unlock:'فتح القسم', locked:'هذا القسم محمي برمز المالك.',
    unlockHint:'أدخل رمز المالك لفتح الأقسام الحساسة لمدة ١٥ دقيقة في هذه الجلسة.',
    OWNER_PIN_INCORRECT:'رمز PIN غير صحيح.',
    OWNER_PIN_PASSWORD_INCORRECT:'كلمة مرور الحساب غير صحيحة.',
  },
};

const isPin = value => /^[0-9]{6}$/.test(value);

export function OwnerPinSettings({context, api, c, lang, onPinStatus}) {
  const text = copy[lang === 'ar' ? 'ar' : 'en'];
  const t = key => text[key] ?? c(key);
  const enabled = Boolean(context.ownerPin?.enabled);
  const path = `/businesses/${context.business.id}/owner-pin`;
  const device = useResource(api, enabled ? `${path}/device` : null);
  const browserEnabled = device.data?.enabled;

  const [pin,setPin] = useState(''), [password,setPassword] = useState('');
  const passwordInput = useRef(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [saved,setSaved] = useState('');

  async function configure(nextPin) {
    if (busy || !password) return;
    setBusy(true);setError('');setSaved('');
    try {
      const status = await api(path, {
        method:'PUT', body:{pin:nextPin,password},
      });
      onPinStatus(status);
      device.reload();
      setPin('');setPassword('');setSaved(status.browserSignInEnabled ? 'remembered' : 'saved');
    } catch (failure) {setError(failure.message);}
    finally {setBusy(false);}
  }

  async function toggleBrowserSignIn() {
    if (busy || browserEnabled === undefined) return;
    if (!browserEnabled && !password) {
      passwordInput.current?.querySelector('input')?.focus();
      return;
    }
    setBusy(true);setError('');setSaved('');
    try {
      await api(`${path}/device`, browserEnabled ? {method:'DELETE',body:{}} : {method:'POST',body:{password}});
      device.reload();
      setPassword('');setSaved(browserEnabled ? 'browserDisabled' : 'remembered');
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
    <Feedback error={error||device.error} c={t} retry={device.error ? device.reload : undefined} />
    {saved && <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 py-2 ps-3 pe-2 text-sm text-emerald-800">
      <p role="status">{text[saved]}</p>
      <button type="button" aria-label={lang==='ar'?'إغلاق الإشعار':'Dismiss notification'} onClick={()=>setSaved('')}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>}
    <form className="space-y-4" onSubmit={event=>{event.preventDefault(); if(isPin(pin)) configure(pin);}}>
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
        <OwnerPinField id="owner-pin-setting" label={text.pin} hint={text.pinHint} value={pin} onChange={setPin} disabled={busy} />
        <div ref={passwordInput}><Field id="owner-pin-password" label={text.password} placeholder={text.passwordPlaceholder} type="password" autoComplete="current-password" maxLength={128}
          value={password} onChange={event=>setPassword(event.target.value)} required /></div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryClass} disabled={busy||!isPin(pin)||!password}>{busy?c('saving'):text.save}</button>
        {enabled && <>
          <button type="button" className={buttonClass} disabled={busy||browserEnabled===undefined} onClick={toggleBrowserSignIn}>
            {browserEnabled===undefined?c('loading'):text[browserEnabled?'disableBrowser':'enableBrowser']}
          </button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className={`${buttonClass} aria-disabled:opacity-50`} disabled={busy} aria-disabled={!password}
                  onClick={()=>password ? configure(null) : passwordInput.current?.querySelector('input')?.focus()}>{text.remove}</button>
              </TooltipTrigger>
              {!password&&<TooltipContent className="max-w-[calc(100vw-2rem)] text-start">{text.disablePasswordHint}</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
        </>}
      </div>
      <p className="text-sm text-slate-600">{text.trustedOnly}</p>
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
    <form onSubmit={unlock}>
      <OwnerPinField id="owner-pin-unlock" label={text.pin} hint={text.pinHint} value={pin} onChange={setPin} disabled={busy}>
        <button type="submit" className={`${primaryClass} h-11 shrink-0`} disabled={busy||!isPin(pin)}>{text.unlock}</button>
      </OwnerPinField>
    </form>
  </section>;
}
