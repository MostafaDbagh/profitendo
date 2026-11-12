import TabPreferences from '../components/business-v2/TabPreferences';
import Dashboard from '../components/business-v2/Dashboard';
import Security from '../components/business-v2/Security';
import Adjustments from '../components/completion-v2/Adjustments';
import Payments from '../components/completion-v2/Payments';
import Reports from '../components/completion-v2/Reports';
import Migration from '../components/completion-v2/Migration';
import Sales from '../components/sales-v2/Sales';
import Transfers from '../components/transfers-v2/Transfers';
import Inventory from '../components/operations-v2/Inventory';
import Suppliers from '../components/operations-v2/Suppliers';
import Purchases from '../components/operations-v2/Purchases';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Settings as SettingsIcon, Package, ShoppingBag, Boxes, Receipt, Building2, Users, ShieldCheck, Mail, History, ArrowLeftRight, ShoppingCart, RotateCcw, ClipboardCheck, Wallet, BarChart3, Upload } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { Seo } from '../components/Seo';
import { businessCopy } from '../components/business-v2/copy';
import { useBusinessApi, useResource } from '../components/business-v2/useBusinessApi';
import { Feedback, Select, buttonClass } from '../components/business-v2/UI';
import Subscription from '../components/billing-v2/Subscription';
import Settings from '../components/business-v2/Settings';
import Locations from '../components/business-v2/Locations';
import Catalogue from '../components/catalogue-v2/Catalogue';
import Team from '../components/business-v2/Team';
import { Audit, Invitations, Roles } from '../components/business-v2/Records';
const sections = [ ['dashboard',null,BarChart3], ['reports','reports.view',BarChart3], ['catalogue','catalogue.view',Package], ['sales','sales.view',ShoppingCart], ['purchases','purchasing.view',ShoppingBag], ['inventory','inventory.view',Boxes], ['returns','returns.view',RotateCcw], ['expenses','payments.view',Receipt], ['payments','payments.view',Wallet], ['counts','counts.view',ClipboardCheck], ['migration','migration.manage',Upload], ['transfers','transfers.view',ArrowLeftRight], ['suppliers','suppliers.view',Users], ['locations','locations.view',Building2], ['billing','billing.manage',ShieldCheck], ['team','team.view',Users], ['roles','roles.view',ShieldCheck], ['invitations','invitations.manage',Mail], ['audit','audit.view',History], ['security',null,ShieldCheck], ['settings','business.view',SettingsIcon] ];
function BusinessWorkspace({ businessId, api, c, lang, onName }) {
  const { data: context, error, reload } = useResource(api, `/businesses/${businessId}`);
  const [params,setParams]=useSearchParams();
  const [savedPreferences,setSavedPreferences]=useState(null);
  const section=params.get('tab')||'dashboard',setSection=tab=>setParams({tab});
  useEffect(() => { if (context) onName(context.business.name); }, [context, onName]);
  if (!context) return <div className="p-5"><Feedback error={error} c={c} retry={reload} />{!error && <p role="status">{c('loading')}</p>}</div>;
  const tabOrder = savedPreferences?.tabOrder ?? context.tabOrder ?? [];
  const orderedSections = [...sections].sort((a,b) => {const rank = key => tabOrder.includes(key) ? tabOrder.indexOf(key) : tabOrder.length + sections.findIndex(([id])=>id===key);const bottom = ['security','settings'];if(bottom.includes(a[0])||bottom.includes(b[0]))return (bottom.includes(a[0])?100+bottom.indexOf(a[0]):0)-(bottom.includes(b[0])?100+bottom.indexOf(b[0]):0);return rank(a[0])-rank(b[0]);});
  const availableTabs = orderedSections.filter(([, permission]) => !permission||context.permissions[permission]);
  const hiddenTabs = savedPreferences?.hiddenTabs ?? context.hiddenTabs ?? [];
  const visible = availableTabs.filter(([key]) => ['dashboard','security','settings'].includes(key) || !hiddenTabs.includes(key));
  const current = visible.some(([key]) => key === section) ? section : 'dashboard';
  const Component = { dashboard:Dashboard,security:Security, reports:Reports, returns:Adjustments, counts:Adjustments, payments:Payments, expenses:Payments, migration:Migration, sales:Sales, transfers:Transfers, inventory:Inventory, suppliers:Suppliers, purchases:Purchases, catalogue: Catalogue, locations: Locations, billing: Subscription, settings: Settings, team: Team, roles: Roles, invitations: Invitations, audit: Audit }[current];
  return <div className="md:flex min-w-0">
    <nav aria-label={c('title')} className="md:w-72 shrink-0 bg-white border-b md:border-b-0 md:border-e border-slate-200 p-4 md:p-6"><div className="flex flex-wrap md:flex-col gap-2">{visible.map(([key, , Icon]) => <button key={key} type="button" aria-current={current === key ? 'page' : undefined} onClick={() => setSection(key)} className={`flex items-center gap-3 text-start px-4 py-3 rounded-xl border text-sm font-medium focus-visible:ring-2 focus-visible:ring-emerald-500 ${key === 'security' ? 'mt-4 border-t border-slate-200' : ''} ${current === key ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'text-slate-600 border-transparent hover:bg-slate-50'}`}><Icon className="w-5 h-5" aria-hidden="true" />{c(key)}</button>)}</div></nav>
    <main className="flex-1 min-w-0 px-4 py-6 md:p-8"><div className="max-w-7xl mx-auto"><div className="space-y-6">{current==='settings'&&<TabPreferences {...{context,api,c,lang,availableTabs,hiddenTabs,tabOrder}} onTabsSaved={setSavedPreferences}/>}<Component visibleTabs={visible.map(([key])=>key)} onSection={setSection} mode={current} key={`${current}-${context.business.revision}`} {...{ context, api, c, lang, reload, onName }} /></div></div></main>
  </div>;
}
export default function BusinessV2() {
  const [params]=useSearchParams();
  const { lang, setLang } = useLanguage(), navigate = useNavigate(), api = useBusinessApi();
  const c = (key, fallback = 'failed') => businessCopy[lang]?.[key] || businessCopy.en[key] || businessCopy[lang]?.[fallback] || businessCopy.en[fallback];
  const [businesses, setBusinesses] = useState(null), [selected, setSelected] = useState(''), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const onName = useCallback(name => setBusinesses(rows => rows?.map(b => b.id === selected ? { ...b, name } : b)), [selected]);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setBusinesses(null);
    (async () => {
      const session = await api('/auth/me', { signal: controller.signal });
      if (session.stage !== 'authenticated') { navigate('/auth-v2', { replace: true }); return; }
      const rows = await api('/businesses', { signal: controller.signal });
      if (!controller.signal.aborted) { setBusinesses(rows); setSelected(old => rows.some(b => b.id === old) ? old : rows[0]?.id || ''); }
    })().catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [api, navigate, version]);
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <Seo title={`${c('title')} | ProfitLens`} path="/business-v2" noindex />
    <header className="bg-white border-b border-slate-200 px-4 md:px-8 py-4 flex flex-wrap items-center justify-between gap-3"><span className="font-bold text-lg">ProfitLens</span><div className="flex flex-wrap gap-2">{businesses?.length === 0 && <Link className={buttonClass} to="/business-v2?tab=security">{c('security')}</Link>}<button className={buttonClass} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar', false)}>{c('language')}</button></div></header>
    <div className="px-4 md:px-8 py-6 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl md:text-3xl font-bold">{c('dashboard')}</h1><p className="text-sm text-slate-500 mt-2">{c('subtitle')}</p></div>{businesses?.length > 0 && <div className="w-full sm:w-72"><Select id="active-business" label={c('chooseBusiness')} value={selected} onChange={e => setSelected(e.target.value)}>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></div>}</div>
    <div className="px-4 md:px-8"><Feedback error={error} c={c} retry={() => setVersion(v => v + 1)} /></div>
    {!businesses && !error && <p role="status" className="px-4 md:px-8 text-sm text-slate-500">{c('loading')}</p>}
    {businesses?.length === 0 && params.get('tab')==='security'&&<main className="p-4 md:p-8 max-w-5xl mx-auto"><Security {...{api,lang}}/></main>}
    {businesses?.length === 0 && params.get('tab')!=='security' && <div className="px-4 md:px-8 space-y-4"><p className="text-sm text-slate-500">{c('noBusiness')}</p><Link className={buttonClass} to="/billing-v2">{lang==='ar'?'الفوترة وإلغاء الاشتراك':'Billing and cancellation'}</Link><Link className={`${buttonClass} ms-2`} to="/contact">{lang==='ar'?'تواصل معنا':'Contact Us'}</Link></div>}
    {businesses?.some(b => b.id === selected) && <BusinessWorkspace key={selected} businessId={selected} {...{ api, c, lang }} onName={onName} />}
  </div>;
}
