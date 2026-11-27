import {useEffect, useRef, useState} from 'react';
import {PackageOpen, Plus} from 'lucide-react';
import {Feedback, Pager, primaryClass} from '../business-v2/UI';
import {useResource} from '../business-v2/useBusinessApi';
import ProductForm from '../catalogue-v2/ProductForm';
import {unitLabel} from '../catalogue-v2/units';
import {currencyFormatter} from '../../lib/currencyFormat';

export default function SaleCatalog({api,root,path,text,shop,context,c,lang,add,busy,clear}) {
  const ar = lang === 'ar';
  const [query,setQuery] = useState('');
  const [page,setPage] = useState(1);
  const [creating,setCreating] = useState(false);
  const trigger = useRef(null);
  useEffect(()=>{
    const timer=setTimeout(()=>{setQuery(text.trim());setPage(1);},180);
    return ()=>clearTimeout(timer);
  },[text]);
  const {data,error,reload}=useResource(api,shop ? `${path}/products?locationId=${shop.id}&page=${page}&search=${encodeURIComponent(query)}` : null);
  if(!shop)return null;
  const money=currencyFormatter(lang,{style:'currency',currency:context.business.baseCurrency});
  if(error)return <Feedback {...{c,error}} retry={reload}/>;
  if(!data||query!==text.trim())return <p role="status">{c('loading')}</p>;
  return <>
    {data.items.length ? <ul className="divide-y divide-slate-100">{data.items.map(p=><li key={p.id}>
      <button type="button" disabled={busy||Number(p.available)<=0} onClick={()=>add(p)} className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg px-3 py-2 text-start hover:bg-[#047756]/5 focus-visible:ring-2 focus-visible:ring-[#047756] disabled:opacity-60">
        <span className="min-w-0"><strong className="block break-words">{p.name}</strong><small className="text-slate-500">{unitLabel(p.unit,c)}{Number(p.available)<=0&&(ar?' · نفد المخزون':' · Out of stock')}</small></span>
        <bdi>{money.format(p.sellingPrice)}</bdi><Plus aria-hidden="true" className="h-4 w-4 text-[#047756]"/>
      </button></li>)}</ul> : <div className="flex min-h-48 flex-col items-center justify-center gap-4 text-center lg:min-h-80">
      <PackageOpen aria-hidden="true" className="h-16 w-16 text-[#047756]" strokeWidth={1.3}/>
      <strong>{query?(ar?'لا توجد نتائج':'No results'):(ar?'لا توجد منتجات في هذا المتجر':'No products in this store')}</strong>
      {query?<button type="button" onClick={clear}>{ar?'مسح البحث':'Clear search'}</button>:context.permissions['catalogue.create']&&context.permissions['catalogue.cost']&&<button ref={trigger} type="button" className={`${primaryClass} !bg-[#047756] hover:!brightness-90`} onClick={()=>setCreating(true)}>{ar?'إضافة أول منتج':'Add first product'}</button>}
    </div>}
    {data.total>data.pageSize&&<Pager {...{data,setPage,c}}/>}
    {creating&&<ProductForm {...{api,c,lang}} cost path={`${root}/products`} returnFocus={trigger.current} close={()=>setCreating(false)} done={saved=>{setCreating(false);if(saved)reload();}}/>}
  </>;
}
