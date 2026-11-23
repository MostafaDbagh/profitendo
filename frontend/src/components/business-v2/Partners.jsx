import { useRef, useState } from 'react';
import { Handshake, Plus } from 'lucide-react';
import { Field, inputClass } from '../auth-v2/Fields';
import { buttonClass, Feedback, Modal, Pager, panelClass, primaryClass, Select, Table } from './UI';
import { useResource } from './useBusinessApi';

const currencies = ['USD','EUR','GBP','SAR','AED','EGP','SYP','JOD','IQD','LBP','KWD','QAR','BHD','OMR','YER','TRY'];
const kinds = ['ALLOCATION', 'CONTRIBUTION', 'WITHDRAWAL'];
const decimal = '(0|[1-9][0-9]{0,13})([.][0-9]{1,4})?';
const labels = {
  en: {
    title:'Partners', add:'Add partner', edit:'Edit partner', empty:'No partners yet', name:'Name', ownership:'Ownership (%)',
    capital:'Paid-in capital', currency:'Currency', notes:'Notes', status:'Status', active:'Active', inactive:'Inactive',
    history:'Partner transactions', record:'Record transaction', kind:'Type', day:'Date', amount:'Amount', balance:'Transaction balance',
    intro:'Track ownership, capital, and transactions for each business partner.',
    entryHint:'This records a partner transaction in the partner ledger only.',
    ALLOCATION:'Profit allocation', CONTRIBUTION:'Capital contribution', WITHDRAWAL:'Withdrawal',
    PARTNER_CURRENCY_LOCKED:'Currency cannot change after a transaction is recorded.',
    PARTNER_INACTIVE:'Reactivate this partner before recording a transaction.',
  },
  ar: {
    title:'الشركاء', add:'إضافة شريك', edit:'تعديل الشريك', empty:'لا يوجد شركاء بعد', name:'الاسم', ownership:'نسبة الملكية (%)',
    capital:'رأس المال المدفوع', currency:'العملة', notes:'الملاحظات', status:'الحالة', active:'نشط', inactive:'غير نشط',
    history:'حركات الشريك', record:'تسجيل حركة', kind:'النوع', day:'التاريخ', amount:'المبلغ', balance:'رصيد الحركات',
    intro:'تابع نسب الملكية ورأس المال والحركات لكل شريك في النشاط.',
    entryHint:'تُسجّل هذه الحركة في سجل الشريك فقط.',
    ALLOCATION:'توزيع أرباح', CONTRIBUTION:'مساهمة في رأس المال', WITHDRAWAL:'سحب',
    PARTNER_CURRENCY_LOCKED:'لا يمكن تغيير العملة بعد تسجيل حركة للشريك.',
    PARTNER_INACTIVE:'أعد تفعيل الشريك قبل تسجيل حركة.',
  },
};

function Notes({ text, value, onChange }) {
  return <label className="block space-y-1.5 text-sm font-medium text-slate-700">
    <span>{text}</span>
    <textarea className={inputClass} rows={3} maxLength={2000} {...{value, onChange}} />
  </label>;
}

function FormActions({busy, close, c}) {
  return <div className="flex flex-wrap justify-end gap-2">
    <button type="button" disabled={busy} className={buttonClass} onClick={close}>{c('cancel')}</button>
    <button type="submit" disabled={busy} className={primaryClass}>{c(busy ? 'saving' : 'save')}</button>
  </div>;
}

function PartnerForm({ partner, context, api, path, c, lang, text, close, done, returnFocus }) {
  const [form, setForm] = useState(() => ({
    name: partner?.name ?? '', ownership: partner?.ownership ?? '0', capital: partner?.capital ?? '0',
    currency: partner?.currency ?? context.business.baseCurrency, notes: partner?.notes ?? '', active: partner?.active ?? true,
  }));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const set = key => event => setForm(value => ({ ...value, [key]: event.target.value }));
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(partner ? `${path}/${partner.id}` : path, {
        method: partner ? 'PATCH' : 'POST', body: { ...form, ...(partner && { revision: partner.revision }) },
      });
      done();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Modal {...{c, lang, close, busy, returnFocus}} title={partner ? text.edit : text.add} description={text.intro}>
    <form className="space-y-4" onSubmit={save}>
      <Feedback error={error} c={c} />
      <fieldset disabled={busy} className="space-y-4">
        <Field id="partner-name" label={text.name} value={form.name} onChange={set('name')} required maxLength={120} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="partner-ownership" label={text.ownership} type="number" min="0" max="100" step="0.0001" value={form.ownership} onChange={set('ownership')} required />
          <Field id="partner-capital" label={text.capital} value={form.capital} onChange={set('capital')} dir="ltr" inputMode="decimal" pattern={decimal} required />
          <Select id="partner-currency" label={text.currency} value={form.currency} onChange={set('currency')}>{currencies.map(currency => <option key={currency}>{currency}</option>)}</Select>
          <Select id="partner-status" label={text.status} value={String(form.active)} onChange={event => setForm(value => ({ ...value, active: event.target.value === 'true' }))}>
            <option value="true">{text.active}</option><option value="false">{text.inactive}</option>
          </Select>
        </div>
        <Notes text={text.notes} value={form.notes} onChange={set('notes')} />
      </fieldset>
      <FormActions {...{c, close, busy}} />
    </form>
  </Modal>;
}

