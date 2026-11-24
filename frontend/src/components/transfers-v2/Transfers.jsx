import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import { useState } from 'react';
import { useLiveSearch, useResource } from '../business-v2/useBusinessApi';
import { Feedback, Pager, Select, Table, TableSearchForm, buttonClass, primaryClass } from '../business-v2/UI';
import LocationChips from '../business-v2/LocationChips';
import TransferEditor from './TransferEditor';
import TransferDetail from './TransferDetail';
import TransferEventForm from './TransferEventForm';
export default function Transfers({context,api,c,lang}){
 const root=`/businesses/${context.business.id}`;
 const [page,setPage]=useState(1),[status,setStatus]=useState(''),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[location,setLocation]=useState(null),[screen,setScreen]=useState(null);
 const {data,error,reload}=useResource(api,`${root}/transfers?page=${page}&search=${encodeURIComponent(query)}${status?`&status=${status}`:''}${location?`&locationId=${location.id}`:''}`);
 useLiveSearch(search,query,setQuery,setPage);
 function close(){setScreen(null);reload();}
 const shared={context,api,c,lang};
 if(screen?.type==='edit')return <TransferEditor {...shared} document={screen.doc} close={close} done={doc=>setScreen({type:'detail',id:doc.id,notice:'transferSaved'})}/>;
 if(screen?.type==='event')return <TransferEventForm {...shared} doc={screen.doc} kind={screen.kind} close={()=>setScreen({type:'detail',id:screen.doc.id})} done={doc=>setScreen({type:'detail',id:doc.id,notice:'transferEventSaved'})}/>;
 if(screen?.type==='detail')return <TransferDetail {...shared} id={screen.id} notice={screen.notice} close={close} edit={doc=>setScreen({type:'edit',doc})} record={(doc,kind)=>setScreen({type:'event',doc,kind})}/>;
 return <PageLayout><PageHeader title={c('transfers')} accessory={context.permissions['transfers.create']&&<button className={primaryClass} onClick={()=>setScreen({type:'edit'})}>{c('newTransfer')}</button>}/>
 <div className="flex flex-wrap items-end gap-3"><Select id="transfer-status" label={c('status')} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{c('all')}</option>{['DRAFT','IN_TRANSIT','PARTIAL','COMPLETED','CANCELLED'].map(s=><option key={s} value={s}>{c(`transferStatus${s}`)}</option>)}</Select><LocationChips {...shared} value={location} onChange={row=>{setLocation(row);setPage(1);}} all/>{location&&<button type="button" className={buttonClass} onClick={()=>{setLocation(null);setPage(1);}}>{c('clearFilter')}</button>}</div>
 <Feedback {...{error,c}} retry={reload}/>{!data&&!error&&<LoadingState>{c('loading')}</LoadingState>}
 <Table showRows={!!data} searchContent={<TableSearchForm id="transfer-search" label={c('transferSearch')} submitLabel={c('search')}
  placeholder={c('transferSearchPlaceholder')} value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}
  onSearch={()=>{setQuery(search.trim());setPage(1);}} />} headers={['reference','sourceLocation','destinationLocation','status','actions']} c={c} empty={!data?.items.length} tableClassName="min-w-[640px]">{data?.items.map(doc=><tr key={doc.id}><td className="px-5 py-3 whitespace-nowrap" dir="ltr">{doc.reference}</td><td className="px-5 py-3">{doc.sourceName}</td><td className="px-5 py-3">{doc.destinationName}</td><td className="px-5 py-3">{c(`transferStatus${doc.status}`)}</td><td className="px-5 py-3"><button className={buttonClass} onClick={()=>setScreen({type:'detail',id:doc.id})}>{c('openDocument')}</button></td></tr>)}</Table>{data&&<Pager {...{data,setPage,c}}/>}

 </PageLayout>;
}
