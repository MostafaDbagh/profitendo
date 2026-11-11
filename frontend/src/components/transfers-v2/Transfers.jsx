import { useRef, useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Pager, Select, Table, buttonClass, primaryClass } from '../business-v2/UI';
import RecordPicker from '../operations-v2/RecordPicker';
import TransferEditor from './TransferEditor';
import TransferDetail from './TransferDetail';
import TransferEventForm from './TransferEventForm';
export default function Transfers({context,api,c,lang}){
 const root=`/businesses/${context.business.id}`;
 const [page,setPage]=useState(1),[status,setStatus]=useState(''),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[location,setLocation]=useState(null),[picker,setPicker]=useState(false),[screen,setScreen]=useState(null),trigger=useRef(null);
 const {data,error,reload}=useResource(api,`${root}/transfers?page=${page}&search=${encodeURIComponent(query)}${status?`&status=${status}`:''}${location?`&locationId=${location.id}`:''}`);
 function close(){setScreen(null);reload();}
 const shared={context,api,c,lang};
 if(screen?.type==='edit')return <TransferEditor {...shared} document={screen.doc} close={close} done={doc=>setScreen({type:'detail',id:doc.id,notice:'transferSaved'})}/>;
 if(screen?.type==='event')return <TransferEventForm {...shared} doc={screen.doc} kind={screen.kind} close={()=>setScreen({type:'detail',id:screen.doc.id})} done={doc=>setScreen({type:'detail',id:doc.id,notice:'transferEventSaved'})}/>;
 if(screen?.type==='detail')return <TransferDetail {...shared} id={screen.id} notice={screen.notice} close={close} edit={doc=>setScreen({type:'edit',doc})} record={(doc,kind)=>setScreen({type:'event',doc,kind})}/>;
 return <section className="space-y-5"><div className="flex flex-wrap justify-between gap-3 items-center"><div><h2 className="text-lg font-bold">{c('transfers')}</h2><p className="text-sm text-slate-500 mt-1">{c('transfersHint')}</p></div>{context.permissions['transfers.create']&&<button className={primaryClass} onClick={()=>setScreen({type:'edit'})}>{c('newTransfer')}</button>}</div>
 <form className="flex flex-wrap gap-3 items-end" onSubmit={e=>{e.preventDefault();setQuery(search.trim());setPage(1);}}><div className="w-full sm:w-72"><Field id="transfer-search" label={c('transferSearch')} placeholder={c('transferSearchPlaceholder')} value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/></div><Select id="transfer-status" label={c('status')} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{c('all')}</option>{['DRAFT','IN_TRANSIT','PARTIAL','COMPLETED','CANCELLED'].map(s=><option key={s} value={s}>{c(`transferStatus${s}`)}</option>)}</Select><button className={buttonClass}>{c('search')}</button><button type="button" className={buttonClass} onClick={e=>{trigger.current=e.currentTarget;setPicker(true);}}>{location?.name||c('chooseLocation')}</button>{location&&<button type="button" className={buttonClass} onClick={()=>{setLocation(null);setPage(1);}}>{c('clearFilter')}</button>}</form>
 <Feedback {...{error,c}} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}
 {data&&<><Table headers={['reference','sourceLocation','destinationLocation','status','actions']} c={c} empty={!data.items.length} tableClassName="min-w-[640px]">{data.items.map(doc=><tr key={doc.id}><td className="px-5 py-3 whitespace-nowrap" dir="ltr">{doc.reference}</td><td className="px-5 py-3">{doc.sourceName}</td><td className="px-5 py-3">{doc.destinationName}</td><td className="px-5 py-3">{c(`transferStatus${doc.status}`)}</td><td className="px-5 py-3"><button className={buttonClass} onClick={()=>setScreen({type:'detail',id:doc.id})}>{c('openDocument')}</button></td></tr>)}</Table><Pager {...{data,setPage,c}}/></>}
 {picker&&<RecordPicker {...{api,c,lang}} title={c('chooseLocation')} path={`${root}/locations?state=all`} returnFocus={trigger.current} close={()=>setPicker(false)} onSelect={row=>{setLocation(row);setPage(1);setPicker(false);}}/>}
 </section>;
}
