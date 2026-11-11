import { useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { useResource } from '../business-v2/useBusinessApi';
import { Modal, Feedback, Pager, buttonClass } from '../business-v2/UI';
export default function RecordPicker({path,api,c,lang,title,onSelect,close,returnFocus}){
 const [page,setPage]=useState(1),[search,setSearch]=useState(''),[query,setQuery]=useState('');
 const {data,error,reload}=useResource(api,`${path}${path.includes('?')?'&':'?'}page=${page}&search=${encodeURIComponent(query)}`);
 return <Modal {...{c,lang,close,returnFocus}} title={title} description={c('chooseHint')}>
  <div className="space-y-4 min-w-0"><form className="flex flex-wrap gap-2 items-end" onSubmit={e=>{e.preventDefault();setQuery(search.trim());setPage(1);}}><div className="flex-1 min-w-0"><Field id="record-search" label={c('search')} placeholder={c(path.includes('/products')?'productSearchPlaceholder':'recordSearchPlaceholder')} value={search} onChange={e=>setSearch(e.target.value)} maxLength={160}/></div><button className={buttonClass}>{c('search')}</button></form>
  <Feedback {...{c,error}} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}
  {data&&<><ul className="divide-y divide-slate-100">{data.items.map(row=><li key={row.id}><button type="button" className="w-full text-start py-3 px-2 rounded-lg hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-500 break-words" onClick={()=>onSelect(row)}><span className="font-semibold">{row.name}</span><span className="block text-xs text-slate-500" dir="ltr">{row.code||row.sku}</span></button></li>)}</ul>{!data.items.length&&<p>{c('empty')}</p>}<Pager {...{data,setPage,c}}/></>}
  </div>
 </Modal>;
}
