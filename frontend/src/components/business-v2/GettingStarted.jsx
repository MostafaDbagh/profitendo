import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {CheckCircle2,ArrowRight} from 'lucide-react';
import {useState} from 'react';
import SupportInbox,{TicketForm} from '../support-v2/Support';
import Disclosure from './Disclosure';
import {panelClass,primaryClass,buttonClass} from './UI';
import {useWorkspaceSetup} from './workspaceSetup';
const copy={
 en:{title:'Let’s get your shop ready',intro:'Start with your shop and products. Then record your first real sale.',shop:['Add your shop','Enter the name of the shop where you sell. You can add warehouses later.','Add shop'],products:['Add your products','Start with one product: its name, unit, purchase cost and selling price. Add the rest later, or import your list from Products.','Add product'],sale:['Make your first sale','Choose a product, enter the quantity and record the payment. Only record a real sale.','Start a sale'],stock:'Before selling: receive your goods into the shop. Adding a product alone does not add stock. You can add the supplier during receiving.',receive:'Receive goods',done:'Done',loading:'Checking progress…',failed:'Could not check this step.',retry:'Try again',support:'Need help?',help:'Ask our team',again:'Open',complete:'You’ve made your first sale. You’re ready to keep going.'},
 ar:{title:'لنجهّز متجرك',intro:'ابدأ بمتجرك ومنتجاتك، ثم سجّل أول عملية بيع فعلية.',shop:['أضف متجرك','أدخل اسم المتجر الذي تبيع فيه. يمكنك إضافة المستودعات لاحقاً.','إضافة متجر'],products:['أضف منتجاتك','ابدأ بمنتج واحد: الاسم والوحدة وتكلفة الشراء وسعر البيع. أضف الباقي لاحقاً أو استورد قائمتك من المنتجات.','إضافة منتج'],sale:['سجّل أول عملية بيع','اختر المنتج وأدخل الكمية وسجّل الدفع. سجّل عملية بيع حقيقية فقط.','بدء عملية بيع'],stock:'قبل البيع: سجّل استلام البضاعة في المتجر. إضافة اسم المنتج وحدها لا تضيف كمية للمخزون. يمكنك إضافة المورد أثناء الاستلام.',receive:'استلام بضاعة',done:'مكتمل',loading:'جارٍ التحقق من التقدم…',failed:'تعذر التحقق من هذه الخطوة.',retry:'حاول مجدداً',support:'تحتاج مساعدة؟',help:'اسأل فريقنا',again:'فتح',complete:'سجّلت أول عملية بيع. يمكنك الآن متابعة عملك.'}
};
export default function GettingStarted({context,api,lang,onSection,visibleTabs}){
 const text=copy[lang==='ar'?'ar':'en'],steps=useWorkspaceSetup(context,api,visibleTabs),next=steps.find(step=>step.complete!==true);
 const [version,setVersion]=useState(0),[sent,setSent]=useState(false);
 return <PageLayout as="div" className="mx-auto max-w-3xl"><section className={`${panelClass} space-y-5`}>
  <PageHeader title={steps.length?text.title:text.support}/>
  {steps.length>0&&!next&&<p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{steps.some(step=>step.id==='sale'&&step.complete)?text.complete:text.done}</p>}
  <ol className="space-y-3">{steps.map(step=>{const [title,hint,action]=text[step.id],Icon=step.complete?CheckCircle2:step.Icon;return <li key={step.id} className={`rounded-xl border p-4 space-y-3 ${step.id===next?.id?'border-emerald-200 bg-emerald-50/30':'border-slate-200 bg-white'}`}>
   <div className="flex gap-3 items-start"><Icon aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-emerald-700"/><div><h3 className="font-semibold">{step.number}. {title}</h3><p className="mt-1 text-sm text-slate-600">{hint}</p></div></div>
   {step.error?<p role="alert" className="text-sm text-red-700">{text.failed} <button className="underline" onClick={step.retry}>{text.retry}</button></p>:step.complete===null?<p role="status" className="text-sm text-slate-500">{text.loading}</p>:step.complete&&<p className="text-sm text-emerald-700">{text.done}</p>}
   {step.id==='sale'&&!step.complete&&<div className="rounded-lg bg-slate-50 p-3 space-y-2"><p className="text-sm text-slate-600">{text.stock}</p>{step.canReceive&&<button type="button" className={buttonClass} onClick={()=>onSection('purchases','new')}>{text.receive}</button>}</div>}
   <button type="button" className={step.id===next?.id?primaryClass:buttonClass} onClick={()=>onSection(step.tab,step.complete?undefined:step.action)}>{step.complete?text.again:action}<ArrowRight aria-hidden="true" className="h-4 w-4 rtl:rotate-180"/></button>
  </li>;})}</ol>
 </section><Disclosure title={text.support}><h3 className="font-semibold">{text.help}</h3>{sent&&<p role="status">{lang==='ar'?'تم إرسال سؤالك.':'Your question was sent.'}</p>}<TicketForm key={`form-${version}`} {...{api,lang}} session fixedBusinessId={context.business.id} onCreated={()=>{setSent(true);setVersion(v=>v+1);}}/><SupportInbox key={`inbox-${version}`} {...{api,lang}} businessId={context.business.id}/></Disclosure></PageLayout>;
}
