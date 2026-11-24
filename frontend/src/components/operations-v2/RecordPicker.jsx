import {LoadingState} from '../page-layout/PageResults';
import CopyableCode from '../CopyableCode';
import { useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { useLiveSearch, useResource } from '../business-v2/useBusinessApi';
import { Modal, Feedback, Pager, buttonClass } from '../business-v2/UI';
export default function RecordPicker({path,api,c,lang,title,onSelect,close,returnFocus,emptyHelp,onAddSupplier,selectedId}){
 const [page,setPage]=useState(1),[search,setSearch]=useState(''),[query,setQuery]=useState('');
 const {data,error,reload}=useResource(api,`${path}${path.includes('?')?'&':'?'}page=${page}&search=${encodeURIComponent(query)}`);
 useLiveSearch(search,query,setQuery,setPage);
 return <Modal {...{c,lang,close,returnFocus}} title={title} description={c('chooseHint')}>
  <div className="space-y-4 min-w-0"><form className="flex flex-wrap gap-2 items-end" onSubmit={e=>{e.preventDefault();setQuery(search.trim());setPage(1);}}><div className="flex-1 min-w-0"><Field id="record-search" label={c('search')} placeholder={c(path.includes('/products')?'productSearchPlaceholder':'recordSearchPlaceholder')} value={search} onChange={e=>setSearch(e.target.value)} maxLength={160} autoComplete="off"/></div><button className={buttonClass}>{c('search')}</button></form>
  <Feedback {...{c,error}} retry={reload}/>{!data&&!error&&<LoadingState>{c('loading')}</LoadingState>}
  {data&&<><ul className="divide-y divide-slate-100">{data.items.map(row=><li key={row.id} className="py-2"><button type="button" aria-current={row.id===selectedId?true:undefined} className={`w-full text-start py-2 px-2 rounded-lg hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-500 break-words ${row.id===selectedId?'bg-emerald-50 text-emerald-800':''}`} onClick={()=>onSelect(row)}><span className="font-semibold">{row.name}</span>{row.id===selectedId&&<span className="ms-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs">{lang==='ar'?'الموقع الحالي':'Current location'}</span>}{!row.sku&&<span className="block text-xs text-slate-500"><bdi>{row.code}</bdi></span>}</button>{row.sku&&<span className="block px-2 text-xs text-slate-500"><CopyableCode>{row.sku}</CopyableCode></span>}</li>)}</ul>{!data.items.length&&<><p>{c('empty')}</p>{emptyHelp}{!query && onAddSupplier && <button type="button" className="rounded text-sm font-semibold text-emerald-700 underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-emerald-500" onClick={onAddSupplier}>{c('addSupplier')}</button>}</>}<Pager {...{data,setPage,c}}/></>}
  </div>
 </Modal>;
}
