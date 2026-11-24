import CopyableCode from '../CopyableCode';
import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import { ArrowRight, History, Pencil, Plus } from 'lucide-react';
import SupplierForm from './SupplierForm';
import Adjustments from '../completion-v2/Adjustments';
import { useRef, useState } from 'react';
import { useLiveSearch, useResource } from '../business-v2/useBusinessApi';
import { Feedback, Pager, Select, Table, TableSearchForm, buttonClass, primaryClass } from '../business-v2/UI';
import Purchases from './Purchases';

const rowActionClass = `${buttonClass} !border-transparent !bg-transparent !px-2.5 whitespace-nowrap hover:!bg-slate-100`;

export default function Suppliers({context,api,c,lang,initialAction}){
 const path=`/businesses/${context.business.id}/operations/suppliers`,manage=context.permissions['suppliers.edit'],create=context.permissions['suppliers.create'];
 const canViewHistory=context.permissions['purchasing.view'];
 const showActions=manage||canViewHistory;
 const [page,setPage]=useState(1),[state,setState]=useState('active'),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[edit,setEdit]=useState(() => initialAction === 'new' && create ? {row:null} : null),[history,setHistory]=useState(null),[historyView,setHistoryView]=useState('purchases'),[notice,setNotice]=useState('');
 const trigger=useRef(null),{data,error,reload}=useResource(api,`${path}?page=${page}&state=${state}&search=${encodeURIComponent(query)}`);
 useLiveSearch(search,query,setQuery,setPage);
 if(history)return <PageLayout as="div"><button className={buttonClass} onClick={()=>setHistory(null)}><ArrowRight aria-hidden="true" className={`h-4 w-4 ${lang==='ar'?'':'rotate-180'}`} />{c('back')}</button><PageHeader title={<>{history.name} · {c('history')}</>}/>{context.permissions['returns.view']&&<div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={()=>setHistoryView('purchases')}>{c('purchases')}</button><button className={buttonClass} onClick={()=>setHistoryView('returns')}>{c('SUPPLIER_RETURN')}</button></div>}{historyView==='returns'&&context.permissions['returns.view']?<Adjustments {...{context,api,c,lang}} initialSupplier={history}/>:<Purchases {...{context,api,c,lang}} initialSupplier={history}/>}</PageLayout>;
 return <PageLayout>
  <PageHeader title={lang==='ar'?'الموردون (مندوبو الشركات)':c('suppliers')} accessory={create&&<button className={primaryClass} onClick={e=>{trigger.current=e.currentTarget;setEdit({row:null});}}><Plus aria-hidden="true" className="h-4 w-4 shrink-0"/>{c('addSupplier')}</button>}/>
  <Feedback {...{error,notice,c}} retry={reload}/>{!data&&!error&&<LoadingState>{c('loading')}</LoadingState>}
  <Table showRows={!!data}
      tableClassName={`min-w-[900px] [&_td]:align-middle [&_thead_th]:px-4 sm:[&_thead_th]:px-5 ${showActions?'[&_thead_th:last-child]:text-end':''}`}
      searchContent={<TableSearchForm id="supplier-search" label={c('search')} submitLabel={c('search')}
      placeholder={c('supplierSearchPlaceholder')} value={search} onChange={e=>setSearch(e.target.value)}
      onSearch={()=>{setQuery(search.trim());setPage(1);}} />}
      filters={<Select id="supplier-state" label={c('status')} value={state} onChange={e=>{setState(e.target.value);setPage(1);}}>
        {['active','inactive','all'].map(k=><option key={k} value={k}>{c(k)}</option>)}
      </Select>}
      filtersActive={state!=='active'} headers={['supplierName','contact','phone','email','status',...(showActions?['actions']:[])]} empty={!data?.items.length} c={c}>
   {data?.items.map(row=>(
    <tr key={row.id}>
     <th scope="row" className="min-w-32 whitespace-nowrap px-4 py-3 text-start font-semibold text-slate-900 sm:px-5">
      <bdi>{row.name}</bdi>
     </th>
     <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800 sm:px-5">
      <bdi>{row.contact || '—'}</bdi>
     </td>
     <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 sm:px-5">
      {row.phone?<CopyableCode kind="phone">{row.phone}</CopyableCode>:'—'}
     </td>
     <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600 sm:px-5">
      {row.email?<CopyableCode kind="email">{row.email}</CopyableCode>:'—'}
     </td>
     <td className="w-px px-4 py-3 sm:px-5">
      <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${row.active?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-slate-200 bg-slate-100 text-slate-600'}`}>
       {c(row.active?'active':'inactive')}
      </span>
     </td>
     {showActions&&<td className="w-px px-4 py-2 sm:px-5">
      <div className="flex justify-end gap-1">
       {manage&&<button type="button" className={rowActionClass} onClick={e=>{trigger.current=e.currentTarget;setEdit({row});}}>
        <Pencil aria-hidden="true"/>{c('editSupplier')}
       </button>}
       {canViewHistory&&<button type="button" className={rowActionClass} onClick={()=>setHistory(row)}>
        <History aria-hidden="true"/>{c('history')}
       </button>}
      </div>
     </td>}
    </tr>
   ))}
  </Table>
 {data&&<Pager {...{data,setPage,c}}/>}
  {edit&&<SupplierForm canDelete={context.permissions['suppliers.delete']} {...{path,api,c,lang}} row={edit.row} returnFocus={trigger.current} close={()=>setEdit(null)} done={()=>{setEdit(null);setNotice('supplierSaved');reload();}}/>}
 </PageLayout>;
}
