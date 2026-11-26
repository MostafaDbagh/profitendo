import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import { TableCsvButton } from '../page-layout/PageToolbar';
import Disclosure from '../business-v2/Disclosure';
import { OwnerPinUnlock } from '../business-v2/OwnerPin';
import { useState } from 'react';
import { currencyFormatter } from '../../lib/currencyFormat';
import CopyableCode from '../CopyableCode';
import { formatQuantity } from '@/lib/quantity';
import ClosingReports from './ClosingReports';
import { unitLabel } from '../catalogue-v2/units';
import { Field } from '../auth-v2/Fields';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Select, Table, Pager, buttonClass, primaryClass, panelClass } from '../business-v2/UI';
import { LocationChoice, downloadCsv } from './Shared';

const presets = ['today', 'week', 'recent', 'month', 'previousMonth', 'year', 'custom'];
const quantities = ['quantity', 'onHand', 'reserved', 'available', 'minimumStock', 'minimum', 'received', 'returned', 'lost', 'inTransit'];
const totals = ['saleCount','sales','customerReturns','netSales','expenses','grossProfit','estimatedProfit','estimatedCost','damageCost','transferLossCost','supplierReturnAdjustment','countAdjustmentValue','zeroStockProducts'];

function presetRange(today, preset) {
  const [year, month, day] = today.split('-').map(Number);
  const date = (m, d) => new Date(Date.UTC(year, m, d)).toISOString().slice(0, 10);
  if (preset === 'previousMonth') return { from: date(month - 2, 1), to: date(month - 1, 0) };
  const from = {
    today, week: date(month - 1, day - 6), recent: date(month - 1, day - 29),
    month: date(month - 1, 1), year: date(0, 1),
  }[preset];
  return { from, to: today };
}

function formatReportCell({ name, value, lang, timezone, c }) {
  if (value == null) return '—';
  if (name === 'sku') return <CopyableCode>{value}</CopyableCode>;
  if (name === 'barcodes') return value ? value.split(' | ').map(code =>
    <span className="block" key={code}><CopyableCode kind="barcode">{code}</CopyableCode></span>) : '—';
  if (name === 'date' && value) return new Date(value).toLocaleString(lang, { timeZone: timezone });
  if (name === 'unit') return unitLabel(value, c);
  if (name === 'kind' || name === 'method') return c(value);
  return quantities.includes(name) ? formatQuantity(value) : <bdi>{value}</bdi>;
}

