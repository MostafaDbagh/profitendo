import {useState} from 'react';
import {Field} from '../auth-v2/Fields';
import {Feedback,buttonClass} from '../business-v2/UI';
import Card from './Card';

export default function CustomerLink({api,path,c,lang,linked,onLink,phone,setPhone,name,setName,locationId}){
 const ar=lang==='ar';
 const [found,setFound]=useState(undefined),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function lookup(register=false){
  setBusy(true);setError('');
  try{
   const result=await api(path+(register?'/customers':'/customers/lookup'),{method:'POST',body:register?{phone,name}:{phone}});
   if(register)onLink(result.customer);else setFound(result.customer);
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <div className="space-y-2 sm:col-span-2">
  <Feedback {...{c,error}}/>
  {linked?<><strong>{name}</strong> · <bdi>{phone}</bdi>
   <Card {...{api,path,c,lang,locationId}} id={linked}/>
   <button type="button" className={buttonClass} onClick={()=>{onLink(null);setFound(undefined);}}>{ar?'تغيير العميل أو إلغاء الربط':'Change or unlink customer'}</button>
  </>:<>
   <Field id="sale-customer-phone" dir="ltr" autoComplete="tel" placeholder="0912345678" label={ar?'رقم هاتف العميل':'Customer phone'} value={phone} disabled={busy} maxLength={40} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(phone.trim()&&!busy)lookup();}}} onChange={e=>{setPhone(e.target.value);setFound(undefined);setError('');}}/>
   <button type="button" disabled={busy||!phone.trim()} className={buttonClass} onClick={()=>lookup()}>{ar?'بحث بالهاتف':'Find by phone'}</button>
   {found?<div className="flex items-center gap-2"><strong>{found.name}</strong><button type="button" className={buttonClass} onClick={()=>onLink(found)}>{ar?'ربط بالبيع':'Link to sale'}</button></div>:
    <><Field id="sale-customer" label={c('saleCustomer')} value={name} onChange={e=>setName(e.target.value)} disabled={busy} maxLength={150}/>
     {found===null&&<button type="button" disabled={busy||!name.trim()} className={buttonClass} onClick={()=>lookup(true)}>{ar?'حفظ وربط بالبيع':'Save and link to sale'}</button>}
    </>}
  </>}
 </div>;
}
