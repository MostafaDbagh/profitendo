import { OwnerPinUnlock } from '../components/business-v2/OwnerPin';
import ChartAccounts from '../components/business-v2/ChartAccounts';
import Partners from '../components/business-v2/Partners';
import GettingStarted from '../components/business-v2/GettingStarted';
import { cashierTabs } from '../components/business-v2/cashierTabs';
import * as Dialog from '@radix-ui/react-dialog';
import { DraftScope } from '../lib/localDraft';
import { UpgradeContext } from '../components/business-v2/UI';
import SubscriptionNotice from '../components/business-v2/SubscriptionNotice';
import {useTabScroll} from '../hooks/useTabScroll';
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
import { Settings as SettingsIcon, Package, ShoppingBag, Boxes, Receipt, Building2, Users, ShieldCheck, LogOut, History, ArrowLeftRight, ShoppingCart, RotateCcw, ClipboardCheck, Wallet, BarChart3, Upload, BookOpen, Menu, X, TrendingUp, Handshake } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { Seo } from '../components/Seo';
import { businessCopy } from '../components/business-v2/copy';
import { useBusinessApi, useResource } from '../components/business-v2/useBusinessApi';
import { Feedback, buttonClass } from '../components/business-v2/UI';
import Subscription from '../components/billing-v2/Subscription';
import Settings from '../components/business-v2/Settings';
import Locations from '../components/business-v2/Locations';
import Catalogue from '../components/catalogue-v2/Catalogue';
import Team from '../components/business-v2/Team';
import { Audit, Roles } from '../components/business-v2/Records';
const sections = [ ['dashboard',null,BarChart3], ['guidance',null,BookOpen], ['reports','reports.view',BarChart3], ['catalogue','catalogue.view',Package], ['sales','sales.view',ShoppingCart], ['purchases','purchasing.view',ShoppingBag], ['inventory','inventory.view',Boxes], ['returns','returns.view',RotateCcw], ['expenses','payments.view',Receipt], ['payments','payments.view',Wallet], ['counts','counts.view',ClipboardCheck], ['damage','damage.view',Package], ['migration','migration.manage',Upload], ['transfers','transfers.view',ArrowLeftRight], ['suppliers','suppliers.view',Users], ['partners','business.edit',Handshake], ['accounts','business.edit',BookOpen], ['locations','locations.view',Building2], ['billing','billing.manage',ShieldCheck], ['team','team.view',Users], ['roles','roles.view',ShieldCheck], ['audit','audit.view',History], ['security',null,ShieldCheck], ['settings','business.view',SettingsIcon] ];
function BusinessWorkspace({ businessId, api, c, lang, onName, businessControls }) {
  const { data: loadedContext, error, reload } = useResource(api, `/businesses/${businessId}`);
  const [pinOverride, setPinStatus] = useState(null);
  const [, refreshPinExpiry] = useState(0);
  const ownerPin = pinOverride ?? loadedContext?.ownerPin;
  const pinLocked = Boolean(ownerPin?.enabled && (!ownerPin.unlockedUntil || Date.parse(ownerPin.unlockedUntil) <= Date.now()));
  useEffect(() => {
    const remaining = Date.parse(ownerPin?.unlockedUntil) - Date.now();
    if (remaining > 0) {
      const timer = setTimeout(() => refreshPinExpiry(value => value + 1), remaining + 50);
      return () => clearTimeout(timer);
    }
  }, [ownerPin?.unlockedUntil]);
  const context = loadedContext && {...loadedContext, ownerPin};
  const [params,setParams]=useSearchParams();
  const navigate=useNavigate();
  const [loggingOut,setLoggingOut]=useState(false),[logoutError,setLogoutError]=useState('');
  async function logout(){if(loggingOut)return;setLoggingOut(true);setLogoutError('');try{await api('/auth/logout',{method:'POST',body:{}});navigate('/auth-v2',{replace:true});}catch(e){setLogoutError(e.message);}finally{setLoggingOut(false);}}
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = event => { if (event.matches) setMenuOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
  const [savedPreferences,setSavedPreferences]=useState(null);
  const section=params.get('tab')||'dashboard',setSection=(tab, action)=>{setMenuOpen(false);setParams(action ? {tab, action} : {tab});requestScroll();};
  const {contentRef,requestScroll}=useTabScroll(section);
  const businessName = loadedContext?.business.name;
  useEffect(() => { if (businessName) onName(businessName); }, [businessName, onName]);
  if (!context) return <div className="p-5"><Feedback error={error} c={c} retry={reload} />{!error && <p role="status">{c('loading')}</p>}</div>;
  if (context.business.initialSetupPending && context.role === 'OWNER' && context.permissions['business.edit']) {
    return <DraftScope.Provider value={{...context, lang}}>
      <main dir={lang === 'ar' ? 'rtl' : 'ltr'} className="mx-auto max-w-xl px-4 py-8 sm:py-12">
        <div className="mb-6 flex items-center justify-center gap-3 text-xl font-bold">
          <span className="rounded-xl bg-emerald-600 p-2.5 text-white"><TrendingUp className="h-6 w-6" aria-hidden="true" /></span>
          <span dir="ltr">ProfitLens</span>
        </div>
        <Settings key={context.business.revision} {...{context, api, c, reload, onName, lang}} initialSetup
          onSetupComplete={() => { setSection('guidance'); reload(); }} />
        <div className="mt-4 flex justify-center">
          <button type="button" className={buttonClass} onClick={logout} disabled={loggingOut}>{c('logout')}</button>
        </div>
        <Feedback error={logoutError} c={c} />
      </main>
    </DraftScope.Provider>;
  }
  const tabOrder = savedPreferences?.tabOrder ?? context.tabOrder ?? [];
  const orderedSections = [...sections].sort((a,b) => {const rank = key => tabOrder.includes(key) ? tabOrder.indexOf(key) : key==='damage'&&tabOrder.includes('counts') ? tabOrder.indexOf('counts')+0.5 : tabOrder.length + sections.findIndex(([id])=>id===key);const bottom = ['security','settings'];if(bottom.includes(a[0])||bottom.includes(b[0]))return (bottom.includes(a[0])?100+bottom.indexOf(a[0]):0)-(bottom.includes(b[0])?100+bottom.indexOf(b[0]):0);return rank(a[0])-rank(b[0]);});
  const availableTabs = orderedSections.filter(([key, permission]) => (!['partners','accounts'].includes(key) || context.role === 'OWNER') && (!permission || context.permissions[permission]));
  const hiddenTabs = savedPreferences?.hiddenTabs ?? context.hiddenTabs ?? [];
  const ownerAsCashier = context.role === 'OWNER' && (savedPreferences?.ownerAsCashier ?? context.ownerAsCashier ?? false);
  const visible = availableTabs.filter(([key]) => ['dashboard','guidance','billing','security','settings'].includes(key) || (ownerAsCashier && cashierTabs.includes(key)) || !hiddenTabs.includes(key));
  const current = visible.some(([key]) => key === section) ? section : 'dashboard';
  const initialAction = current === section ? params.get('action') : null;
  const Component = { dashboard:Dashboard,guidance:GettingStarted,security:Security, reports:Reports, returns:Adjustments, counts:Adjustments, damage:Adjustments, payments:Payments, expenses:Payments, migration:Migration, sales:Sales, transfers:Transfers, inventory:Inventory, suppliers:Suppliers, partners:Partners, accounts:ChartAccounts, purchases:Purchases, catalogue: Catalogue, locations: Locations, billing: Subscription, settings: Settings, team: Team, roles: Roles, audit: Audit }[current];
  const ar = lang === 'ar';
  const direction = ar ? 'rtl' : 'ltr';
  const menuLabel = ar ? 'قائمة التنقل' : 'Navigation menu';
  const iconButton = 'inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-emerald-500';
  const items = visible.map(([key, , Icon]) => (
    <button key={key} type="button" aria-current={current === key ? 'page' : undefined} onClick={() => setSection(key)}
      className={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-start text-sm font-medium focus-visible:ring-2 focus-visible:ring-emerald-500 ${current === key ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}>
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{c(key)}</span>
    </button>
  ));
  const logoutButton = (
    <button type="button" disabled={loggingOut} onClick={logout}
      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-100 px-3 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50">
      <LogOut className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />{c('logout')}
    </button>
  );

  return <DraftScope.Provider value={{...context,lang}}><UpgradeContext.Provider value={{canUpgrade:!!context.permissions['billing.manage'],onUpgrade:()=>setSection('billing'),lang}}>
    <div dir={direction} className="min-w-0 lg:flex">
      <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <header className="sticky top-0 z-30 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center border-b border-slate-200 bg-white px-3 py-1.5 lg:hidden">
          <Dialog.Trigger asChild>
            <button type="button" className={iconButton} aria-label={menuLabel}><Menu className="h-5 w-5" aria-hidden="true" /></button>
          </Dialog.Trigger>
          <span dir="ltr" className="truncate text-center font-bold text-emerald-800">ProfitLens</span>
          <button type="button" disabled={loggingOut} onClick={logout} className={iconButton} aria-label={c('logout')}>
            <LogOut className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
          </button>
        </header>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40 lg:hidden" />
          <Dialog.Content dir={direction} aria-describedby={undefined}
            className={`fixed inset-y-0 start-0 z-50 flex w-[min(82vw,20rem)] flex-col bg-white shadow-xl lg:hidden motion-safe:animate-in ${ar ? 'motion-safe:slide-in-from-right' : 'motion-safe:slide-in-from-left'}`}>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
              <Dialog.Title className="font-bold text-emerald-800">ProfitLens <span className="sr-only">{menuLabel}</span></Dialog.Title>
              <Dialog.Close asChild><button type="button" className={iconButton} aria-label={ar ? 'إغلاق القائمة' : 'Close menu'}><X className="h-5 w-5" aria-hidden="true" /></button></Dialog.Close>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">{businessControls('mobile')}</div>
            <nav aria-label={menuLabel} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3">{items}</nav>
            <div className="shrink-0 border-t border-slate-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{logoutButton}<Feedback error={logoutError} c={c} /></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {logoutError && <div className="px-3 lg:hidden"><Feedback error={logoutError} c={c} /></div>}
      <nav aria-label={menuLabel} className="hidden w-64 shrink-0 flex-col gap-2 border-e border-slate-200 bg-white p-4 lg:flex xl:w-72 xl:p-6">
        {items}{logoutButton}<Feedback error={logoutError} c={c} />
      </nav>
    <main ref={contentRef} tabIndex={-1} className="min-w-0 flex-1 px-3 py-4 outline-none sm:px-5 sm:py-6 xl:p-8"><div className="max-w-7xl mx-auto"><div className="space-y-6"><SubscriptionNotice {...{context,api,lang}} section={current} onSection={setSection}/>{pinLocked && ['payments','expenses','partners','accounts'].includes(current)
      ? <OwnerPinUnlock {...{context,api,c,lang}} onPinStatus={setPinStatus} />
      : <Component pinLocked={pinLocked} onPinStatus={setPinStatus} visibleTabs={visible.map(([key])=>key)} onSection={setSection} mode={current} initialAction={initialAction} key={`${current}-${context.business.revision}-${initialAction ?? ''}`} {...{ context, api, c, lang, reload, onName }} />}{current==='settings'&&<TabPreferences {...{context,api,c,lang,hiddenTabs,tabOrder,ownerAsCashier}} availableTabs={availableTabs.filter(([key])=>key!=='guidance')} onTabsSaved={setSavedPreferences}/>}</div></div></main>
  </div></UpgradeContext.Provider></DraftScope.Provider>;
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
  const hasBusiness = businesses?.some(business => business.id === selected);
  const businessControls = surface => <>
        <button className={`${buttonClass} shrink-0`} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar', false)}>{c('language')}</button>
        {businesses?.length > 0 && <select id={surface === 'desktop' ? 'active-business' : 'active-business-mobile'} aria-label={c('chooseBusiness')} value={selected} onChange={e=>setSelected(e.target.value)} className="min-h-11 min-w-0 max-w-full truncate sm:max-w-64 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs sm:text-sm font-semibold text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer" dir={lang==='ar'?'rtl':'ltr'}>{businesses.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        {businesses?.length===0&&<Link className={buttonClass} to="/business-v2?tab=security">{c('security')}</Link>}
  </>;
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <Seo title={`${c('title')} | ProfitLens`} path="/business-v2" noindex />
    <header dir="ltr" className={`items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-8 ${hasBusiness ? 'hidden lg:flex' : 'flex'}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        {businessControls('desktop')}
      </div>
      <span className="font-bold text-base sm:text-lg shrink-0">ProfitLens</span>
    </header>
    <h1 className="sr-only">{c('title')}</h1>
    <div className="px-4 md:px-8"><Feedback error={error} c={c} retry={() => setVersion(v => v + 1)} /></div>
    {!businesses && !error && <p role="status" className="px-4 md:px-8 text-sm text-slate-500">{c('loading')}</p>}
    {businesses?.length === 0 && params.get('tab')==='security'&&<main className="p-4 md:p-8 max-w-5xl mx-auto"><Security {...{api,lang}}/></main>}
    {businesses?.length === 0 && params.get('tab')!=='security' && <div className="px-4 md:px-8 space-y-4"><p className="text-sm text-slate-500">{c('noBusiness')}</p><Link className={buttonClass} to="/billing-v2">{lang==='ar'?'الفوترة وإلغاء الاشتراك':'Billing and cancellation'}</Link><Link className={`${buttonClass} ms-2`} to="/contact">{lang==='ar'?'تواصل معنا':'Contact Us'}</Link></div>}
    {hasBusiness && <BusinessWorkspace key={selected} businessId={selected} {...{ api, c, lang, businessControls }} onName={onName} />}
  </div>;
}