export default function Reports({ context, api, c, lang, pinLocked, onPinStatus, initialAction, onSection, visibleTabs=[] }) {
  const { timezone } = context.business;
  const permissions = context.permissions;
  const purchase = permissions['catalogue.cost'] && permissions['purchasing.view'];
  const payments = permissions['payments.view'];
  const primary = [
    'sales', ...(purchase ? ['purchases'] : []), 'stock', 'returns',
    ...(payments ? ['expenses'] : []),
    ...(payments && permissions['catalogue.cost'] ? ['profit'] : []),
    ...(payments && permissions['cash.close'] ? ['cash'] : []),
  ];
  const more = ['summary', ...(payments ? ['payments', 'refunds'] : []), ...(purchase ? ['balances'] : [])];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [preset, setPreset] = useState('recent');
  const [range, setRange] = useState(() => presetRange(today, 'recent'));
  const [draft, setDraft] = useState(range);
  const [view, setView] = useState(()=>['balances','refunds'].includes(initialAction)&& (initialAction==='balances'?purchase:payments)?initialAction:'sales');
  const [location, setLocation] = useState(null), [page, setPage] = useState(1), [low, setLow] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const path = `/businesses/${context.business.id}/workflows/reports?view=${view}&from=${range.from}&to=${range.to}&page=${page}&lowStock=${view === 'stock' && low}${location ? `&locationId=${location.id}` : ''}`;
  const moneyView=['balances','refunds'].includes(view);
  const restricted = pinLocked && ['profit','payments','expenses','cash','balances','refunds'].includes(view);
  const {data, error: loadError, reload} = useResource(api, restricted ? null : `${path}`);
  const safeData = pinLocked && view === 'summary' && data
    ? Object.fromEntries(Object.entries(data).filter(([key])=>!['expenses','grossProfit','estimatedProfit','estimatedCost','damageCost','transferLossCost','supplierReturnAdjustment','countAdjustmentValue'].includes(key)))
    : data;
  const isTotals = view === 'summary' || view === 'profit';

  function changeView(next) {
    setView(next); setPage(1); setError('');
  }
  function applyRange(next) {
    setRange(next); setPage(1); setError('');
  }
  function changePreset(next) {
    setPreset(next);
    if (next === 'custom') setDraft(range);
    else applyRange(presetRange(today, next));
  }
  async function exportRows() {
    setBusy(true); setError('');
    try { downloadCsv(await api(`${path}&export=true`)); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <PageLayout>
    <PageHeader title={c('reports')}/>
    <div className="flex max-w-full overflow-x-auto border-b border-slate-200" role="group" aria-label={c('reportView')}>
      {primary.map(key => <button key={key} type="button" aria-pressed={view === key}
        className={`shrink-0 border-b-2 px-3 py-3 text-sm font-semibold focus-visible:outline-emerald-600 lg:px-4 ${view===key ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-700 hover:text-emerald-700"}`} onClick={() => changeView(key)}>{c(`report_${key}`)}</button>)}
    </div>
    <div className={`${panelClass} flex flex-wrap items-end gap-4`}>
      {!moneyView && <div className="min-w-0 flex-[2_1_32rem] space-y-2"><div className="flex flex-wrap gap-2" role="group" aria-label={c('reportPeriod')}>
        {presets.map(key => <button key={key} type="button" aria-pressed={preset === key}
          className={`${buttonClass} !px-2.5 ${preset === key ? '!border-slate-900 !bg-slate-900 !text-white' : ''}`}
          onClick={() => changePreset(key)}>{c(`reportRange_${key}`)}</button>)}
      </div>
      </div>}
      <div className="flex min-w-0 flex-[1_1_19rem] flex-wrap items-end gap-3 [&>div]:min-w-0 [&>div]:flex-1">
        <LocationChoice {...{context,api,c,lang}} value={location} onChange={value => { setLocation(value); setPage(1); setError(''); }} all asSelect />
        <Select id="additional-reports" label={c('reportMore')} value={more.includes(view) ? view : ''}
          onChange={event => { if (event.target.value) changeView(event.target.value); }}>
          <option value="">{c('reportChoose')}</option>
          {more.map(key => <option key={key} value={key}>{c(`report_${key}`)}</option>)}
        </Select>
        {view === 'stock' && <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={low} onChange={event => {setLow(event.target.checked);setPage(1);setError('');}} />{c('lowStockOnly')}
        </label>}
      </div>
      {!moneyView && <div className="basis-full space-y-2"><p className="text-xs text-slate-600"><bdi dir="ltr">{range.from} – {range.to}</bdi></p>
      {!moneyView && preset === 'custom' && <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault(); applyRange(draft);
      }}>
        <Field id="report-from" type="date" label={c('dateFrom')} value={draft.from} max={draft.to}
          onChange={event => setDraft(value => ({...value, from:event.target.value}))} required />
        <Field id="report-to" type="date" label={c('dateTo')} value={draft.to} min={draft.from}
          onChange={event => setDraft(value => ({...value, to:event.target.value}))} required />
        <button className={primaryClass}>{c('applyFilters')}</button>
      </form>}</div>}
    </div>
    <Feedback c={c} error={error || loadError} retry={reload} />
    {restricted && <OwnerPinUnlock {...{context,api,c,lang,onPinStatus}} />}
    {!restricted && !data && !loadError && <LoadingState>{c('loading')}</LoadingState>}
    {data && view !== 'summary' && isTotals && <button type="button" className={buttonClass} disabled={busy} onClick={exportRows}>{c('exportCsv')}</button>}
    {data && (isTotals ? <>
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {totals.filter(key => safeData[key] !== undefined).map(key => <div key={key} className={panelClass}>
          <dt className="text-sm text-slate-500">{c(`metric_${key}`)}</dt>
          <dd className="mt-2 break-words text-xl font-bold"><bdi>
            {['saleCount','zeroStockProducts'].includes(key) ? data[key] : data[key] === null ? c('profitUnavailable') :
              currencyFormatter(lang,{style:'currency',currency:data.currency}).format(data[key])}
          </bdi></dd>
        </div>)}
      </dl>
      {safeData.estimatedProfit !== undefined && <p className="text-sm text-slate-500">{c(data.unvaluedTransferLosses ? 'profitMissingLossCosts' : 'profitEstimateHint')}</p>}
    </> : <div className={`${panelClass} min-w-0 space-y-4`}>
      {moneyView&&<div className="mb-4 space-y-2"><h3 className="text-lg font-semibold">{lang==='ar'?(view==='balances'?'مبالغ الموردين':'مبالغ يجب إعادتها للعملاء'):(view==='balances'?'Supplier money owed':'Customer refunds to pay')}</h3>{context.permissions['payments.manage']&&visibleTabs.includes('payments')&&(view!=='balances'||context.permissions['purchasing.manage'])&&<button type="button" className={primaryClass} onClick={()=>onSection('payments',view==='refunds'?'refund':'new')}>{view==='refunds'?(lang==='ar'?'تسجيل رد المبلغ':'Record refund'):c('recordPayment')}</button>}</div>}
      <Table compact toolbarLayout="report" searchActions={<TableCsvButton label={c('exportCsv')} disabled={busy} onClick={exportRows}/>} c={key => moneyView&&key==='outstanding'?(lang==='ar'?(view==='balances'?'عليك للمورد':'المتبقي للعميل'):(view==='balances'?'You owe supplier':'Still owed to customer')):moneyView&&key==='refundDue'?(lang==='ar'?'المورد مدين لك':'Supplier owes you'):c(`column_${key}`,key)} headers={moneyView?data.headers.filter(key=>['reference','supplier','location','outstanding','refundDue','currency'].includes(key)):data.headers} empty={!data.items.length}>
        {data.items.map((row, index) => <tr key={index}>{(moneyView?data.headers.filter(key=>['reference','supplier','location','outstanding','refundDue','currency'].includes(key)):data.headers).map(name => <td key={name} className="whitespace-nowrap p-4">
          {formatReportCell({name,lang,timezone,c,value:row[name]})}
        </td>)}</tr>)}
      </Table>
      {moneyView&&<Disclosure title={lang==='ar'?'تفاصيل الفواتير والدفعات':'Invoice and payment details'}><Table tools={false} c={key=>c(`column_${key}`,key)} headers={data.headers} empty={!data.items.length}>{data.items.map((row,index)=><tr key={index}>{data.headers.map(name=><td key={name} className="whitespace-nowrap p-4">{formatReportCell({name,lang,timezone,c,value:row[name]})}</td>)}</tr>)}</Table></Disclosure>}
      <Pager {...{data,setPage,c}} />
    </div>)}
    {!pinLocked && <ClosingReports {...{context,api,c,lang,range,location}} />}
  </PageLayout>;
}
