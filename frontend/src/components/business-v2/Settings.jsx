import { OwnerPinSettings, OwnerPinUnlock } from './OwnerPin';
import BusinessBackup from './BusinessBackup';
import DangerZone from './DangerZone';
import ServiceRequests from './ServiceRequests';
import Select from './SettingsSelect';
import { useLanguage } from '../../context/LanguageContext';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import FifoSettings from './FifoSettings';
import { useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { Feedback, panelClass, primaryClass } from './UI';
const countryCurrencies = {SY:'SYP',AE:'AED',SA:'SAR',QA:'QAR',OM:'OMR',JO:'JOD',LB:'LBP',IQ:'IQD',KW:'KWD',BH:'BHD',EG:'EGP',YE:'YER',TR:'TRY',US:'USD',GB:'GBP',DE:'EUR',FR:'EUR',ES:'EUR',IT:'EUR',NL:'EUR',AT:'EUR',BE:'EUR',IE:'EUR',PT:'EUR',GR:'EUR',FI:'EUR',CY:'EUR'};
const countries = Object.keys(countryCurrencies);
const regionalTimezones = {SY:'Asia/Damascus',AE:'Asia/Dubai',LB:'Asia/Beirut',JO:'Asia/Amman',SA:'Asia/Riyadh',QA:'Asia/Qatar',OM:'Asia/Muscat'};
const currencies = ['USD','EUR','GBP','SAR','AED','EGP','SYP','JOD','IQD','LBP','KWD','QAR','BHD','OMR','YER','TRY'];
export default function Settings({ context, api, c, reload, onName, lang, initialSetup = false, onSetupComplete, pinLocked, onPinStatus }) {
  const { business, permissions } = context;
  const { setLang } = useLanguage();
  const [form, setForm] = useState(() => initialSetup && business.timezone === 'UTC'
    ? { ...business, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } : business), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
 const draft=useLocalDraft(`business-settings:${business.revision}`,{form},saved=>{setForm(saved.form);});
  const editable = permissions['business.edit'];
  const syria = form.countryCode === 'SY';
  const countryNames = new Intl.DisplayNames([lang === 'ar' ? 'ar' : 'en'], {type:'region'});
  const changeCountry = event => {
    const countryCode = event.target.value || null;
    setForm(f => ({...f, countryCode, ...(countryCode === 'SY' ? {salesTaxRate:'0'} : {}), ...(initialSetup && regionalTimezones[countryCode] ? {timezone:regionalTimezones[countryCode]} : {}), ...(countryCode && (initialSetup || !['USD',countryCurrencies[countryCode]].includes(f.baseCurrency)) ? {baseCurrency:countryCurrencies[countryCode]} : {})}));
  };
  const set = key => event => setForm(f => ({ ...f, [key]: event.target.value }));
  const save = async event => {
    event.preventDefault();
    if (initialSetup && !form.countryCode) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { revision, name, baseCurrency, timezone, dateFormat, numberFormat, salesTaxRate, countryCode } = form;
      const updated = await api(`/businesses/${business.id}`, { method: 'PATCH', body: { revision, name, baseCurrency, timezone, dateFormat, numberFormat, salesTaxRate: syria ? '0' : salesTaxRate, countryCode: countryCode ?? null } });
      setForm(updated); onName(updated.name); draft.clear();setNotice('saved');
      if (initialSetup) onSetupComplete();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="space-y-5">{!initialSetup && <FifoSettings {...{context,api,c,lang}}/>}<form className={`${panelClass} space-y-5 max-w-3xl`} onSubmit={save}>
    <h2 className="text-lg font-bold text-slate-900">{initialSetup ? (lang === 'ar' ? 'أكمل إعداد نشاطك التجاري' : 'Set up your business') : c('settings')}</h2>
    {initialSetup && <p className="text-sm leading-relaxed text-slate-600">{lang === 'ar' ? 'اختر الدولة والعملة والمنطقة الزمنية لتسجيل معاملاتك. بعد الحفظ، سيساعدك دليل البداية على ترتيب تبويباتك وإضافة أول موقع.' : 'Choose your country, currency, and time zone for your records. After saving, the setup guide will help you arrange your tabs and add your first location.'}</p>}
    <div className="max-w-sm"><Select id="settings-language" label={lang === 'ar' ? 'لغة العرض' : 'Display language'} value={lang} onChange={event => setLang(event.target.value, false)}><option value="ar">العربية</option><option value="en">English</option></Select><p className="text-xs text-slate-500 mt-1.5">{lang === 'ar' ? 'تُطبّق فوراً وتُحفظ في هذا المتصفح.' : 'Applies immediately and is saved in this browser.'}</p></div>
    {!editable && <p className="text-sm text-slate-500">{c('readOnly')}</p>}
    <LocalDraftNotice {...{draft,lang,busy}}/><Feedback error={error} notice={notice} c={c} retry={reload} />
    <fieldset disabled={!editable || busy || error === 'REVISION_CONFLICT'} className="grid sm:grid-cols-2 gap-5 disabled:opacity-75">
      <div className="sm:col-span-2"><Field id="business-name" label={c('business')} placeholder={c('businessPlaceholder')} value={form.name} onChange={set('name')} minLength={2} maxLength={120} required /></div>
      <div className="sm:col-span-2"><Select id="business-country" label={c('country')} value={form.countryCode ?? ''} onChange={changeCountry}><option value="">{c('chooseCountry')}</option>{countries.map(code=><option key={code} value={code}>{countryNames.of(code)}</option>)}</Select></div>
      <div><Select id="business-currency" label={c('currency')} value={form.baseCurrency} onChange={set('baseCurrency')}>{(form.countryCode ? [...new Set([countryCurrencies[form.countryCode],'USD'])] : currencies).map(v => <option key={v}>{v}</option>)}</Select><p className="text-xs text-slate-500 mt-1.5">{c('currencyHint')}</p></div>
      {syria ? <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800" role="status">{c('syriaTaxDisabled')}</div> : <div><Field id="business-tax" label={c('salesTaxRate')} type="number" dir="ltr" min="0" max="100" step="0.0001" value={form.salesTaxRate ?? '0'} onChange={set('salesTaxRate')} required aria-describedby="business-tax-hint" /><p id="business-tax-hint" className="text-xs text-slate-500 mt-1.5">{c('salesTaxHint')}</p></div>}
      <Field id="business-timezone" label={c('timezone')} placeholder={c('timezonePlaceholder')} dir="ltr" value={form.timezone} onChange={set('timezone')} maxLength={80} required />
      <Select id="business-date" label={c('dateFormat')} value={form.dateFormat} onChange={set('dateFormat')}>{[['dmy','31/12/2026'],['mdy','12/31/2026'],['ymd','2026-12-31']].map(([v,text]) => <option key={v} value={v}>{text}</option>)}</Select>
      <Select id="business-number" label={c('numberFormat')} value={form.numberFormat} onChange={set('numberFormat')}>{[['western','1,234.56'],['european','1.234,56'],['arabic','١٬٢٣٤٫٥٦']].map(([v,text]) => <option key={v} value={v}>{text}</option>)}</Select>
    </fieldset>
    {editable && <button className={primaryClass} disabled={busy || error === 'REVISION_CONFLICT' || (initialSetup && !form.countryCode)}>{busy ? c('saving') : initialSetup ? (lang === 'ar' ? 'بدء العمل' : 'Get started') : c('save')}</button>}
  </form>{!initialSetup && <ServiceRequests {...{context,api,lang}}/>}{!initialSetup && editable && context.role === 'OWNER' && <>
      <OwnerPinSettings {...{context,api,c,lang,onPinStatus}} />
      {pinLocked ? <OwnerPinUnlock {...{context,api,c,lang,onPinStatus}} /> :
        <><BusinessBackup {...{context,api,c,lang}}/><DangerZone {...{context,api,c,lang,reload}}/></>}
    </>}</div>;
}
