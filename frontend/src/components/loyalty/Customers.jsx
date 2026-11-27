import {useState} from 'react';
import {PageLayout} from '../page-layout/PageLayout';
import {useResource} from '../business-v2/useBusinessApi';
import {Feedback,Pager,buttonClass,panelClass} from '../business-v2/UI';
import {Field} from '../auth-v2/Fields';
import Card from './Card';
export default function Customers({context,api,c,lang}){
 const path=`/businesses/${context.business.id}/sales/loyalty`,ar=lang==='ar';
 const [search,setSearch]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState(null);
 const {data,error,reload}=useResource(api,selected?null:`${path}/customers?search=${encodeURIComponent(search)}&page=${page}`);
 return <PageLayout title={selected?.name||c('customers')}>
  {selected?<div className={panelClass}><button className={buttonClass} onClick={()=>setSelected(null)}>{c('close')}</button><p><bdi>{selected.phone}</bdi></p><Card {...{api,c,lang,path}} id={selected.id} history/></div>:<>
   <Field id="customer-search" label={ar?'بحث بالاسم أو الهاتف':'Search by name or phone'} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
   <Feedback {...{error,c}} retry={reload}/>
   <div className={panelClass}>{data?.items.map(item=><button key={item.id} className="flex min-h-11 w-full items-center justify-between border-b px-2 text-start hover:bg-emerald-50" onClick={()=>setSelected(item)}><strong>{item.name}</strong><bdi>{item.phone}</bdi></button>)}{data&&!data.total&&c('empty')}</div>
   {data&&<Pager {...{data,setPage,c}}/>}
  </>}
 </PageLayout>;
}
