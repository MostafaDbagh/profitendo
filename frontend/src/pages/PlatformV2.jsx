import {useTabScroll} from '../hooks/useTabScroll';
import OnboardingPolicy from '../components/platform-v2/OnboardingPolicy';
import Security from '../components/business-v2/Security';
import Commercial from '../components/platform-v2/Commercial';
import SupportInbox from '../components/support-v2/Support';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Users, History, LayoutDashboard } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { Seo } from '../components/Seo';
import { useBusinessApi } from '../components/business-v2/useBusinessApi';
import { Feedback, buttonClass } from '../components/business-v2/UI';
import { platformCopy } from '../components/platform-v2/copy';
import Plans, { BillingAudit } from '../components/billing-v2/Plans';
import { Overview, Records, Audit } from '../components/platform-v2/Records';
const sections = [['onboarding',Users],['security',Users],['overview', LayoutDashboard], ['approvals', Users], ['revenue', LayoutDashboard], ['subscribers', Building2], ['support', History], ['businesses', Building2], ['users', Users], ['audit', History], ['plans', Building2], ['billingAudit', History]];
export default function PlatformV2() {
  const { lang, setLang } = useLanguage(), api = useBusinessApi(), navigate = useNavigate();
  const c = key => platformCopy[lang]?.[key] || platformCopy.en[key] || platformCopy[lang]?.failed;
  const [allowed, setAllowed] = useState(false), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const [params,setParams]=useSearchParams(),section=params.get('tab')||'overview',setSection=tab=>{setParams({tab});requestScroll();};
  const {contentRef,requestScroll}=useTabScroll(section);
  useEffect(() => {
    const controller = new AbortController(); setAllowed(false); setError('');
    api('/auth/me', { signal: controller.signal }).then(session => {
      if (controller.signal.aborted) return;
      if (session.stage !== 'authenticated') { navigate('/auth-v2', { replace: true }); return; }
      if (session.user.platformRole !== 'SUPER_ADMIN') { setError('PLATFORM_FORBIDDEN'); return; }
      setAllowed(true);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [api, navigate, version]);
  return <div className="min-h-screen bg-slate-50 text-slate-900"><Seo title={`${c('platform')} | ProfitLens`} path="/platform-v2" noindex />
    <header className="bg-white border-b border-slate-200 px-4 md:px-8 py-4 flex flex-wrap justify-between items-center gap-3"><span className="font-bold text-lg">ProfitLens</span><div className="flex flex-wrap gap-2"><Link to="/auth-v2" className={buttonClass}>{c('security')}</Link><button className={buttonClass} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar', false)}>{c('language')}</button></div></header>
    <div className="px-4 md:px-8 py-6"><h1 className="text-2xl md:text-3xl font-bold">{c('platform')}</h1><p className="mt-2 text-sm text-slate-500">{c('platformHint')}</p></div>
    {!allowed ? <div className="px-4 md:px-8"><Feedback error={error} c={c} retry={error !== 'PLATFORM_FORBIDDEN' ? () => setVersion(v => v + 1) : undefined} />{!error && <p role="status">{c('loading')}</p>}</div> : <div className="md:flex min-w-0"><nav aria-label={c('platform')} className="md:w-72 shrink-0 bg-white border-b md:border-b-0 md:border-e border-slate-200 p-4 md:p-6"><div className="flex flex-wrap md:flex-col gap-2">{sections.map(([key, Icon]) => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => setSection(key)} className={`flex items-center gap-3 text-start px-4 py-3 rounded-xl border text-sm font-medium focus-visible:ring-2 focus-visible:ring-emerald-500 ${section === key ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'text-slate-600 border-transparent hover:bg-slate-50'}`}><Icon className="w-5 h-5" aria-hidden="true" />{c(key)}</button>)}</div></nav><main ref={contentRef} tabIndex={-1} className="outline-none flex-1 min-w-0 px-4 py-6 md:p-8"><div className="max-w-7xl mx-auto">{section==='onboarding'?<OnboardingPolicy {...{api,lang}}/>:section==='security'?<Security {...{api,lang}}/>:['approvals','revenue','subscribers'].includes(section)?<Commercial key={section} kind={section} {...{api,lang}}/>:section==='support'?<SupportInbox {...{api,lang}} admin/>:section === 'plans' ? <Plans {...{ api, lang }} /> : section === 'billingAudit' ? <BillingAudit {...{ api, lang }} /> : section === 'overview' ? <Overview {...{ api, c }} /> : section === 'audit' ? <Audit {...{ api, c, lang }} /> : <Records key={section} kind={section} {...{ api, c, lang }} />}</div></main></div>}
  </div>;
}
