import {PageContainer, PageLayout} from '../components/page-layout/PageLayout';
import {LoadingState} from '../components/page-layout/PageResults';
import PaidAccess from '../components/billing-v2/PaidAccess';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { Seo } from '../components/Seo';
import { useBusinessApi } from '../components/business-v2/useBusinessApi';
import { Feedback, Select, buttonClass } from '../components/business-v2/UI';
import { billingCopy } from '../components/billing-v2/copy';
import Cancellation from '../components/billing-v2/Cancellation';
import Receipts from '../components/billing-v2/Receipts';

export default function BillingV2() {
  const { lang, setLang } = useLanguage(), api = useBusinessApi(), navigate = useNavigate();
  const c = key => billingCopy[lang]?.[key] || billingCopy.en[key] || billingCopy[lang].failed;
  const [rows,setRows] = useState(null), [selected,setSelected] = useState(''), [error,setError] = useState(''), [version,setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setRows(null); setError('');
    (async () => {
      const session = await api('/auth/me',{signal:controller.signal});
      if (session.stage !== 'authenticated') { navigate('/auth-v2',{replace:true}); return; }
      const businesses = await api('/billing/businesses',{signal:controller.signal});
      if (!controller.signal.aborted) { setRows(businesses); setSelected(old => businesses.some(b => b.id === old) ? old : businesses[0]?.id || ''); }
    })().catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  },[api,navigate,version]);
  const business = rows?.find(b => b.id === selected);
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <Seo title={`${c('billingRecovery')} | ProfitLens`} path="/billing-v2" noindex />
    <header className="bg-white border-b border-slate-200 px-4 md:px-8 py-4 flex flex-wrap justify-between items-center gap-3"><span className="font-bold text-lg">ProfitLens</span><div className="flex flex-wrap gap-2"><Link className={buttonClass} to="/contact">{lang==='ar'?'تواصل معنا':'Contact Us'}</Link><Link className={buttonClass} to="/business-v2?tab=security">{c('security')}</Link><button className={buttonClass} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar',false)}>{c('language')}</button></div></header>
    <PageContainer>
     <PageLayout title={c('billingRecovery')} heading="h1" toolbar={rows?.length > 0 && <div className="max-w-xs"><Select id="billing-business" label={c('chooseBusiness')} value={selected} onChange={e => setSelected(e.target.value)}>{rows.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></div>}>
      <Feedback error={error} c={c} retry={() => setVersion(v => v+1)} />
      {!rows && !error && <LoadingState className="text-sm text-slate-500">{c('loading')}</LoadingState>}
      {rows?.length === 0 && <p className="text-sm text-slate-500">{c('noOwnedBusiness')}</p>}
      {business && <div key={business.id} className="space-y-5"><h2 className="text-lg font-bold">{business.name}</h2>{business.suspended && <p className="text-sm text-slate-600">{c('suspendedBillingHint')}</p>}<PaidAccess businessId={business.id} {...{api,lang}}/><Cancellation businessId={business.id} {...{api,c,lang}} /><Receipts businessId={business.id} timezone={business.timezone} {...{api,c,lang}} /></div>}
     </PageLayout>
    </PageContainer>
  </div>;
}
