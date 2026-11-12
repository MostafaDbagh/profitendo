import {useState} from 'react';
import {Field} from '../auth-v2/Fields';
import {Feedback,panelClass,buttonClass,primaryClass} from './UI';
export default function MfaSettings({api,lang,c,account,onChanged}) {
 const ar=lang==='ar', [mode,setMode]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState(''),[setup,setSetup]=useState(null),[recovery,setRecovery]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const clear=()=>{setMode('');setPassword('');setCode('');setSetup(null);setError('');};
 async function submit(e){e.preventDefault();setBusy(true);setError('');try{
  if(mode==='disable'){await api('/auth/mfa/disable',{method:'POST',body:{password,code}});clear();onChanged();}
  else if(!setup){setSetup(await api('/auth/mfa/setup',{method:'POST',body:{password}}));setPassword('');}
  else {const result=await api('/auth/mfa/confirm',{method:'POST',body:{code}});setRecovery(result.recoveryCodes);clear();onChanged();}
 }catch(e){setError(e.message);}finally{setBusy(false);}}
 if(!account)return null;
 return <section className={`${panelClass} space-y-4 max-w-2xl`} data-testid="mfa-settings">
  <h3 className="font-bold">{ar?'التحقق بخطوتين (MFA)':'Two-step verification (MFA)'}</h3>
  <p>{account.mfaEnabled?(ar?'مفعّل':'Enabled'):(ar?'غير مفعّل':'Disabled')}</p>
  <p className="text-sm text-slate-500">{account.mfaMandatory?(ar?'إلزامي لحساب مسؤول المنصة.':'Required for platform administrators.'):(ar?'يمكنك تفعيله لحماية حسابك برمز من تطبيق المصادقة عند تسجيل الدخول.':'Add a code from your authenticator app when signing in to protect your account.')}</p>
  <Feedback {...{c,error}}/>
  {recovery?<div className="space-y-3"><p>{ar?'احفظ رموز الاسترداد في مكان آمن. يظهر كل رمز مرة واحدة ويمكن استخدامه مرة واحدة.':'Save these recovery codes securely. They are shown once and each can be used once.'}</p><ul dir="ltr" className="font-mono text-sm break-all space-y-2">{recovery.map(value=><li key={value}>{value}</li>)}</ul><button className={primaryClass} onClick={()=>setRecovery(null)}>{ar?'حفظت رموز الاسترداد':'I saved my recovery codes'}</button></div>:mode?<form onSubmit={submit} className="space-y-4">
   {mode==='disable'&&<p className="text-sm text-slate-500">{ar?'أدخل كلمة المرور ورمز المصادقة لتأكيد التعطيل. ستُلغى الجلسات الأخرى ورموز الاسترداد.':'Confirm with your password and authenticator code. Other sessions and recovery codes will be revoked.'}</p>}
   {!setup&&<Field id="mfa-password" label={c('currentPassword')} placeholder={c('currentPasswordPlaceholder')} type="password" autoComplete="current-password" required maxLength={128} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/>}
   {setup&&<><p>{c('qrHint')}</p><img src={setup.qrCode} alt={c('qrAlt')} width={256} height={256} className="mx-auto w-full max-w-64"/><Field id="mfa-secret" label={c('secretLabel')} value={setup.secret} readOnly dir="ltr"/></>}
   {(setup||mode==='disable')&&<Field id="mfa-code" label={ar?'رمز المصادقة':'Authenticator code'} placeholder="123456" value={code} onChange={e=>setCode(e.target.value.replace(/[^0-9]/g,'').slice(0,6))} inputMode="numeric" autoComplete="one-time-code" dir="ltr" minLength={6} maxLength={6} pattern="[0-9]{6}" required disabled={busy}/>}
   <div className="flex gap-3"><button className={primaryClass} disabled={busy}>{ar?'تأكيد':'Confirm'}</button><button type="button" className={buttonClass} disabled={busy} onClick={clear}>{ar?'إلغاء':'Cancel'}</button></div>
  </form>:(!account.mfaEnabled||!account.mfaMandatory)&&<button className={buttonClass} onClick={()=>setMode(account.mfaEnabled?'disable':'enable')}>{account.mfaEnabled?(ar?'تعطيل التحقق بخطوتين':'Disable MFA'):(ar?'تفعيل التحقق بخطوتين':'Enable MFA')}</button>}
 </section>;
}
