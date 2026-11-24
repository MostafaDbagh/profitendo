import {LoadingState} from '../page-layout/PageResults';
import { useEffect, useId, useRef, useState } from 'react';
import { Feedback, Pager, TableSearchForm, primaryClass } from '../business-v2/UI';
import { useResource } from '../business-v2/useBusinessApi';
import ProductForm from '../catalogue-v2/ProductForm';

export default function ProductSearch({ api, root, c, lang, context, disabled, onSelect, describedBy,
  lookupPath=`${root}/products?state=active`, selectCreated=true, inputRef, value, onTextChange,
  label=c('search'), placeholder=c('productSearchPlaceholder'), required, maxLength=160 }) {
  const id = useId();
  const resultsRef=useRef(null),addTrigger=useRef(null),timerRef=useRef(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(null);
  const [page, setPage] = useState(1);
  const [creating,setCreating]=useState(false);
  const canCreate=context?.permissions['catalogue.create'] && context.permissions['catalogue.cost'];
  const path = query === null || disabled ? null : `${lookupPath}&page=${page}&search=${encodeURIComponent(query)}`;
  const { data, error, reload } = useResource(api, path);

  useEffect(()=>()=>clearTimeout(timerRef.current),[]);

  function submitSearch(text) {
    clearTimeout(timerRef.current);
    setPage(1);
    setQuery(text.trim());
  }

  function selectProduct(product) {
    clearTimeout(timerRef.current);
    onSelect(product);
    setSearch('');
    setQuery(null);
  }

  return (
    <div className="min-w-0 space-y-3">
      <TableSearchForm
        id={id} label={label} submitLabel={c('search')} insideForm={Boolean(onTextChange)}
        placeholder={placeholder} value={value??search} maxLength={maxLength}
        autoComplete="off" disabled={disabled} aria-describedby={describedBy} required={required}
        inputRef={inputRef}
        onKeyDown={event=>{
          if(event.key==='Escape'){clearTimeout(timerRef.current);setQuery(null);}
          if(event.key==='Enter'&&onTextChange){event.preventDefault();submitSearch(value??search);}
          if(event.key==='ArrowDown'&&data?.items.length){
            event.preventDefault();
            resultsRef.current?.querySelector('button')?.focus();
          }
        }}
        onChange={event => {
          const text=event.target.value;
          setSearch(text);
          onTextChange?.(text);
          setQuery(null);
          clearTimeout(timerRef.current);
          if(text.trim())timerRef.current=setTimeout(()=>submitSearch(text),220);
        }}
        onSearch={() => {
          if (disabled) return;
          submitSearch(value??search);
        }}
      />
      {path && <>
        <Feedback c={c} error={error} retry={reload} />
        {!data && !error && <LoadingState className="text-sm text-slate-500">{c('loading')}</LoadingState>}
        {data && !data.items.length && <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <p role="status" className="text-sm text-slate-500">{lang==='ar'?'لا توجد نتائج مطابقة':'No matching products'}</p>
          {canCreate&&<button ref={addTrigger} type="button" className={`${primaryClass} mt-2`}
            onClick={()=>setCreating(true)}>{c('addProduct')}</button>}
        </div>}
        {!!data?.items.length && <>
          <ul ref={resultsRef} aria-label={c('searchProducts')} className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1">
            {data.items.map(product => (
              <li key={product.id}>
                <button type="button" disabled={disabled} onClick={() => selectProduct(product)}
                  className="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-3 py-2 text-start text-sm hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 disabled:opacity-50">
                  <span className="min-w-0 break-words font-semibold">{product.name}</span>
                  {product.sku && <bdi className="min-w-0 break-all text-xs text-slate-500">{product.sku}</bdi>}
                </button>
              </li>
            ))}
          </ul>
          {data.total > data.pageSize && <Pager {...{ data, setPage, c }} />}
        </>}
      </>}
      {creating&&<ProductForm {...{api,c,lang}} cost path={`${root}/products`} initialName={(value??search).trim()}
        returnFocus={addTrigger.current} close={()=>setCreating(false)} done={(saved,product)=>{
          setCreating(false);
          if(!saved)return;
          if(selectCreated&&product?.active)selectProduct(product);
          else reload();
        }}/>}
    </div>
  );
}
