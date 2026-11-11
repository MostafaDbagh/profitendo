import { useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { Feedback, Select, panelClass, primaryClass } from './UI';
const currencies = ['USD','EUR','GBP','SAR','AED','EGP','SYP','JOD','IQD','LBP','KWD','QAR','BHD','OMR','YER','TRY'];
export default function Settings({ context, api, c, reload, onName }) {
  const { business, permissions } = context;
  const [form, setForm] = useState(business), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const editable = permissions['business.edit'];
  const set = key => event => setForm(f => ({ ...f, [key]: event.target.value }));
  const save = async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const { revision, name, baseCurrency, timezone, dateFormat, numberFormat } = form;
      const updated = await api(`/businesses/${business.id}`, { method: 'PATCH', body: { revision, name, baseCurrency, timezone, dateFormat, numberFormat } });
      setForm(updated); onName(updated.name); setNotice('saved');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <form className={`${panelClass} space-y-5 max-w-3xl`} onSubmit={save}>
    <h2 className="text-lg font-bold text-slate-900">{c('settings')}</h2>
    {!editable && <p className="text-sm text-slate-500">{c('readOnly')}</p>}
    <Feedback error={error} notice={notice} c={c} retry={reload} />
    <fieldset disabled={!editable || busy || error === 'REVISION_CONFLICT'} className="grid sm:grid-cols-2 gap-5 disabled:opacity-75">
      <div className="sm:col-span-2"><Field id="business-name" label={c('business')} placeholder={c('businessPlaceholder')} value={form.name} onChange={set('name')} minLength={2} maxLength={120} required /></div>
      <div><Select id="business-currency" label={c('currency')} value={form.baseCurrency} onChange={set('baseCurrency')} disabled={!!business.currencyLockedAt}>{currencies.map(v => <option key={v}>{v}</option>)}</Select><p className="text-xs text-slate-500 mt-1.5">{c('currencyHint')}</p></div>
      <Field id="business-timezone" label={c('timezone')} placeholder={c('timezonePlaceholder')} dir="ltr" value={form.timezone} onChange={set('timezone')} maxLength={80} required />
      <Select id="business-date" label={c('dateFormat')} value={form.dateFormat} onChange={set('dateFormat')}>{[['dmy','31/12/2026'],['mdy','12/31/2026'],['ymd','2026-12-31']].map(([v,text]) => <option key={v} value={v}>{text}</option>)}</Select>
      <Select id="business-number" label={c('numberFormat')} value={form.numberFormat} onChange={set('numberFormat')}>{[['western','1,234.56'],['european','1.234,56'],['arabic','١٬٢٣٤٫٥٦']].map(([v,text]) => <option key={v} value={v}>{text}</option>)}</Select>
    </fieldset>
    {editable && <button className={primaryClass} disabled={busy || error === 'REVISION_CONFLICT'}>{c(busy ? 'saving' : 'save')}</button>}
  </form>;
}
