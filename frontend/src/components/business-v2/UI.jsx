import {errorText} from './feedbackCopy';
import RequiredMark from '../RequiredMark';
import TableTools from './TableTools';
import {useLanguage} from '../../context/LanguageContext';
import { ChevronDown, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { createContext, useContext, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { inputClass } from '../auth-v2/Fields';
export const buttonClass = 'inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2.5 rounded-lg [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50';
export const primaryClass = `${buttonClass} !bg-emerald-500 hover:!bg-emerald-600 !text-white !border-emerald-500`;
export const panelClass = 'bg-white border border-slate-200 rounded-xl shadow-sm p-5 md:p-6';
export function Select({ id, label, children, className = '', ...props }) {
  return <div><label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1.5">{label}<RequiredMark required={!!props.required}/></label><div className="relative" dir={props.dir}><select id={id} className={`${inputClass.replace('px-3', 'ps-3 pe-10')} appearance-none ${className}`} {...props}>{children}</select><ChevronDown aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" /></div></div>;
}
export const UpgradeContext = createContext(null);
export function Feedback({ error, notice, c, retry }) {
  const ref = useRef(null);
  const upgrade = useContext(UpgradeContext);
  const language=useLanguage();
  const limited = ['MEMBER_LIMIT_REACHED', 'LOCATION_LIMIT_REACHED'].includes(error);
  const lang=upgrade?.lang||language?.lang||'en';
  const ar = lang === 'ar';
  useEffect(() => { if (error || notice) ref.current?.focus(); }, [error, notice]);
  if (!error && !notice) return null;
  return <div ref={ref} tabIndex={-1} role={error ? 'alert' : 'status'} className={`p-3 rounded-lg border text-sm ${error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
    {error ? errorText(error,c,lang) : c(notice)}
    {limited && upgrade && <div className="mt-3 space-y-3"><p>{upgrade.canUpgrade ? (ar ? 'قم بترقية خطتك لإضافة المزيد.' : 'Upgrade your plan to add more.') : (ar ? 'تواصل مع مالك النشاط لترقية الخطة وإضافة المزيد.' : 'Contact your business owner to upgrade the plan and add more.')}</p>{upgrade.canUpgrade && <button type="button" className={primaryClass} onClick={upgrade.onUpgrade}>{ar ? 'ترقية الخطة' : 'Upgrade plan'}</button>}</div>}
    {error && retry && !limited && error !== 'SAVE_UNCONFIRMED' && <button type="button" className="underline ms-3 font-semibold" onClick={retry}>{c(error === 'REVISION_CONFLICT' ? 'reload' : 'retry')}</button>}
  </div>;
}
export function Pager({ data, setPage, c }) {
  const {lang}=useLanguage();
  const Previous=lang==='ar'?ChevronRight:ChevronLeft,Next=lang==='ar'?ChevronLeft:ChevronRight;
  return <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-slate-600"><span>{c('page')} {data.page} · {c('total')} {data.total}</span><div className="flex gap-2"><button className={buttonClass} disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}><Previous aria-hidden="true"/>{c('previous')}</button><button className={buttonClass} disabled={data.page * data.pageSize >= data.total} onClick={() => setPage(data.page + 1)}>{c('next')}<Next aria-hidden="true"/></button></div></div>;
}
export function Table({ headers, children, empty, c, tableClassName = '', tools = true, searchable = true, exportVisible = true, searchActions, searchContent, filters, filtersActive = false, showRows = true }) {
  if(tools)return <TableTools {...{headers,children,c,searchable,filters,filtersActive,exportVisible,searchActions,searchContent}} render={(rows,isEmpty)=>showRows&&<PlainTable {...{headers,c,tableClassName}} empty={empty||isEmpty}>{rows}</PlainTable>}/>;
  return showRows?<PlainTable {...{headers,children,empty,c,tableClassName}}/>:null;
}
function PlainTable({headers,children,empty,c,tableClassName}){
  const {lang}=useLanguage();
  return <div role="region" aria-label={lang==='ar'?'جدول البيانات':'Data table'} tabIndex={0} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"><table className={`w-full text-sm text-start tabular-nums [&_td]:align-middle ${tableClassName}`}><thead className="bg-slate-50"><tr className="border-b border-slate-200">{headers.map(h => <th key={h} scope="col" className="px-5 py-3.5 text-start font-semibold text-slate-600 whitespace-nowrap">{c(h)}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 [&>tr]:transition-colors motion-reduce:[&>tr]:transition-none [&>tr:hover]:bg-slate-50/70 [&>tr:focus-within]:bg-emerald-50/40">{empty ? <tr><td colSpan={headers.length} className="p-8 text-center text-slate-500"><Inbox aria-hidden="true" className="mx-auto mb-3 h-6 w-6 text-slate-400"/>{c('empty')}</td></tr> : children}</tbody></table></div>;
}
export function Modal({ title, description, children, close, busy, c, lang, returnFocus }) {
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent closeLabel={c('close')} onCloseAutoFocus={event => { if (returnFocus?.isConnected) { event.preventDefault(); returnFocus.focus(); } }} dir={lang === 'ar' ? 'rtl' : 'ltr'} className="max-w-lg w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto rounded-xl bg-white text-start" onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}><DialogTitle className="pe-8">{title}</DialogTitle><DialogDescription>{description}</DialogDescription>{children}</DialogContent></Dialog>;
}
