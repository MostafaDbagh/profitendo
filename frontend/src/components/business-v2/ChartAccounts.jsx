import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {EmptyState, LoadingState} from '../page-layout/PageResults';
import { useRef, useState } from 'react';
import { BookOpen, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react';
import { Field, inputClass } from '../auth-v2/Fields';
import { buttonClass, Feedback, Modal, primaryClass, Select } from './UI';
import { useResource } from './useBusinessApi';

const groups = ['assets','liabilities','equity','revenue','cost_of_sales','expenses'];
const defaultNature = group => ['assets','cost_of_sales','expenses'].includes(group) ? 'debit' : 'credit';
const copy = {
  en:{
    title:'Chart of Accounts', intro:'Organize the accounts used by your business.', search:'Search by account code or name',
    add:'Add account', edit:'Edit account', name:'Account name', code:'Account code', group:'Account group', nature:'Normal balance',
    assets:'Assets', liabilities:'Liabilities', equity:'Equity', revenue:'Revenue', cost_of_sales:'Cost of Sales', expenses:'Expenses',
    debit:'Debit', credit:'Credit', active:'Active', inactive:'Inactive', activate:'Activate', deactivate:'Deactivate',
    remove:'Delete account', deleteHint:'Remove this account from the chart?', empty:'No accounts yet. Add your first account to get started.', noMatches:'No matching accounts.',
    formHint:'Choose a group and enter the name used in your business.',
    ACCOUNT_CODE_EXISTS:'An account already uses this code.', ACCOUNT_LIMIT_REACHED:'The account limit has been reached.',
  },
  ar:{
    title:'دليل الحسابات', intro:'نظّم الهيكل المحاسبي لحسابات منشأتك.', search:'ابحث برقم الحساب أو اسمه',
    add:'إضافة حساب', edit:'تعديل الحساب', name:'اسم الحساب', code:'رقم الحساب', group:'مجموعة الحساب', nature:'طبيعة الحساب',
    assets:'الأصول', liabilities:'الالتزامات', equity:'حقوق الملكية', revenue:'الإيرادات', cost_of_sales:'تكلفة المبيعات', expenses:'المصاريف',
    debit:'مدين', credit:'دائن', active:'نشط', inactive:'غير نشط', activate:'تفعيل', deactivate:'تعطيل',
    remove:'حذف الحساب', deleteHint:'هل تريد حذف هذا الحساب من الدليل؟', empty:'لا توجد حسابات بعد. أضف حسابك الأول للبدء.', noMatches:'لا توجد حسابات مطابقة.',
    formHint:'اختر مجموعة الحساب وأدخل الاسم المستخدم في منشأتك.',
    ACCOUNT_CODE_EXISTS:'هذا الرقم مستخدم لحساب آخر.', ACCOUNT_LIMIT_REACHED:'بلغت الحد المسموح للحسابات المخصصة.',
  },
};

const iconButton = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-40';

function Nature({ nature, text }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${nature === 'debit' ? 'bg-sky-50 text-sky-800' : 'bg-violet-50 text-violet-800'}`}>{text[nature]}</span>;
}

function AccountForm({ account, text, lang, c, busy, error, close, save, returnFocus }) {
  const [form,setForm] = useState(() => ({
    code:account?.code ?? '', name:account?.name ?? '',
    category:account?.category ?? 'assets', nature:account?.nature ?? 'debit', active:account?.active ?? true,
  }));
  const set = key => event => setForm(value => ({...value,[key]:event.target.value}));
  return <Modal {...{lang,c,busy,close,returnFocus}} title={account ? text.edit : text.add} description={text.formHint}>
    <form className="space-y-4" onSubmit={event => {event.preventDefault();save(form);}}>
      <Feedback {...{error,c}} />
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <Field id="chart-code" label={text.code} value={form.code} onChange={set('code')} disabled={Boolean(account)} required dir="ltr" maxLength={20} pattern={'[A-Za-z0-9\\-]+'} />
        <Field id="chart-name" label={text.name} value={form.name} onChange={set('name')} maxLength={120} required />
        <Select id="chart-group" label={text.group} value={form.category}
          onChange={event => setForm(value => ({...value,category:event.target.value,nature:defaultNature(event.target.value)}))}>
          {groups.map(group => <option key={group} value={group}>{text[group]}</option>)}
        </Select>
        <Select id="chart-nature" label={text.nature} value={form.nature} onChange={set('nature')}>
          {['debit','credit'].map(nature => <option key={nature} value={nature}>{text[nature]}</option>)}
        </Select>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2 rtl:justify-start">
        <button type="submit" className={`${primaryClass} order-last rtl:order-first`} disabled={busy}>{c(busy ? 'saving' : 'save')}</button>
        <button type="button" className={buttonClass} onClick={close} disabled={busy}>{c('cancel')}</button>
      </div>
    </form>
  </Modal>;
}

export default function ChartAccounts({ context, api, c, lang }) {
  const text = copy[lang === 'ar' ? 'ar' : 'en'];
  const t = key => text[key] ?? c(key);
  const path = `/businesses/${context.business.id}/accounts`;
  const {data,error:loadError,reload} = useResource(api,path);
  const [search,setSearch] = useState(''), [dialog,setDialog] = useState(null), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const trigger = useRef(null);
  const query = search.trim().toLocaleLowerCase(lang);
  const rows = data?.items.filter(row => [row.code,row.name].some(value => value?.toLocaleLowerCase(lang).includes(query))) ?? [];

  function open(event, type, account) {
    trigger.current = event.currentTarget;
    setError('');
    setDialog({type,account});
  }
  function close() {setDialog(null);setError('');}
  async function write(method, account, body) {
    if (busy) return;
    setBusy(true);setError('');
    try {
      await api(account ? `${path}/${encodeURIComponent(account.code)}` : path,{method,body});
      close();
      reload();
    } catch (failure) {setError(failure.message);}
    finally {setBusy(false);}
  }
  function save(form) {
    const account = dialog.account;
    const {code,...fields} = form;
    return account
      ? write('PATCH',account,{...fields,revision:account.revision})
      : write('POST',null,{...fields,code});
  }
  function toggle(account) {
    const {name,category,nature,active,revision} = account;
    return write('PATCH',account,{name,category,nature,active:!active,revision});
  }

  return <PageLayout>
    <PageHeader title={text.title} accessory={<button type="button" className={primaryClass} disabled={busy} onClick={event=>open(event,'edit')}>
        <Plus className="h-4 w-4" aria-hidden="true" />{text.add}
      </button>}/>
    <div className="relative w-full sm:max-w-sm">
      <label htmlFor="chart-search" className="sr-only">{text.search}</label>
      <Search className="pointer-events-none absolute start-3 top-3.5 h-4 w-4 text-slate-500" aria-hidden="true" />
      <input id="chart-search" type="search" className={`${inputClass} min-h-11 ps-9`} value={search} placeholder={text.search} onChange={event=>setSearch(event.target.value)} />
    </div>
    {!dialog && <Feedback error={error||loadError} c={t} retry={loadError ? reload : undefined} />}
    {!data && !loadError && <LoadingState>{c('loading')}</LoadingState>}
    {data && !rows.length && <EmptyState icon={data.items.length ? Search : BookOpen} className="rounded-xl border border-slate-200 bg-white p-6">{data.items.length ? text.noMatches : text.empty}</EmptyState>}
    <div className="grid gap-4 xl:grid-cols-2">
      {groups.map(group => {
        const accounts = rows.filter(row=>row.category===group);
        if (!accounts.length) return null;
        return <section key={group} aria-labelledby={`chart-group-${group}`} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h3 id={`chart-group-${group}`} className="flex items-center gap-2 font-bold">
              <BookOpen className="h-4 w-4 text-emerald-700" aria-hidden="true" />{text[group]}
              <span className="text-xs font-medium text-slate-500">{accounts.length}</span>
            </h3>
            <Nature nature={defaultNature(group)} text={text} />
          </div>
          <ul className="divide-y divide-slate-100">
            {accounts.map(account => {
              const {name} = account;
              return <li key={account.code} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 sm:px-4">
                <div className="flex min-w-32 flex-1 items-baseline gap-2">
                  <bdi className="shrink-0 text-xs text-slate-500">{account.code}</bdi>
                  <span className="min-w-0 break-words text-sm font-medium">{name}</span>
                </div>
                <Nature nature={account.nature} text={text} />
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${account.active?'bg-emerald-50 text-emerald-800':'bg-slate-100 text-slate-600'}`}>
                  {text[account.active?'active':'inactive']}
                </span>
                <div className="flex items-center">
                  <button type="button" className={iconButton} disabled={busy} onClick={event=>open(event,'edit',account)} aria-label={`${text.edit} · ${name}`}><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                  <button type="button" className={iconButton} disabled={busy} onClick={()=>toggle(account)} aria-label={`${text[account.active?'deactivate':'activate']} · ${name}`}><Power className="h-4 w-4" aria-hidden="true" /></button>
                  <button type="button" className={iconButton} disabled={busy} onClick={event=>open(event,'delete',account)} aria-label={`${text.remove} · ${name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                </div>
              </li>;
            })}
          </ul>
        </section>;
      })}
    </div>
    {dialog?.type==='edit' && <AccountForm account={dialog.account} {...{text,lang,busy,error,close,save}} c={t} returnFocus={trigger.current} />}
    {dialog?.type==='delete' && <Modal {...{lang,busy,close}} c={t} returnFocus={trigger.current} title={text.remove} description={text.deleteHint}>
      <p className="mb-3 text-sm font-semibold"><bdi>{dialog.account.code}</bdi> · {dialog.account.name}</p>
      <Feedback error={error} c={t} />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonClass} onClick={close} disabled={busy}>{c('cancel')}</button>
        <button type="button" className={`${buttonClass} !text-rose-700`} disabled={busy}
          onClick={()=>write('DELETE',dialog.account,{revision:dialog.account.revision})}>{text.remove}</button>
      </div>
    </Modal>}
  </PageLayout>;
}
