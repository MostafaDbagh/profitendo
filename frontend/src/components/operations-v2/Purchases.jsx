import SupplierForm from './SupplierForm';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { useRef, useState } from 'react';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Pager, Select, Table, buttonClass, primaryClass } from '../business-v2/UI';
import RecordPicker from './RecordPicker';
import DocumentEditor from './DocumentEditor';
import PlannedOrderEditor from './PlannedOrderEditor';
import DocumentDetail from './DocumentDetail';
function PurchaseAction({label,hint,className,onClick,lang}){
 return (
  <TooltipProvider delayDuration={250}>
   <Tooltip>
    <TooltipTrigger asChild>
     <button type="button" className={className} onClick={onClick}>
      {label}
      <Info aria-hidden="true" className="h-4 w-4 shrink-0"/>
     </button>
    </TooltipTrigger>
    <TooltipContent dir={lang==='ar'?'rtl':'ltr'} side="bottom" collisionPadding={12}
      className="max-w-[min(20rem,calc(100vw-1.5rem))] border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-700 shadow-lg">
     {hint}
    </TooltipContent>
   </Tooltip>
  </TooltipProvider>
 );
}
export default function Purchases({context,api,c,lang,initialSupplier,initialAction}){
 const [kind,setKind]=useState('RECEIPT'),[page,setPage]=useState(1),[supplier,setSupplier]=useState(initialSupplier||null),[picker,setPicker]=useState(false),[screen,setScreen]=useState(() => initialAction === 'new' && context.permissions['receiving.create'] ? {type:'edit',kind:'RECEIPT'} : null),[status,setStatus]=useState(''),trigger=useRef(null);
 const [addingSupplier,setAddingSupplier]=useState(false);
 const path=`/businesses/${context.business.id}/operations`;
 const {data,error,reload}=useResource(api,`${path}/purchases?kind=${kind}&page=${page}${supplier?`&supplierId=${supplier.id}`:''}${status?`&status=${status}`:''}`);
 function close(){setScreen(null);reload();}
 if(screen?.type==='edit'&&screen.kind==='ORDER'&&!screen.doc?.locationId)
  return <PlannedOrderEditor {...{context,api,c,lang,close,initialSupplier}} document={screen.doc}
   done={doc=>{setKind('ORDER');setStatus('');setPage(1);setScreen({type:'detail',id:doc.id,notice:'documentSaved'});}}/>;
 if(screen?.type==='edit')return <DocumentEditor {...{context,api,c,lang,close}} kind={screen.kind} document={screen.doc} seed={screen.seed} done={doc=>setScreen({type:'detail',id:doc.id,notice:'documentSaved'})}/>;
 if(screen?.type==='detail')return <DocumentDetail {...{context,api,c,lang,close}} id={screen.id} notice={screen.notice} edit={doc=>setScreen({type:'edit',kind:doc.kind,doc})} receive={seed=>setScreen({type:'edit',kind:'RECEIPT',seed})}/>;
 return <section className="space-y-5"><div className="flex flex-wrap justify-between gap-3 items-center"><div><h2 className="font-bold text-lg">{c('purchases')}</h2><p className="text-sm text-slate-500 mt-1">{c('purchasesHint')}</p><p className="mt-1 text-xs text-slate-500">{lang==='ar'?'الرصيد الافتتاحي للبضاعة التي كانت لديك قبل بدء استخدام النظام.':'Opening stock is for goods you already had before using the system.'}</p></div><div className="flex flex-wrap gap-2">{context.permissions['receiving.create']&&<PurchaseAction lang={lang} label={c('newReceipt')} hint={c('newReceiptTooltip')} className={primaryClass} onClick={()=>setScreen({type:'edit',kind:'RECEIPT'})}/>}{context.permissions['purchasing.manage']&&<PurchaseAction lang={lang} label={c('newOrder')} hint={c('newOrderTooltip')} className={buttonClass} onClick={()=>setScreen({type:'edit',kind:'ORDER'})}/>}</div></div>
 <div className="max-w-xs"><Select id="document-kind" label={c('documents')} value={kind} onChange={e=>{setKind(e.target.value);setStatus('');setPage(1);}}>{['RECEIPT','ORDER'].map(k=><option key={k} value={k}>{c(k)}</option>)}</Select></div>
 <Feedback {...{error,c}} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}
 <Table showRows={!!data} filters={<><Select id="document-state" label={c('status')} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{c('all')}</option>{(kind==='ORDER'?['DRAFT','OPEN','PARTIAL','RECEIVED','CANCELLED']:['DRAFT','PENDING','COMPLETED','CANCELLED']).map(k=><option key={k} value={k}>{c(k)}</option>)}</Select>
 {!initialSupplier&&context.permissions['suppliers.view']&&<><button className={buttonClass} onClick={e=>{trigger.current=e.currentTarget;setPicker(true);}}>{supplier?.name||c('filterSupplier')}</button>{supplier&&<button className={buttonClass} onClick={()=>{setSupplier(null);setPage(1);}}>{c('clearFilter')}</button>}</>}</>} filtersActive={Boolean(status)||Boolean(supplier&&!initialSupplier)} c={c} headers={['reference','selectedSupplier',...(kind==='ORDER'?['orderDate']:['selectedLocation','documentDate']),'status','actions']} empty={!data?.items.length} tableClassName="min-w-[640px]">{data?.items.map(doc=><tr key={doc.id}><td className="px-5 py-3 break-all min-w-48" dir="ltr">{doc.reference}</td><td className="px-5 py-3">{doc.supplierName||'—'}</td>{kind!=='ORDER'&&<td className="px-5 py-3">{doc.locationName}</td>}<td className="px-5 py-3" dir="ltr">{doc.documentDate}</td><td className="px-5 py-3">{c(doc.status)}</td><td className="px-5 py-3"><button className={buttonClass} onClick={()=>setScreen({type:'detail',id:doc.id})}>{c('openDocument')}</button></td></tr>)}</Table>
 {data&&<Pager {...{data,setPage,c}}/>}
 {picker&&<RecordPicker {...{api,c,lang}} path={`${path}/suppliers?state=all`} onAddSupplier={context.permissions['suppliers.create']?()=>{setPicker(false);setAddingSupplier(true);}:undefined} title={c('chooseSupplier')} returnFocus={trigger.current} close={()=>setPicker(false)} onSelect={row=>{setSupplier(row);setPage(1);setPicker(false);}}/>}
 {addingSupplier&&<SupplierForm {...{api,c,lang}} path={`${path}/suppliers`} returnFocus={trigger.current}
  close={()=>setAddingSupplier(false)} done={saved=>{setSupplier(saved);setPage(1);setAddingSupplier(false);}}/>}
 </section>;
}
