import {useResource} from './useBusinessApi';
import {Feedback,buttonClass,panelClass} from './UI';
function Summary({context,api,c,lang}){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:context.business.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const {data,error,reload}=useResource(api,`/businesses/${context.business.id}/workflows/reports?view=summary&from=${today.slice(0,8)}01&to=${today}`);
 return <><p className="text-sm text-slate-500">{lang==='ar'?'ملخص هذا الشهر':'This month’s overview'} · {context.business.timezone}</p><Feedback error={error} c={c} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}{data&&<dl className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">{['saleCount','netSales','customerReturns','expenses','estimatedProfit','zeroStockProducts'].filter(k=>data[k]!==undefined).map(k=><div key={k} className={panelClass}><dt className="text-sm text-slate-500">{c(`metric_${k}`)}</dt><dd className="mt-2 text-2xl font-bold"><bdi>{['saleCount','zeroStockProducts'].includes(k)?data[k]:new Intl.NumberFormat(lang,{style:'currency',currency:data.currency}).format(data[k])}</bdi></dd></div>)}</dl>}{data?.estimatedProfit!==undefined&&<p className="text-xs text-slate-500">{c('profitEstimateHint')}</p>}</>;
}
export default function Dashboard({context,api,c,lang,onSection}){
 const links=[['sales','sales.view'],['inventory','inventory.view'],['purchases','purchasing.view'],['billing','billing.manage'],['team','team.view']].filter(([,permission])=>context.permissions[permission]);
 return <section className="space-y-5" data-testid="business-dashboard"><div><h2 className="text-xl font-bold">{c('dashboard')}</h2><p className="text-slate-500 mt-1">{context.business.name}</p></div>{context.permissions['reports.view']&&<Summary {...{context,api,c,lang}}/>}<div className={`${panelClass} space-y-4`}><h3 className="font-bold">{lang==='ar'?'إجراءات سريعة':'Quick actions'}</h3><div className="flex flex-wrap gap-3">{links.map(([key])=><button key={key} className={buttonClass} onClick={()=>onSection(key)}>{c(key)}</button>)}</div></div></section>;
}
