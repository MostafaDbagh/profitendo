import PhoneInput from '../components/auth-v2/PhoneInput';
import PhoneVerification from '../components/auth-v2/PhoneVerification';
import OtpField from '../components/auth-v2/OtpField';
import { Link, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthBranding, MobileLogo } from '../components/auth/AuthBranding';
import { useLanguage } from '../context/LanguageContext';
import { authCopy } from '../components/auth-v2/copy';
import { Field, Submit, inputClass, linkClass } from '../components/auth-v2/Fields';
import { Seo } from '../components/Seo';

export default function AuthV2() {
  const { lang, setLang, t } = useLanguage();
  const navigate=useNavigate();
  const c = (key) => authCopy[lang]?.[key] || authCopy.en[key] || authCopy[lang].failed;
  const [emailOtp,setEmailOtp]=useState(false);
  const [mockOtp,setMockOtp]=useState(false),[emailChallenge,setEmailChallenge]=useState(null),[recoveryMode,setRecoveryMode]=useState(false),[resendAt,setResendAt]=useState(0),[now,setNow]=useState(Date.now());
  const [initial] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  const [mode, setMode] = useState(() => ['verify', 'reset', 'invite'].includes(initial.get('action')) ? initial.get('action') : new URLSearchParams(window.location.search).get('mode') === 'register' ? 'register' : 'login');
  const [linkAction, setLinkAction] = useState(initial.get('action'));
  const linkToken = useRef(initial.get('token') || '');
  const csrf = useRef('');
  const [session, setSession] = useState(null), [checking, setChecking] = useState(true);
  const [initialFailed, setInitialFailed] = useState(false), [checkAttempt, setCheckAttempt] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [form, setForm] = useState({ phone: '', email: '', password: '', confirmPassword:'', name: '', businessName: '', code: '', currentPassword: '', businessId: '', role: 'CASHIER', inviteEmail: '' });
  const [qrCode,setQrCode]=useState('');
  const [secret, setSecret] = useState(''), [recovery, setRecovery] = useState([]);
  const statusRef = useRef(null);
  const call = useCallback(async (path, body) => {
    const timeout = AbortSignal.timeout(30000);
    let response;
    try { response = await fetch(`${process.env.REACT_APP_AUTH_API_URL}/api/auth${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'include', signal: timeout,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.current },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }); } catch { throw new Error(timeout.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR'); }
    const data = await response.json().catch(() => { throw new Error('INVALID_SERVER_RESPONSE'); });
    if (!response.ok) { const failure = new Error(data.error?.code || 'failed'); failure.status = response.status; throw failure; }
    if (data.csrfToken) csrf.current = data.csrfToken;
    return data;
  }, []);
  useEffect(() => {
    // Remove secret links from the address bar immediately; retain only in memory.
    const receiveLink = () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const action = params.get('action');
      if (['verify', 'reset', 'invite'].includes(action)) {
        linkToken.current = params.get('token') || '';
        setLinkAction(action); setMode(action); setError(''); setNotice('');
      }
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    };
    receiveLink();
    window.addEventListener('hashchange', receiveLink);
    let active = true;
    setChecking(true); setInitialFailed(false); setError('');
    Promise.all([call('/config'),call('/me').catch(err=>{if(err.status===401)return null;throw err;})]).then(([config,data])=>{if(active){setMockOtp(config.mockOtp);setEmailOtp(config.emailOtp);setSession(data);}}).catch(err=>{if(active){setError(err.message);setInitialFailed(true);}}).finally(()=>{if(active)setChecking(false);});
    return () => { active = false; window.removeEventListener('hashchange', receiveLink); };
  }, [call, checkAttempt]);
  useEffect(() => { if (error || notice) statusRef.current?.focus(); }, [error, notice]);
  useEffect(()=>{if(!emailChallenge)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[emailChallenge]);
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));
  const switchMode = next => { if(busy)return;setEmailChallenge(null);setRecoveryMode(false);setMode(next); setError(''); setNotice(''); setForm(f => ({ ...f, password: '', confirmPassword:'', currentPassword: '', code: '' })); };
  const clear = () => { setEmailChallenge(null);setRecoveryMode(false);csrf.current = ''; setSession(null); setSecret(''); setQrCode(''); setRecovery([]); setMode('login'); setForm(f => ({ ...f, password: '', confirmPassword:'', currentPassword: '', code: '' })); };
  const run = async work => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (e) { setError(e.message); if (e.message === 'SESSION_EXPIRED' || e.message === 'UNAUTHENTICATED') clear(); }
    finally { setBusy(false); }
  };
  async function startEmailCode(purpose){const realVerify=emailOtp&&purpose==='VERIFY_EMAIL';const data=await call(realVerify?'/email-code/request':'/mock-code/request',realVerify?{email:form.email}:{email:form.email,purpose});setEmailChallenge({...data,purpose,realVerify});setResendAt(Date.now()+30000);setNow(Date.now());setMode('emailCode');setForm(f=>({...f,code:'',password:'',confirmPassword:''}));}
  const submit = e => { e.preventDefault(); run(async () => {
    if(['register','reset'].includes(mode)&&form.password!==form.confirmPassword)throw new Error('PASSWORD_MISMATCH');
    if(mode==='emailCode'){const data=await call(emailChallenge.realVerify?'/email-code/confirm':'/mock-code/confirm',{challenge:emailChallenge.challenge,...(emailChallenge.realVerify?{}:{purpose:emailChallenge.purpose}),code:form.code});setEmailChallenge(null);setForm(f=>({...f,code:''}));if(data.resetToken){linkToken.current=data.resetToken;setMode('reset');}else{setMode('login');setNotice('verified');}}
    else if (mode === 'verify') { await call('/verification/confirm', { token: linkToken.current }); linkToken.current = ''; setMode('login'); setNotice('verified'); }
    else if (mode === 'reset') { await call('/reset-password', { token: linkToken.current, password: form.password }); linkToken.current = ''; clear(); setNotice('resetDone'); }
    else if (mode === 'invite') { await call('/invitations/accept', { token: linkToken.current, ...(session?.stage === 'authenticated' ? {} : { ...(form.name ? { name: form.name } : {}), ...(form.password ? { password: form.password } : {}) }) }); linkToken.current = ''; setForm(f => ({ ...f, password: '' })); setMode('login'); setNotice('inviteDone'); }
    else if (session?.stage === 'mfa_setup_required') {
      if (!secret) { const data = await call('/mfa/setup', { password: form.password }); setSecret(data.secret); setQrCode(data.qrCode); setForm(f => ({ ...f, password: '' })); }
      else { const data = await call('/mfa/confirm', { code: form.code }); const { recoveryCodes, ...safeSession } = data; setSession(safeSession); setRecovery(recoveryCodes); setSecret(''); setQrCode(''); setForm(f => ({ ...f, code: '' })); }
    } else if (session?.stage === 'mfa_required') { setSession(await call('/mfa/verify', { code: form.code })); setForm(f => ({ ...f, code: '' })); }
    else if (mode === 'login') { setSession(await call('/login', { email: form.email, password: form.password })); setForm(f => ({ ...f, password: '' })); }
    else if (mode === 'register') { await call('/register', { email: form.email, password: form.password, name: form.name, businessName: form.businessName,phone:'+963'+form.phone,language:lang }); setForm(f => ({ ...f, password: '',confirmPassword:'' })); if(mockOtp||emailOtp)await startEmailCode('VERIFY_EMAIL');else setNotice('checkEmail'); }
    else if (mode === 'forgot') { if(mockOtp)await startEmailCode('PASSWORD_RESET');else{await call('/forgot-password', { email: form.email }); setNotice('checkEmail');} }
  }); };
  useEffect(() => {
    if (session?.stage === 'authenticated' && linkAction === 'invite' && linkToken.current) setMode('invite');
  }, [session, linkAction]);
  const isLink = ['verify', 'reset', 'invite','emailCode'].includes(mode);
  const authenticated = session?.stage === 'authenticated' && !isLink;
  useEffect(()=>{if(!checking&&authenticated&&!recovery.length)navigate(session.user.platformRole==='SUPER_ADMIN'?'/platform-v2':'/business-v2',{replace:true});},[checking,authenticated,recovery.length,session,navigate]);
  const setup = !isLink && session?.stage === 'mfa_setup_required';
  const challenge = !isLink && session?.stage === 'mfa_required';
  const phone=!isLink&&session?.stage==='phone_verification_required';
  const title = phone?'phoneVerification': recovery.length ? 'recoveryTitle' : authenticated ? 'accountTitle' : setup ? 'mfaSetup' : challenge ? 'mfaTitle' : mode;
  const field = (key, label, extra = {}) => <Field key={`${mode}-${session?.stage || 'anonymous'}-${key}`} placeholder={c(key === 'code' ? (setup ? 'setupCodePlaceholder' : 'codePlaceholder') : extra.autoComplete === 'new-password' ? 'newPasswordPlaceholder' : `${label}Placeholder`)} id={`v2-${key}`} label={c(label)} value={form[key]} onChange={set(key)} required disabled={busy} {...extra} />;
  const otp=<OtpField value={form.code} onChange={code=>setForm(f=>({...f,code}))} c={c} disabled={busy}/>;
  const signOut = (path = '/logout') => run(async () => { await call(path, {}); clear(); });
  if(authenticated&&!recovery.length)return <p role="status" className="p-6 text-slate-500">{c('checking')}</p>;
  return <div className="min-h-screen bg-slate-50 flex relative" data-testid="auth-v2-page">
    <Seo title={`${c(title)} | ProfitLens`} description={c('loginHint')} path="/auth-v2" noindex />
    <button type="button" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar', false)} className="absolute top-4 end-4 z-10 px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500">{c('language')}</button>
    <AuthBranding t={t} />
    <main className="flex-1 flex items-center justify-center p-6 pt-20 lg:pt-6 min-w-0">
      <div className="w-full max-w-md fade-up"><MobileLogo t={t} /><Link to="/contact" className={`${linkClass} block mb-4`}>{lang==='ar'?'تواصل معنا':'Contact Us'}</Link>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <h1 className="text-2xl font-bold text-slate-900">{c(title)}</h1>
          {!phone&&<p className="text-slate-500 text-sm mt-1 mb-6">{c(recovery.length ? 'recoveryHint' : authenticated ? 'accountHint' : setup ? 'mfaSetupHint' : challenge ? 'mfaHint' : mode === 'register' ? 'registerHint' : 'loginHint')}</p>}
          {(error || notice) && <div ref={statusRef} tabIndex={-1} role={error ? 'alert' : 'status'} className={`text-sm p-3 rounded-lg border mb-5 ${error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>{c(error || notice)}</div>}
          {checking ? <p role="status" className="text-sm text-slate-500">{c('checking')}</p> : initialFailed ? <button type="button" className={linkClass} onClick={() => setCheckAttempt(value => value + 1)}>{c('retryConnection')}</button> : recovery.length ? <div className="space-y-5">
            <div dir="ltr" className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs tabular p-3 bg-slate-50 border border-slate-200 rounded-lg">{recovery.map(code => <code key={code} className="break-all select-all">{code}</code>)}</div>
            <button type="button" className={linkClass} onClick={() => setRecovery([])}>{c('savedCodes')}</button>
          </div> : authenticated ? <p role="status">{c('checking')}</p> : phone ? <PhoneVerification initialPhone={session.pendingPhone || form.phone} {...{call,c,mockOtp}} done={setSession} logout={()=>signOut()}/> : <>
            <>{mockOtp&&<p className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900" role="note">{c('mockNotice')}</p>}</><form onSubmit={submit} className="space-y-4" data-testid="auth-v2-form">
              {mode==='emailCode'?<><p className="text-sm text-slate-600">{c('emailCodeHint')} <bdi>{form.email}</bdi></p>{otp}</>:setup ? secret ? <><p className="text-sm text-slate-600">{c('qrHint')}</p><img data-testid="mfa-qr" src={qrCode} alt={c('qrAlt')} width={256} height={256} className="mx-auto block w-full max-w-64 h-auto bg-white" /><p className="text-sm text-slate-600">{c('secretHint')}</p><label htmlFor="v2-secret" className="text-sm font-medium text-slate-700 block">{c('secretLabel')}</label><input id="v2-secret" readOnly dir="ltr" value={secret} className={`${inputClass} font-mono text-xs`} />{otp}</> : field('password', 'currentPassword', { type: 'password', autoComplete: 'current-password', maxLength: 128 }) : challenge ? <>{recoveryMode?field('code','recoveryCode',{placeholder:c('recoveryPlaceholder'),autoComplete:'off',dir:'ltr',minLength:24,maxLength:24,pattern:'[a-f0-9]{24}'}):otp}<button type="button" disabled={busy} className={linkClass} onClick={()=>{setRecoveryMode(v=>!v);setForm(f=>({...f,code:''}));setError('');}}>{c(recoveryMode?'useAuthenticator':'useRecovery')}</button></> : <>
                {(mode === 'register' || (mode === 'invite' && session?.stage !== 'authenticated')) && field('name', 'name', { autoComplete: 'name', required: mode !== 'invite', minLength: 2, maxLength: 100 })}
                {mode === 'register' && field('businessName', 'business', { autoComplete: 'organization', minLength: 2, maxLength: 120 })}
                {['login', 'register', 'forgot'].includes(mode) && field('email', 'email', { type: 'email', autoComplete: 'email', dir: 'ltr', maxLength: 254 })}
                {mode === 'register' && <PhoneInput id="v2-register-phone" label={c('phoneNumber')} value={form.phone} onChange={phone=>setForm(f=>({...f,phone}))} disabled={busy}/> }
                {(['login', 'register', 'reset'].includes(mode) || (mode === 'invite' && session?.stage !== 'authenticated')) && field('password', mode === 'reset' ? 'newPassword' : 'password', { required: mode !== 'invite', type: 'password', autoComplete: mode === 'login' ? 'current-password' : 'new-password', minLength: mode === 'login' ? 1 : 12, maxLength: 128, hint: mode === 'login' ? undefined : c('passwordHint') })}
                {['register','reset'].includes(mode)&&field('confirmPassword','confirmPassword',{type:'password',autoComplete:'new-password',minLength:12,maxLength:128,placeholder:c('confirmPasswordPlaceholder')})}
                {mode === 'invite' && session?.stage !== 'authenticated' && <p className="text-sm text-slate-500">{lang === 'ar' ? 'اترك الاسم وكلمة المرور فارغين لاستخدام البيانات التي حددها مسؤول الدعوة، أو أدخل بياناتك الخاصة.' : 'Leave name and password blank to use the details supplied by the inviter, or enter your own.'}</p>}
                {mode === 'invite' && <p className="text-sm text-slate-500">{c(session?.stage === 'authenticated' ? 'inviteSignedIn' : 'inviteExisting')}</p>}
              </>}
              <Submit busy={busy}>{c(setup ? secret ? 'confirmMfa' : 'beginSetup' : challenge ? 'submit' : mode === 'emailCode'?'verifyCode':mode === 'forgot' ? (mockOtp?'sendCode':'sendLink') : mode === 'verify' ? 'verifyButton' : mode === 'invite' ? 'accept' : mode === 'reset' ? 'submit' : mode)}</Submit>
            </form>
            {mode==='emailCode'&&<button type="button" className={`${linkClass} mt-4`} disabled={busy||now<resendAt} onClick={()=>run(()=>startEmailCode(emailChallenge.purpose))}>{now<resendAt?`${c('resendIn')} ${Math.max(0,Math.ceil((resendAt-now)/1000))}`:c('resendCode')}</button>}
            {!setup && !challenge && <div className="mt-5 flex flex-col gap-3 items-center">{mode === 'login' ? <><button type="button" className={linkClass} onClick={() => switchMode('forgot')}>{c('forgotLink')}</button><button type="button" className={linkClass} onClick={() => switchMode('register')}>{c('createLink')}</button>{error === 'EMAIL_UNVERIFIED' && <button type="button" disabled={busy} className={linkClass} onClick={() => run(async () => { if(mockOtp||emailOtp)await startEmailCode('VERIFY_EMAIL');else{await call('/verification/request', { email: form.email });setNotice('checkEmail');} })}>{c('verifyAgain')}</button>}</> : <button type="button" className={linkClass} onClick={() => switchMode('login')}>{c('back')}</button>}</div>}
            {(setup || challenge) && <button type="button" disabled={busy} className={`${linkClass} mt-5`} onClick={() => signOut()}>{c('logout')}</button>}
          </>}
        </div>
      </div>
    </main>
  </div>;
}
