import { useRef, useState } from 'react';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Pager, Select, Table, buttonClass, primaryClass } from '../business-v2/UI';
import RecordPicker from './RecordPicker';
import DocumentEditor from './DocumentEditor';
import DocumentDetail from './DocumentDetail';
export default function Purchases({context,api,c,lang,initialSupplier}){
 const [kind,setKind]=useState('RECEIPT'),[page,setPage]=useState(1),[supplier,setSupplier]=useState(initialSupplier||null),[picker,setPicker]=useState(false),[screen,setScreen]=useState(null),[status,setStatus]=useState(''),trigger=useRef(null);
 const path=`/businesses/${context.business.id}/operations`;
 const {data,error,reload}=useResource(api,`${path}/purchases?kind=${kind}&page=${page}${supplier?`&supplierId=${supplier.id}`:''}${status?`&status=${status}`:''}`);
 function close(){setScreen(null);reload();}
 if(screen?.type==='edit')return <DocumentEditor {...{context,api,c,lang,close}} kind={screen.kind} document={screen.doc} seed={screen.seed} done={doc=>setScreen({type:'detail',id:doc.id,notice:'documentSaved'})}/>;
 if(screen?.type==='detail')return <DocumentDetail {...{context,api,c,lang,close}} id={screen.id} notice={screen.notice} edit={doc=>setScreen({type:'edit',kind:doc.kind,doc})} receive={seed=>setScreen({type:'edit',kind:'RECEIPT',seed})}/>;
 return <section className="space-y-5"><div className="flex flex-wrap justify-between gap-3 items-center"><div><h2 className="font-bold text-lg">{c('purchases')}</h2><p className="text-sm text-slate-500 mt-1">{c('purchasesHint')}</p></div><div className="flex flex-wrap gap-2">{context.permissions['receiving.create']&&<button className={primaryClass} onClick={()=>setScreen({type:'edit',kind:'RECEIPT'})}>{c('newReceipt')}</button>}{context.permissions['purchasing.manage']&&<button className={buttonClass} onClick={()=>setScreen({type:'edit',kind:'ORDER'})}>{c('newOrder')}</button>}</div></div>
 <div className="flex flex-wrap gap-3 items-end"><Select id="document-kind" label={c('documents')} value={kind} onChange={e=>{setKind(e.target.value);setStatus('');setPage(1);}}>{['RECEIPT','ORDER'].map(k=><option key={k} value={k}>{c(k)}</option>)}</Select><Select id="document-state" label={c('status')} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{c('all')}</option>{(kind==='ORDER'?['DRAFT','OPEN','PARTIAL','RECEIVED','CANCELLED']:['DRAFT','PENDING','COMPLETED','CANCELLED']).map(k=><option key={k} value={k}>{c(k)}</option>)}</Select>
 {!initialSupplier&&context.permissions['suppliers.view']&&<><button className={buttonClass} onClick={e=>{trigger.current=e.currentTarget;setPicker(true);}}>{supplier?.name||c('filterSupplier')}</button>{supplier&&<button className={buttonClass} onClick={()=>{setSupplier(null);setPage(1);}}>{c('clearFilter')}</button>}</>}</div>
 <Feedback {...{error,c}} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}
 {data&&<><Table c={c} headers={['reference','selectedSupplier','selectedLocation','documentDate','status','actions']} empty={!data.items.length} tableClassName="min-w-[640px]">{data.items.map(doc=><tr key={doc.id}><td className="px-5 py-3 break-all min-w-48" dir="ltr">{doc.reference}</td><td className="px-5 py-3">{doc.supplierName}</td><td className="px-5 py-3">{doc.locationName}</td><td className="px-5 py-3" dir="ltr">{doc.documentDate}</td><td className="px-5 py-3">{c(doc.status)}</td><td className="px-5 py-3"><button className={buttonClass} onClick={()=>setScreen({type:'detail',id:doc.id})}>{c('openDocument')}</button></td></tr>)}</Table><Pager {...{data,setPage,c}}/></>}
 {picker&&<RecordPicker {...{api,c,lang}} path={`${path}/suppliers?state=all`} title={c('chooseSupplier')} returnFocus={trigger.current} close={()=>setPicker(false)} onSelect={row=>{setSupplier(row);setPage(1);setPicker(false);}}/>}
 </section>;
}
