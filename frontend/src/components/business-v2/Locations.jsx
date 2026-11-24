import {Pencil,Plus,Store,Users,Warehouse} from 'lucide-react';
import { useRef, useState } from 'react';
import { useResource } from './useBusinessApi';
import { Feedback, Modal, Pager, buttonClass, primaryClass } from './UI';
import LocationForm from './LocationForm';
import LocationAssignments from './LocationAssignments';
export default function Locations({ context, api, c, lang, initialAction }) {
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
  function done(saved=true){setDialog(null);setNotice(saved?'saved':'');reload();}
  async function changeStatus(){setBusy(true);setFailure('');try{await api(`${path}/${dialog.location.id}`,{method:'PATCH',body:{revision:dialog.location.revision,active:!!dialog.location.archivedAt}});done();}catch(e){setFailure(e.message);}finally{setBusy(false);}}
  return <section className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold">{c('locations')}</h2>
      {manage&&<div className="flex flex-wrap gap-2">
        <button type="button" className={primaryClass} onClick={event=>open(event,'create',null,'SHOP')}><Plus aria-hidden="true"/>{addShop}</button>
        <button type="button" className={buttonClass} onClick={event=>open(event,'create',null,'WAREHOUSE')}><Plus aria-hidden="true"/>{addWarehouse}</button>
      </div>}
    </header>
    <Feedback error={error} notice={notice} c={c} retry={reload}/>
    {!data&&!error&&<p role="status" className="text-sm text-slate-500">{c('loading')}</p>}
    {data&&<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {data.items.length===0?<p className="p-6 text-center text-sm text-slate-500">{c('empty')}</p>:
        <ul className="divide-y divide-slate-100">
          {data.items.map(location=>{
            const Icon=location.kind==='WAREHOUSE'?Warehouse:Store;
            return <li key={location.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Icon className="h-5 w-5" aria-hidden="true"/></span>
                <div className="min-w-0">
                  <p className="break-words font-semibold text-slate-900">{location.name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    {c(location.kind)}{location.archivedAt&&<span className="rounded-full bg-slate-100 px-2 py-0.5">{c('archived')}</span>}
                  </p>
                  {location.address&&<p className="mt-1 break-words text-xs text-slate-500">{location.address}</p>}
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
  </section>;
}
