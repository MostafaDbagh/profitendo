import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { Field } from '../auth-v2/Fields';
import { Feedback, Pager, buttonClass } from '../business-v2/UI';
import { useLiveSearch, useResource } from '../business-v2/useBusinessApi';

export default function SupplierSearch({ api, path, c, lang, value, onSelect, disabled, required }) {
  const id=useId();
  const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1);
  useLiveSearch(search,query,setQuery,setPage);
  const showResults=!value&&!disabled&&Boolean(search.trim())&&query===search.trim();
  const resource=useResource(api,showResults?`${path}?state=active&page=${page}&search=${encodeURIComponent(query)}`:null);
  const label=`${c('selectedSupplier')}${required?'':lang==='ar'?' (اختياري)':' (optional)'}`;
  function select(supplier) {
    onSelect(supplier);
    setSearch('');
  }
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field id={id} label={label} placeholder={c('supplierSearchPlaceholder')} value={value?.name??search}
            disabled={disabled} readOnly={Boolean(value)} required={required} maxLength={120} autoComplete="off"
            onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{
              if(event.key==='Escape')setSearch('');
              if(event.key==='Enter'&&!value){
                event.preventDefault();
                if(resource.data?.items.length===1)select(resource.data.items[0]);
              }
            }}/>
        </div>
        {value&&!disabled&&<button type="button" className={`${buttonClass} shrink-0`}
          aria-label={lang==='ar'?'إزالة المورد':'Clear supplier'} onClick={()=>select(null)}><X aria-hidden="true"/></button>}
      </div>
      {showResults&&<>
        <Feedback c={c} error={resource.error} retry={resource.reload}/>
        {!resource.data&&!resource.error&&<p role="status" className="text-sm text-slate-500">{c('loading')}</p>}
        {resource.data?.items.length===0&&<p role="status" className="text-sm text-slate-500">{c('empty')}</p>}
        {!!resource.data?.items.length&&<ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1">
          {resource.data.items.map(supplier=><li key={supplier.id}>
            <button type="button" className="block w-full rounded-md px-3 py-2 text-start text-sm font-semibold hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
              onClick={()=>select(supplier)}>{supplier.name}</button>
          </li>)}
        </ul>}
        {resource.data?.total>resource.data?.pageSize&&<Pager data={resource.data} {...{setPage,c}}/>}
      </>}
    </div>
  );
}