function TransactionForm({ path, api, partner, timezone, c, lang, text, close, done, returnFocus }) {
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const [form, setForm] = useState({ kind: 'ALLOCATION', amount: '', day: today, notes: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(null);
  const set = key => event => setForm(value => ({ ...value, [key]: event.target.value }));
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const signature = JSON.stringify(form);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    try {
      await api(path, { method:'POST', body:{ ...form, clientKey: request.current.key } });
      done();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Modal {...{c, lang, close, busy, returnFocus}} title={text.record} description={text.entryHint}>
    <form className="space-y-4" onSubmit={save}>
      <Feedback error={error} c={c} />
      <fieldset disabled={busy} className="space-y-4">
        <Select id="partner-transaction-kind" label={text.kind} value={form.kind} onChange={set('kind')}>
          {kinds.map(kind => <option key={kind} value={kind}>{text[kind]}</option>)}
        </Select>
        <Field id="partner-transaction-amount" label={`${text.amount} (${partner.currency})`} value={form.amount} onChange={set('amount')} dir="ltr" inputMode="decimal" pattern={decimal} required />
        <Field id="partner-transaction-date" type="date" label={text.day} value={form.day} onChange={set('day')} required />
        <Notes text={text.notes} value={form.notes} onChange={set('notes')} />
      </fieldset>
      <FormActions {...{c, close, busy}} />
    </form>
  </Modal>;
}

function PartnerHistory({ id, path, context, api, c, lang, text, close }) {
  const [page, setPage] = useState(1), [adding, setAdding] = useState(false);
  const trigger = useRef(null);
  const { data, error, reload } = useResource(api, `${path}/${id}/transactions?page=${page}`);
  const partner = data?.partner;
  return <section className="space-y-4">
    <button type="button" className={buttonClass} onClick={close}>{c('back')}</button>
    <Feedback error={error} retry={reload} c={c} />
    {!data && !error && <p role="status">{c('loading')}</p>}
    {data && <>
      <div className={`${panelClass} flex flex-wrap items-start justify-between gap-3`}>
        <div className="min-w-0">
          <h2 className="break-words text-lg font-bold">{partner.name}</h2>
          <p className="mt-1 text-sm text-slate-600">{text.balance} <bdi>{data.balance} {partner.currency}</bdi></p>
        </div>
        {partner.active && <button ref={trigger} type="button" className={primaryClass} onClick={() => setAdding(true)}>{text.record}</button>}
      </div>
      <Table tools={false} headers={['day','kind','amount','notes']} empty={!data.items.length} c={c}>
        {data.items.map(entry => <tr key={entry.id}>
          <td className="whitespace-nowrap p-4"><bdi>{entry.day}</bdi></td><td className="p-4">{text[entry.kind]}</td>
          <td className="whitespace-nowrap p-4"><bdi>{entry.amount} {partner.currency}</bdi></td><td className="p-4">{entry.notes}</td>
        </tr>)}
      </Table>
      <Pager {...{data, setPage, c}} />
      {adding && <TransactionForm {...{api,c,lang,text,partner}} timezone={context.business.timezone} path={`${path}/${id}/transactions`}
        returnFocus={trigger.current} close={() => setAdding(false)} done={() => {setAdding(false); setPage(1); reload();}} />}
    </>}
  </section>;
}

export default function Partners({ context, api, c, lang }) {
  const text = labels[lang === 'ar' ? 'ar' : 'en'];
  const t = key => text[key] ?? c(key);
  const path = `/businesses/${context.business.id}/partners`;
  const [page, setPage] = useState(1), [form, setForm] = useState(null), [selected, setSelected] = useState(null);
  const trigger = useRef(null);
  const { data, error, reload } = useResource(api, `${path}?page=${page}`);
  function open(event, partner = null) {
    trigger.current = event.currentTarget;
    setForm({partner});
  }
  if (selected) return <PartnerHistory id={selected} {...{path,context,api,lang,text}} c={t} close={() => {setSelected(null); reload();}} />;
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-bold">{text.title}</h2></div>
      <button type="button" className={primaryClass} onClick={openAdd => open(openAdd)}><Plus className="h-4 w-4" aria-hidden="true" />{text.add}</button>
    </div>
    <Feedback error={error} retry={reload} c={t} />
    {!data && !error && <p role="status">{c('loading')}</p>}
    {data && (data.items.length === 0 ? <div className={`${panelClass} grid justify-items-center gap-4 py-14 text-center`}>
      <span className="rounded-xl bg-emerald-50 p-4 text-emerald-700"><Handshake className="h-6 w-6" aria-hidden="true" /></span>
      <p className="font-semibold">{text.empty}</p>
    </div> : <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {data.items.map(partner => <li key={partner.id} className={`${panelClass} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="break-all font-semibold">{partner.name}</h3>
          <span className={`rounded-full px-2 py-1 text-xs ${partner.active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{t(partner.active ? 'active' : 'inactive')}</span>
        </div>
        <dl className="space-y-1 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><dt>{text.ownership}</dt><dd><bdi>{partner.ownership}%</bdi></dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt>{text.capital}</dt><dd><bdi>{partner.capital} {partner.currency}</bdi></dd></div>
        </dl>
        {partner.notes && <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{partner.notes}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => setSelected(partner.id)}>{text.history}</button>
          <button type="button" className={buttonClass} onClick={event => open(event, partner)}>{text.edit}</button>
        </div>
      </li>)}
    </ul>)}
    {data?.total > data?.pageSize && <Pager {...{data,setPage}} c={t} />}
    {form && <PartnerForm partner={form.partner} {...{context,path,api,lang,text}} c={t} returnFocus={trigger.current}
      close={() => setForm(null)} done={() => {setForm(null); reload();}} />}
  </section>;
}
