import { useState } from 'react';
import { Check, RefreshCw, ArrowUpRight } from 'lucide-react';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, buttonClass, primaryClass } from '../business-v2/UI';
import { translator } from '../support-v2/copy';
export default function PaidAccess({businessId,api,lang}) {
  const c=translator(lang),t=(en,ar)=>lang==='ar'?ar:en,path=`/billing/businesses/${businessId}`;
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState('');
  const state=useResource(api,path),approvals=useResource(api,path+'/approvals');
  async function act(plan,approved){setBusy(true);setFailure('');try{const result=await api(path+(approved?'/checkout':'/approvals'),{method:'POST',body:approved?{planId:plan.id,confirm:true}:{planId:plan.id}});if(approved&&result.approvalUrl)window.location.assign(result.approvalUrl);else{approvals.reload();state.reload();}}catch(e){setFailure(e.message);}finally{setBusy(false);}}
  const plans=[...new Map([...(state.data?.plans||[]),...(approvals.data||[]).map(a=>a.plan)].filter(Boolean).map(p=>[p.id,p])).values()].filter(p=>p.priceMinor!==null);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1"><h3 className="text-lg font-bold text-slate-900">{c('approvals')}</h3><p className="text-sm text-slate-500">{c('approvalHint')}</p></div>
      <button className={buttonClass} disabled={busy} onClick={()=>{approvals.reload();state.reload();}}><RefreshCw className="w-4 h-4" aria-hidden="true" />{c('reload')}</button>
    </div>
    <Feedback error={failure||state.error||approvals.error} c={c} retry={()=>{state.reload();approvals.reload();}} />
    {(!state.data||!approvals.data)&&!state.error&&!approvals.error&&<p role="status" className="text-sm text-slate-500">{c('loading')}</p>}
    {state.data&&approvals.data&&<>
      {!plans.length&&<div className="rounded-xl border border-dashed border-slate-300 bg-white p-6"><p className="font-semibold text-slate-700">{t('No paid plans available yet','لا توجد خطط مدفوعة متاحة حاليًا')}</p><p className="text-sm text-slate-500 mt-1">{c('paymentUnavailable')}</p></div>}
      <div className="grid lg:grid-cols-2 gap-4">{plans.map(p=>{
        const request=approvals.data.find(r=>r.planId===p.id),approved=request?.status==='APPROVED',pending=request?.status==='PENDING';
        return <article key={p.id} className={`flex flex-col rounded-xl border bg-white shadow-sm overflow-hidden ${approved?'border-emerald-300':'border-slate-200'}`}>
          <div className="p-5 md:p-6 space-y-5 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold text-lg text-slate-900">{lang==='ar'?p.nameAr:p.name}</h4>{request&&<span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${approved?'bg-emerald-50 text-emerald-700':pending?'bg-amber-50 text-amber-800':'bg-slate-100 text-slate-600'}`}>{c(request.status)}</span>}</div>
            <p className="flex flex-wrap items-baseline gap-2"><bdi className="text-3xl font-semibold tracking-tight text-slate-900">{new Intl.NumberFormat(lang,{style:'currency',currency:p.currency}).format(p.priceMinor/100)}</bdi><span className="text-sm text-slate-500">/ {p.interval==='YEAR'?t('year','سنة'):t('month','شهر')}</span></p>
            <ul className="space-y-2 text-sm text-slate-600">{[[t('Staff places','أماكن الفريق'),p.maxMembers],[t('Warehouses','المستودعات'),p.maxWarehouses],[t('Shops','المتاجر'),p.maxShops]].map(([label,value])=><li key={label} className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" /><span className="font-semibold text-slate-800">{value}</span> {label}</li>)}</ul>
            {request?.reason&&<p className="text-sm text-slate-600 break-words rounded-lg bg-slate-50 p-3">{request.reason}</p>}
          </div>
          <div className="p-5 md:p-6 pt-0 md:pt-0 space-y-3">
            {approved&&<p className="text-xs text-slate-500">{t('Renews automatically through PayPal until cancelled.','يتجدد تلقائيًا عبر PayPal حتى الإلغاء.')}</p>}
            <button className={`${primaryClass} w-full`} disabled={busy||!p.published||pending||(approved&&!state.data.checkoutAvailable)} onClick={()=>act(p,approved)}>{c(approved?'pay':'requestApproval')}<ArrowUpRight className="w-4 h-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" /></button>
            {pending&&<p className="text-xs text-slate-500">{t('Your request is being reviewed. No payment has been taken.','طلبك قيد المراجعة. لم يتم تحصيل أي دفعة.')}</p>}
            {approved&&!state.data.checkoutAvailable&&<p className="text-xs text-slate-500">{c('paymentUnavailable')}</p>}
          </div>
        </article>;
      })}</div>
      {state.data.checkoutAvailable&&<button className={buttonClass} disabled={busy} onClick={async()=>{setBusy(true);setFailure('');try{await api(path+'/reconcile',{method:'POST',body:{}});state.reload();}catch(e){setFailure(e.message);}finally{setBusy(false);}}}>{t('Refresh payment status','تحديث حالة الدفع')}</button>}
    </>}
  </section>;
}
