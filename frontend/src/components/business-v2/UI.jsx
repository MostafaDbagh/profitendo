import RequiredMark from '../RequiredMark';
import TableTools from './TableTools';
import { TableSearchButton } from '../page-layout/PageToolbar';
import { ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { Field, inputClass } from '../auth-v2/Fields';
import {TableRegion} from '../page-layout/PageLayout';
import {EmptyState} from '../page-layout/PageResults';
export {buttonClass, primaryClass, panelClass} from '../page-layout/tokens';
export {Pager, LoadingState, Feedback, UpgradeContext} from '../page-layout/PageResults';
export function Select({ id, label, children, className = '', ...props }) {
  return <div><label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1.5">{label}<RequiredMark required={!!props.required}/></label><div className="relative" dir={props.dir}><select id={id} className={`${inputClass.replace('px-3', 'ps-3 pe-10')} appearance-none ${className}`} {...props}>{children}</select><ChevronDown aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" /></div></div>;
}
export function TableSearchForm({ onSearch, submitLabel, inputRef, insideForm=false, ...fieldProps }) {
  const Wrapper=insideForm?'div':'form';
  return (
    <Wrapper className="flex min-w-0 flex-nowrap items-end gap-2" onSubmit={insideForm?undefined:event => {
      event.preventDefault();
      onSearch();
    }}>
      <div className="min-w-0 flex-1"><Field ref={inputRef} autoComplete="off" {...fieldProps} /></div>
      <TableSearchButton type={insideForm?'button':'submit'} onClick={insideForm?onSearch:undefined}
        disabled={fieldProps.disabled} label={submitLabel} />
    </Wrapper>
  );
}
export function Table({ headers, children, empty, c, tableClassName = '', tools = true, searchable = true, exportVisible = true, searchActions, searchContent, filters, filtersActive = false, primaryFilters, importAction, showRows = true }) {
  if(tools)return <TableTools {...{headers,children,c,searchable,filters,filtersActive,exportVisible,searchActions,searchContent,primaryFilters,importAction}} render={(rows,isEmpty)=>showRows&&<PlainTable {...{headers,c,tableClassName}} empty={empty||isEmpty}>{rows}</PlainTable>}/>;
  return showRows?<PlainTable {...{headers,children,empty,c,tableClassName}}/>:null;
}
function PlainTable({headers,children,empty,c,tableClassName}){
  return <TableRegion>
    <table className={`w-full text-sm text-start tabular-nums [&_td]:align-middle ${tableClassName}`}>
      <thead className="bg-muted/60"><tr className="border-b border-border">
        {headers.map(h => <th key={h} scope="col" className="whitespace-nowrap px-5 py-3 text-start font-semibold text-slate-600">{c(h)}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-slate-100 [&>tr]:transition-colors motion-reduce:[&>tr]:transition-none [&>tr:hover]:bg-slate-50/70 [&>tr:focus-within]:bg-emerald-50/40">
        {empty ? <tr><td colSpan={headers.length} className="p-6"><EmptyState>{c('empty')}</EmptyState></td></tr> : children}
      </tbody>
    </table>
  </TableRegion>;
}
export function Modal({ title, description, children, close, busy, c, lang, returnFocus }) {
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent closeLabel={c('close')} onCloseAutoFocus={event => { if (returnFocus?.isConnected) { event.preventDefault(); returnFocus.focus(); } }} dir={lang === 'ar' ? 'rtl' : 'ltr'} className="max-w-lg w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto rounded-xl bg-white text-start" onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}><DialogTitle className="pe-8">{title}</DialogTitle><DialogDescription>{description}</DialogDescription>{children}</DialogContent></Dialog>;
}
