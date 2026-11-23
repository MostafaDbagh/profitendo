import SupplierForm from './SupplierForm';
import { PackageCheck, ShoppingCart } from 'lucide-react';
import { useRef, useState } from 'react';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Pager, Select, Table, buttonClass } from '../business-v2/UI';
import RecordPicker from './RecordPicker';
import DocumentEditor from './DocumentEditor';
import PlannedOrderEditor from './PlannedOrderEditor';
import DocumentDetail from './DocumentDetail';
function PurchaseAction({label,hint,icon:Icon,onClick,selected,disabled}){
 return <button type="button" onClick={onClick} aria-pressed={selected} disabled={disabled}
  className={`${selected?'!border-emerald-400 !bg-emerald-50':''} disabled:opacity-60 disabled:cursor-wait group flex min-w-0 flex-col items-start rounded-xl border border-slate-200 bg-slate-50 p-5 text-start transition-colors hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 sm:p-6`}>
  <Icon aria-hidden="true" className="mb-5 h-8 w-8 text-emerald-700" strokeWidth={1.8}/>
  <span className="text-lg font-bold text-slate-900 sm:text-xl">{label}</span>
  <span className="mt-2 text-sm leading-relaxed text-slate-600">{hint}</span>
 </button>;
}
export default function Purchases({context,api,c,lang,initialSupplier,initialAction}){
 const [kind,setKind]=useState('ALL'),[page,setPage]=useState(1),[supplier,setSupplier]=useState(initialSupplier||null),[picker,setPicker]=useState(false),[screen,setScreen]=useState(() => initialAction === 'new' && context.permissions['receiving.create'] ? {type:'edit',kind:'RECEIPT'} : null),[status,setStatus]=useState(''),trigger=useRef(null);
 const [addingSupplier,setAddingSupplier]=useState(false),[editorBusy,setEditorBusy]=useState(false);
 const path=`/businesses/${context.business.id}/operations`;
 const {data,error,reload}=useResource(api,`${path}/purchases?kind=${kind}&page=${page}${supplier?`&supplierId=${supplier.id}`:''}${status?`&status=${status}`:''}`);
 function close(){setScreen(null);reload();}
 const editor=screen?.type==='edit'?(screen.kind==='ORDER'&&!screen.doc?.locationId
  ? <PlannedOrderEditor embedded onBusyChange={setEditorBusy} {...{context,api,c,lang,close,initialSupplier}} document={screen.doc}
   done={doc=>{setKind('ORDER');setStatus('');setPage(1);setScreen({type:'detail',id:doc.id,notice:'documentSaved'});}}/>
  : <DocumentEditor embedded onBusyChange={setEditorBusy} {...{context,api,c,lang,close}} kind={screen.kind} document={screen.doc} seed={screen.seed} done={doc=>setScreen({type:'detail',id:doc.id,notice:'documentSaved'})}/>):null;
 if(screen?.type==='detail')return <DocumentDetail {...{context,api,c,lang,close}} id={screen.id} notice={screen.notice} edit={doc=>setScreen({type:'edit',kind:doc.kind,doc})} receive={seed=>setScreen({type:'edit',kind:'RECEIPT',seed})}/>;
 return <section className="space-y-5"><h2 className="font-bold text-lg">{c('purchases')}</h2>
 {(context.permissions['purchasing.manage']||context.permissions['receiving.create'])&&<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4" dir={lang==='ar'?'rtl':'ltr'}>
  {context.permissions['purchasing.manage']&&<PurchaseAction selected={screen?.kind==='ORDER'} disabled={editorBusy} icon={ShoppingCart} label={lang==='ar'?'طلب من المورد':'Order from supplier'} hint={lang==='ar'?'إنشاء طلب شراء':'Create a purchase order'} onClick={()=>{if(screen?.kind!=='ORDER')setScreen({type:'edit',kind:'ORDER'});}}/>}
  {context.permissions['receiving.create']&&<PurchaseAction selected={screen?.kind==='RECEIPT'} disabled={editorBusy} icon={PackageCheck} label={lang==='ar'?'استلام مخزون':'Receive stock'} hint={lang==='ar'?'تسجيل البضاعة المستلمة':'Record received goods'} onClick={()=>{if(screen?.kind!=='RECEIPT')setScreen({type:'edit',kind:'RECEIPT'});}}/>}
 </div>}

 {editor?<div className="border-t border-slate-200 pt-5">{editor}</div>:<>
 <div className="max-w-xs"><Select id="document-kind" label={c('operationType')} value={kind} onChange={e=>{setKind(e.target.value);setStatus('');setPage(1);}}>{['ALL','ORDER','RECEIPT'].map(k=><option key={k} value={k}>{c(k==='ALL'?'all':k==='ORDER'?'newOrder':'newReceipt')}</option>)}</Select></div>
 <Feedback {...{error,c}} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}
 <Table showRows={!!data} filters={<><Select id="document-state" label={c('status')} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{c('all')}</option>{(kind==='ALL'?['DRAFT','OPEN','PARTIAL','RECEIVED','PENDING','COMPLETED','CANCELLED']:kind==='ORDER'?['DRAFT','OPEN','PARTIAL','RECEIVED','CANCELLED']:['DRAFT','PENDING','COMPLETED','CANCELLED']).map(k=><option key={k} value={k}>{c(k)}</option>)}</Select>
 {!initialSupplier&&context.permissions['suppliers.view']&&<><button className={buttonClass} onClick={e=>{trigger.current=e.currentTarget;setPicker(true);}}>{supplier?.name||c('filterSupplier')}</button>{supplier&&<button className={buttonClass} onClick={()=>{setSupplier(null);setPage(1);}}>{c('clearFilter')}</button>}</>}</>} filtersActive={Boolean(status)||Boolean(supplier&&!initialSupplier)} c={c} headers={['reference',...(kind==='ALL'?['operationType']:[]),'selectedSupplier',...(kind==='ORDER'?['orderDate']:['selectedLocation','documentDate']),'status','actions']} empty={!data?.items.length} tableClassName="min-w-[640px]">{data?.items.map(doc=><tr key={doc.id}><td className="px-5 py-3 break-all min-w-48" dir="ltr">{doc.reference}</td>{kind==='ALL'&&<td className="px-5 py-3">{c(doc.kind==='ORDER'?'newOrder':'newReceipt')}</td>}<td className="px-5 py-3">{doc.supplierName||'—'}</td>{kind!=='ORDER'&&<td className="px-5 py-3">{doc.locationName||'—'}</td>}<td className="px-5 py-3" dir="ltr">{doc.documentDate}</td><td className="px-5 py-3">{c(doc.status)}</td><td className="px-5 py-3"><button className={buttonClass} onClick={()=>setScreen({type:'detail',id:doc.id})}>{c('openDocument')}</button></td></tr>)}</Table>
 {data&&<Pager {...{data,setPage,c}}/>}
 {picker&&<RecordPicker {...{api,c,lang}} path={`${path}/suppliers?state=all`} onAddSupplier={context.permissions['suppliers.create']?()=>{setPicker(false);setAddingSupplier(true);}:undefined} title={c('chooseSupplier')} returnFocus={trigger.current} close={()=>setPicker(false)} onSelect={row=>{setSupplier(row);setPage(1);setPicker(false);}}/>}
 {addingSupplier&&<SupplierForm {...{api,c,lang}} path={`${path}/suppliers`} returnFocus={trigger.current}
  close={()=>setAddingSupplier(false)} done={saved=>{setSupplier(saved);setPage(1);setAddingSupplier(false);}}/>}
 </>}
 </section>;
}
