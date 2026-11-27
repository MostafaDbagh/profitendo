import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import {MapPin,Pencil,Plus,Store,Users,Warehouse} from 'lucide-react';
import { useRef, useState } from 'react';
import { useResource } from './useBusinessApi';
import { Feedback, Modal, Pager, buttonClass, primaryClass } from './UI';
import LocationForm from './LocationForm';
import LocationAssignments from './LocationAssignments';
export default function Locations({ context, api, c, lang, initialAction, onLocationsChanged }) {
  const path=`/businesses/${context.business.id}/locations`,manage=context.permissions['locations.manage'];
  const [page,setPage]=useState(1);
  const [dialog,setDialog]=useState(()=>['new','setup'].includes(initialAction)&&manage?{type:'create',kind:'SHOP'}:null);
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[notice,setNotice]=useState('');
  const trigger=useRef(null);
  const {data,error,reload}=useResource(api,`${path}?page=${page}&state=all`);
  const ar=lang==='ar';
  const addShop=ar?'إضافة متجر':'Add shop';
  const addWarehouse=ar?'إضافة مستودع':'Add warehouse';
  function open(event,type,location,kind){
    trigger.current=event.currentTarget;
    setFailure('');
    setNotice('');
    setDialog({type,location,kind});
  }
  function done(saved=true){setDialog(null);setNotice(saved?'saved':'');reload();if(saved)onLocationsChanged?.();}
  async function changeStatus(){setBusy(true);setFailure('');try{await api(`${path}/${dialog.location.id}`,{method:'PATCH',body:{revision:dialog.location.revision,active:!!dialog.location.archivedAt}});done();}catch(e){setFailure(e.message);}finally{setBusy(false);}}
  return <PageLayout>
    <PageHeader title={c('locations')} accessory={manage&&<div className="flex flex-wrap gap-2">
        <button type="button" className={primaryClass} onClick={event=>open(event,'create',null,'SHOP')}><Plus aria-hidden="true"/>{addShop}</button>
        <button type="button" className={buttonClass} onClick={event=>open(event,'create',null,'WAREHOUSE')}><Plus aria-hidden="true"/>{addWarehouse}</button>
      </div>}/>
    <Feedback error={error} notice={notice} c={c} retry={reload}/>
    {!data&&!error&&<LoadingState className="text-sm text-slate-500">{c('loading')}</LoadingState>}
    {data&&<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {data.items.length===0?<p className="p-6 text-center text-sm text-slate-500">{c('empty')}</p>:
        <ul className="divide-y divide-slate-100">
          {data.items.map(location=>{
            const Icon=location.kind==='WAREHOUSE'?Warehouse:Store;
            return <li key={location.id} className="relative flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-10 sm:px-5">
              <span className="absolute start-0 top-0 rounded-ee-lg bg-emerald-700 px-4 py-1 text-xs font-semibold text-white">{c(location.kind)}</span>
              <div className="flex min-w-0 max-w-full items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Icon className="h-5 w-5" aria-hidden="true"/></span>
                <div className="min-w-0">
                  <p className="break-words font-semibold text-slate-900">{location.name}</p>
                  {location.archivedAt&&<span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{c('archived')}</span>}
                  {location.address&&<p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true"/><span className="min-w-0 break-words">{location.address}</span></p>}
                </div>
              </div>
              {manage&&<div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} onClick={event=>open(event,'edit',location)}><Pencil aria-hidden="true"/>{ar?'تعديل':'Edit'}</button>
                {!location.archivedAt&&<button type="button" className={buttonClass} onClick={event=>open(event,'assign',location)}><Users aria-hidden="true"/>{c('locationAssignments')}</button>}
                <button type="button" className={buttonClass} onClick={event=>open(event,'status',location)}>{c(location.archivedAt?'reactivateLocation':'archiveLocation')}</button>
              </div>}
            </li>;
          })}
        </ul>}
    </div>}
    {data&&data.total>data.pageSize&&<Pager {...{data,setPage,c}}/>}
    {['create','edit'].includes(dialog?.type) && <LocationForm initialKind={dialog.kind} location={dialog.location} {...{path,api,c,lang,done}} close={()=>setDialog(null)} returnFocus={trigger.current}/>}
    {dialog?.type==='assign' && <LocationAssignments location={dialog.location} {...{path,api,c,lang}} close={()=>done(false)} returnFocus={trigger.current}/>}
    {dialog?.type==='status' && <Modal title={c(dialog.location.archivedAt?'reactivateLocation':'archiveLocation')} description={c(dialog.location.archivedAt?'reactivateLocationHint':'archiveLocationHint')} {...{c,lang,busy}} close={()=>setDialog(null)} returnFocus={trigger.current}><p className="font-semibold">{dialog.location.name}</p><Feedback error={failure} c={c} retry={failure==='REVISION_CONFLICT'?()=>done(false):undefined}/><div className="flex flex-wrap justify-end rtl:justify-start gap-2"><button className={buttonClass} disabled={busy} onClick={()=>setDialog(null)}>{c('cancel')}</button><button className={primaryClass} disabled={busy || failure==='REVISION_CONFLICT'} onClick={changeStatus}>{c(busy?'saving':'confirm')}</button></div></Modal>}
  </PageLayout>;
}
