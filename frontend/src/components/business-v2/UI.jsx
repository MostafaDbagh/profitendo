import { useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { inputClass } from '../auth-v2/Fields';
export const buttonClass = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50';
export const primaryClass = `${buttonClass} !bg-emerald-500 hover:!bg-emerald-600 !text-white !border-emerald-500`;
export const panelClass = 'bg-white border border-slate-200 rounded-xl shadow-sm p-5 md:p-6';
export function Select({ id, label, children, ...props }) {
  return <div><label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label><select id={id} className={inputClass} {...props}>{children}</select></div>;
}
export function Feedback({ error, notice, c, retry }) {
  const ref = useRef(null);
  useEffect(() => { if (error || notice) ref.current?.focus(); }, [error, notice]);
  if (!error && !notice) return null;
  return <div ref={ref} tabIndex={-1} role={error ? 'alert' : 'status'} className={`p-3 rounded-lg border text-sm ${error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
    {c(error || notice)}{error && retry && <button type="button" className="underline ms-3 font-semibold" onClick={retry}>{c(error === 'REVISION_CONFLICT' ? 'reload' : 'retry')}</button>}
  </div>;
}
export function Pager({ data, setPage, c }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-slate-600"><span>{c('page')} {data.page} · {c('total')} {data.total}</span><div className="flex gap-2"><button className={buttonClass} disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>{c('previous')}</button><button className={buttonClass} disabled={data.page * data.pageSize >= data.total} onClick={() => setPage(data.page + 1)}>{c('next')}</button></div></div>;
}
export function Table({ headers, children, empty, c, tableClassName = '' }) {
  return <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto"><table className={`w-full text-sm text-start ${tableClassName}`}><thead><tr className="border-b border-slate-100">{headers.map(h => <th key={h} className="px-5 py-3.5 text-start font-medium text-slate-500 whitespace-nowrap">{c(h)}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{empty ? <tr><td colSpan={headers.length} className="p-8 text-center text-slate-500">{c('empty')}</td></tr> : children}</tbody></table></div>;
}
export function Modal({ title, description, children, close, busy, c, lang, returnFocus }) {
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent closeLabel={c('close')} onCloseAutoFocus={event => { if (returnFocus?.isConnected) { event.preventDefault(); returnFocus.focus(); } }} dir={lang === 'ar' ? 'rtl' : 'ltr'} className="max-w-lg w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto rounded-xl bg-white text-start" onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}><DialogTitle className="pe-8">{title}</DialogTitle><DialogDescription>{description}</DialogDescription>{children}</DialogContent></Dialog>;
}
