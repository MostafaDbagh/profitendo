import { Link } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthBranding, MobileLogo } from '../components/auth/AuthBranding';
import { useLanguage } from '../context/LanguageContext';
import { authCopy } from '../components/auth-v2/copy';
import { Field, Submit, inputClass, linkClass } from '../components/auth-v2/Fields';
import { Seo } from '../components/Seo';

const roles = ['OPERATIONS_MANAGER', 'WAREHOUSE_STAFF', 'SHOP_MANAGER', 'CASHIER', 'VIEWER'];
export default function AuthV2() {
  const { lang, setLang, t } = useLanguage();
  const c = (key) => authCopy[lang]?.[key] || authCopy.en[key] || authCopy[lang].failed;
  const [initial] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  const [mode, setMode] = useState(() => ['verify', 'reset', 'invite'].includes(initial.get('action')) ? initial.get('action') : 'login');
  const [linkAction, setLinkAction] = useState(initial.get('action'));
  const linkToken = useRef(initial.get('token') || '');
  const csrf = useRef('');
  const [session, setSession] = useState(null), [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [form, setForm] = useState({ email: '', password: '', name: '', businessName: '', code: '', currentPassword: '', businessId: '', role: 'CASHIER', inviteEmail: '' });
  const [secret, setSecret] = useState(''), [recovery, setRecovery] = useState([]), [sessions, setSessions] = useState([]);
  const statusRef = useRef(null);
  const call = useCallback(async (path, body) => {
    const response = await fetch(`${process.env.REACT_APP_AUTH_API_URL}/api/auth${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'include',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.current },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
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
    call('/me').then(data => { if (active) setSession(data); }).catch(err => { if (active && err.status !== 401) setError('failed'); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; window.removeEventListener('hashchange', receiveLink); };
  }, [call]);
  useEffect(() => { if (error || notice) statusRef.current?.focus(); }, [error, notice]);
  useEffect(() => {
    if (session?.stage === 'authenticated' && !recovery.length) call('/sessions').then(setSessions).catch(() => setError('failed'));
  }, [session, recovery.length, call]);
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));
  const switchMode = next => { setMode(next); setError(''); setNotice(''); setForm(f => ({ ...f, password: '', currentPassword: '', code: '' })); };
  const clear = () => { csrf.current = ''; setSession(null); setSecret(''); setRecovery([]); setSessions([]); setMode('login'); setForm(f => ({ ...f, password: '', currentPassword: '', code: '' })); };
  const run = async work => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (e) { setError(e.message); if (e.message === 'SESSION_EXPIRED' || e.message === 'UNAUTHENTICATED') clear(); }
    finally { setBusy(false); }
  };
  const submit = e => { e.preventDefault(); run(async () => {
    if (mode === 'verify') { await call('/verification/confirm', { token: linkToken.current }); linkToken.current = ''; setMode('login'); setNotice('verified'); }
    else if (mode === 'reset') { await call('/reset-password', { token: linkToken.current, password: form.password }); linkToken.current = ''; clear(); setNotice('resetDone'); }
    else if (mode === 'invite') { await call('/invitations/accept', { token: linkToken.current, ...(session?.stage === 'authenticated' ? {} : { name: form.name, password: form.password }) }); linkToken.current = ''; setMode('login'); setNotice('inviteDone'); }
    else if (session?.stage === 'mfa_setup_required') {
      if (!secret) { const data = await call('/mfa/setup', { password: form.password }); setSecret(data.secret); setForm(f => ({ ...f, password: '' })); }
      else { const data = await call('/mfa/confirm', { code: form.code }); const { recoveryCodes, ...safeSession } = data; setSession(safeSession); setRecovery(recoveryCodes); setSecret(''); setForm(f => ({ ...f, code: '' })); }
    } else if (session?.stage === 'mfa_required') { setSession(await call('/mfa/verify', { code: form.code })); setForm(f => ({ ...f, code: '' })); }
    else if (mode === 'login') { setSession(await call('/login', { email: form.email, password: form.password })); setForm(f => ({ ...f, password: '' })); }
    else if (mode === 'register') { await call('/register', { email: form.email, password: form.password, name: form.name, businessName: form.businessName }); setForm(f => ({ ...f, password: '' })); setNotice('checkEmail'); }
    else if (mode === 'forgot') { await call('/forgot-password', { email: form.email }); setNotice('checkEmail'); }
  }); };
  useEffect(() => {
    if (session?.stage === 'authenticated' && linkAction === 'invite' && linkToken.current) setMode('invite');
  }, [session, linkAction]);
  const isLink = ['verify', 'reset', 'invite'].includes(mode);
  const authenticated = session?.stage === 'authenticated' && !isLink;
  const setup = !isLink && session?.stage === 'mfa_setup_required';
  const challenge = !isLink && session?.stage === 'mfa_required';
  const title = recovery.length ? 'recoveryTitle' : authenticated ? 'accountTitle' : setup ? 'mfaSetup' : challenge ? 'mfaTitle' : mode;
  const field = (key, label, extra = {}) => <Field placeholder={c(key === 'code' ? (setup ? 'setupCodePlaceholder' : 'codePlaceholder') : extra.autoComplete === 'new-password' ? 'newPasswordPlaceholder' : `${label}Placeholder`)} id={`v2-${key}`} label={c(label)} value={form[key]} onChange={set(key)} required disabled={busy} {...extra} />;
  const signOut = (path = '/logout') => run(async () => { await call(path, {}); clear(); });
  return <div className="min-h-screen bg-slate-50 flex relative" data-testid="auth-v2-page">
    <Seo title={`${c(title)} | ProfitLens`} description={c('loginHint')} path="/auth-v2" noindex />
    <button type="button" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar', false)} className="absolute top-4 end-4 z-10 px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500">{c('language')}</button>
    <AuthBranding t={t} />
    <main className="flex-1 flex items-center justify-center p-6 pt-20 lg:pt-6 min-w-0">
      <div className="w-full max-w-md fade-up"><MobileLogo t={t} />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <h1 className="text-2xl font-bold text-slate-900">{c(title)}</h1>
          <p className="text-slate-500 text-sm mt-1 mb-6">{c(recovery.length ? 'recoveryHint' : authenticated ? 'accountHint' : setup ? 'mfaSetupHint' : challenge ? 'mfaHint' : mode === 'register' ? 'registerHint' : 'loginHint')}</p>
          {(error || notice) && <div ref={statusRef} tabIndex={-1} role={error ? 'alert' : 'status'} className={`text-sm p-3 rounded-lg border mb-5 ${error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>{c(error || notice)}</div>}
          {checking ? <p role="status" className="text-sm text-slate-500">{c('checking')}</p> : recovery.length ? <div className="space-y-5">
            <div dir="ltr" className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs tabular p-3 bg-slate-50 border border-slate-200 rounded-lg">{recovery.map(code => <code key={code} className="break-all select-all">{code}</code>)}</div>
            <button type="button" className={linkClass} onClick={() => setRecovery([])}>{c('savedCodes')}</button>
          </div> : authenticated ? <div className="space-y-6">
            <p className="font-semibold text-slate-800 break-words">{session.user.name}<span dir="ltr" className="block text-sm text-slate-500 font-normal break-all">{session.user.email}</span></p>
            {session.user.platformRole === 'SUPER_ADMIN' && <Link className={`${linkClass} block`} to="/platform-v2">{c('platform')}</Link>}
            <section><h2 className="font-bold text-slate-900 mb-3">{c('businesses')}</h2><Link className={linkClass} to="/business-v2">{c('manageBusiness')}</Link><Link className={`${linkClass} block mt-2`} to="/billing-v2">{lang === 'ar' ? 'الفوترة وإلغاء الاشتراك' : 'Billing and cancellation'}</Link>{session.memberships.length ? session.memberships.map(m => <p key={m.businessId} className="text-sm text-slate-600 py-2 border-b border-slate-100">{m.business.name} <span className="text-xs text-emerald-700">{c(m.role)}</span></p>) : <p className="text-sm text-slate-500">{c('noBusiness')}</p>}</section>
            <section><h2 className="font-bold text-slate-900 mb-3">{c('sessions')}</h2><ul className="space-y-3">{sessions.map(s => <li key={s.id} className="flex flex-wrap justify-between items-center gap-2 text-sm"><span className="text-slate-600">{s.current ? c('thisSession') : new Date(s.createdAt).toLocaleString(lang === 'ar' ? 'ar' : 'en')}</span><button disabled={busy} type="button" className={linkClass} onClick={() => run(async () => { await call('/sessions/revoke', { sessionId: s.id }); if (s.current) clear(); else setSessions(await call('/sessions')); })}>{c('revoke')}</button></li>)}</ul></section>
            {session.memberships.some(m => m.role === 'OWNER') && <form className="space-y-4 border-t border-slate-100 pt-5" onSubmit={e => { e.preventDefault(); run(async () => { await call('/invitations', { businessId: form.businessId, email: form.inviteEmail, role: form.role }); setNotice('inviteSent'); setForm(f => ({ ...f, inviteEmail: '' })); }); }}>
              <h2 className="font-bold text-slate-900">{c('invitations')}</h2>
              <div><label htmlFor="v2-businessId" className="text-sm font-medium text-slate-700 mb-1.5 block">{c('business')}</label><select id="v2-businessId" required value={form.businessId} onChange={set('businessId')} className={inputClass}><option value="">{c('chooseBusiness')}</option>{session.memberships.filter(m => m.role === 'OWNER').map(m => <option key={m.businessId} value={m.businessId}>{m.business.name}</option>)}</select></div>
              {field('inviteEmail', 'inviteEmail', { type: 'email', autoComplete: 'off', dir: 'ltr' })}
              <div><label htmlFor="v2-role" className="text-sm font-medium text-slate-700 mb-1.5 block">{c('role')}</label><select id="v2-role" value={form.role} onChange={set('role')} className={inputClass}>{roles.map(role => <option key={role} value={role}>{c(role)}</option>)}</select></div><Submit busy={busy}>{c('sendInvite')}</Submit>
            </form>}
            <form className="space-y-4 border-t border-slate-100 pt-5" onSubmit={e => { e.preventDefault(); run(async () => { await call('/password', { currentPassword: form.currentPassword, password: form.password }); clear(); setNotice('passwordChanged'); }); }}>
              <h2 className="font-bold text-slate-900">{c('changePassword')}</h2>{field('currentPassword', 'currentPassword', { type: 'password', autoComplete: 'current-password', maxLength: 128 })}{field('password', 'newPassword', { type: 'password', minLength: 12, maxLength: 128, autoComplete: 'new-password', hint: c('passwordHint') })}<Submit busy={busy}>{c('changePassword')}</Submit>
            </form>
            <div className="flex flex-wrap gap-4 border-t border-slate-100 pt-4"><button disabled={busy} className={linkClass} onClick={() => signOut('/lock')}>{c('lock')}</button><button disabled={busy} className={linkClass} onClick={() => signOut()}>{c('logout')}</button><button disabled={busy} className={linkClass} onClick={() => run(async () => { await call('/sessions/revoke', {}); clear(); })}>{c('revokeAll')}</button></div>
          </div> : <>
            <form onSubmit={submit} className="space-y-4" data-testid="auth-v2-form">
              {setup ? secret ? <><p className="text-sm text-slate-600">{c('secretHint')}</p><label htmlFor="v2-secret" className="text-sm font-medium text-slate-700 block">{c('secretLabel')}</label><input id="v2-secret" readOnly dir="ltr" value={secret} className={`${inputClass} font-mono text-xs`} />{field('code', 'code', { autoComplete: 'one-time-code', inputMode: 'numeric', dir: 'ltr', maxLength: 6 })}</> : field('password', 'currentPassword', { type: 'password', autoComplete: 'current-password', maxLength: 128 }) : challenge ? field('code', 'code', { autoComplete: 'one-time-code', dir: 'ltr', maxLength: 24 }) : <>
                {(mode === 'register' || (mode === 'invite' && session?.stage !== 'authenticated')) && field('name', 'name', { autoComplete: 'name', minLength: 2, maxLength: 100 })}
                {mode === 'register' && field('businessName', 'business', { autoComplete: 'organization', minLength: 2, maxLength: 120 })}
                {['login', 'register', 'forgot'].includes(mode) && field('email', 'email', { type: 'email', autoComplete: 'email', dir: 'ltr', maxLength: 254 })}
                {(['login', 'register', 'reset'].includes(mode) || (mode === 'invite' && session?.stage !== 'authenticated')) && field('password', mode === 'reset' ? 'newPassword' : 'password', { type: 'password', autoComplete: mode === 'login' ? 'current-password' : 'new-password', minLength: mode === 'login' ? 1 : 12, maxLength: 128, hint: mode === 'login' ? undefined : c('passwordHint') })}
                {mode === 'invite' && <p className="text-sm text-slate-500">{c(session?.stage === 'authenticated' ? 'inviteSignedIn' : 'inviteExisting')}</p>}
              </>}
              <Submit busy={busy}>{c(setup ? secret ? 'confirmMfa' : 'beginSetup' : challenge ? 'submit' : mode === 'forgot' ? 'sendLink' : mode === 'verify' ? 'verifyButton' : mode === 'invite' ? 'accept' : mode === 'reset' ? 'submit' : mode)}</Submit>
            </form>
            {!setup && !challenge && <div className="mt-5 flex flex-col gap-3 items-center">{mode === 'login' ? <><button type="button" className={linkClass} onClick={() => switchMode('forgot')}>{c('forgotLink')}</button><button type="button" className={linkClass} onClick={() => switchMode('register')}>{c('createLink')}</button>{error === 'EMAIL_UNVERIFIED' && <button type="button" disabled={busy} className={linkClass} onClick={() => run(async () => { await call('/verification/request', { email: form.email }); setNotice('checkEmail'); })}>{c('verifyAgain')}</button>}</> : <button type="button" className={linkClass} onClick={() => switchMode('login')}>{c('back')}</button>}</div>}
            {(setup || challenge) && <button type="button" disabled={busy} className={`${linkClass} mt-5`} onClick={() => signOut()}>{c('logout')}</button>}
          </>}
        </div>
      </div>
    </main>
  </div>;
}
