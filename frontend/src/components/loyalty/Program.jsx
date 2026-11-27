import {useState} from 'react';
import Disclosure from '../business-v2/Disclosure';
import {Field} from '../auth-v2/Fields';
import {Feedback,buttonClass,primaryClass} from '../business-v2/UI';
import ProductSearch from '../operations-v2/ProductSearch';

export default function Program({context,api,c,lang,reload}){
 const business=context.business,root=`/businesses/${business.id}`,ar=lang==='ar';
 const [program,setProgram]=useState(()=>business.loyaltyProgram??{enabled:false,length:10,repeat:true,stages:[]});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [names,setNames]=useState({});
 function change(patch){setProgram(p=>({...p,...patch}));}
 function stage(i,patch){setProgram(p=>({...p,stages:p.stages.map((s,j)=>j===i?{...s,...patch}:s)}));}
 const valid=program.length>=1&&program.length<=365&&(!program.enabled||program.stages.length>0)&&program.stages.every(s=>s.name.trim()&&s.step>=1&&s.step<=program.length)&&new Set(program.stages.map(s=>s.step)).size===program.stages.length;
 async function save(){
  setBusy(true);setError('');
  try{await api(root+'/sales/loyalty/program',{method:'PUT',body:{program,revision:business.revision}});reload();}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <Disclosure title={ar?'برنامج الولاء':'Loyalty program'} className="max-w-3xl">
  <fieldset disabled={busy} className="space-y-4">
   <label className="flex gap-2"><input type="checkbox" checked={program.enabled} onChange={e=>change({enabled:e.target.checked})}/>{ar?'تفعيل برنامج الولاء':'Enable loyalty program'}</label>
   <Field id="loyalty-length" type="number" min={1} max={365} label={ar?'عدد الزيارات في الدورة':'Visits per cycle'} value={program.length} onChange={e=>change({length:Number(e.target.value)})}/>
   <label className="flex gap-2"><input type="checkbox" checked={program.repeat} onChange={e=>change({repeat:e.target.checked})}/>{ar?'بدء دورة جديدة تلقائيًا عند الاكتمال':'Automatically renew the completed card'}</label>
   {program.stages.map((s,i)=><div key={i} className="space-y-2 rounded-lg border p-3">
    <Field id={'gift-step-'+i} type="number" min={1} max={program.length} label={ar?'رقم الزيارة':'Visit number'} value={s.step} onChange={e=>stage(i,{step:Number(e.target.value)})}/>
    <Field id={'gift-name-'+i} maxLength={120} label={ar?'اسم الهدية':'Gift name'} value={s.name} onChange={e=>stage(i,{name:e.target.value})}/>
    {s.productId?<div><span>{names[s.productId]??(ar?'صنف مرتبط':'Linked product')}</span> <button type="button" className={buttonClass} onClick={()=>stage(i,{productId:null})}>{ar?'إلغاء ربط الصنف':'Unlink product'}</button></div>:
     <ProductSearch {...{api,root,c,lang}} label={ar?'ربط بصنف مخزون (اختياري)':'Link a stock item (optional)'} onSelect={p=>{stage(i,{productId:p.id});setNames(n=>({...n,[p.id]:p.name}));}}/>}
    <button type="button" className={buttonClass} onClick={()=>change({stages:program.stages.filter((_,j)=>i!==j)})}>{ar?'حذف المرحلة':'Remove milestone'}</button>
   </div>)}
   <button className={buttonClass} onClick={()=>change({stages:[...program.stages,{step:program.length,name:'',productId:null}]})}>{ar?'إضافة مرحلة':'Add milestone'}</button>
   <div className="rounded-lg bg-emerald-50 p-3"><strong>{ar?'معاينة البطاقة':'Card preview'} · {program.length}</strong>{[...program.stages].sort((a,b)=>a.step-b.step).map((s,i)=><p key={i}>{ar?'الزيارة':'Visit'} {s.step} · {s.name}</p>)}</div>
   {!valid&&<p>{ar?'أدخل اسم كل هدية ورقم زيارة فريدًا ضمن طول الدورة.':'Enter a gift name and a unique visit number within the cycle.'}</p>}
   <Feedback {...{error,c}}/><button className={primaryClass} disabled={!valid||busy} onClick={save}>{c('save')}</button>
  </fieldset>
 </Disclosure>;
}
