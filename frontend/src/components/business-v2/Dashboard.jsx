import {PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import {useState} from 'react';
import Disclosure from './Disclosure';
import {buttonClass,primaryClass} from './UI';
import { currencyFormatter } from '../../lib/currencyFormat';
import SetupProgressCard from './SetupProgressCard';
import DashboardActions from './DashboardActions';
import MySalesDay from './MySalesDay';
import DashboardCharts from './DashboardCharts';
import {useResource} from './useBusinessApi';
import { ChartNoAxesCombined, Info, Receipt, RotateCcw, ShoppingBag, ShoppingCart, TrendingUp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Feedback } from './UI';

const metrics = [
  ['sales', 'Sales', 'المبيعات', ShoppingCart],
  ['purchases', 'Purchases', 'المشتريات', ShoppingBag],
  ['customerReturns', 'Returns', 'المرتجعات', RotateCcw],
  ['expenses', 'Expenses', 'المصروفات', Receipt],
  ['estimatedProfit', 'Estimated profit', 'الربح التقديري', ChartNoAxesCombined],
  ['netSales', 'Net Sales', 'صافي المبيعات', TrendingUp],
];
const cardClass = 'min-h-24 min-w-0 rounded-xl border px-3 py-4 shadow-sm sm:px-4';

function Summary({context, api, c, lang, pinLocked}) {
  const ar = lang === 'ar';
  const [period,setPeriod]=useState('today');
  const { timezone } = context.business;
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const path = `/businesses/${context.business.id}/workflows/reports?view=summary&from=${period==='today'?today:today.slice(0,8)+'01'}&to=${today}`;
  const {data,error,reload} = useResource(api,path);
  const format = data && currencyFormatter(lang,{style:'currency',currency:data.currency});

  return <section className="space-y-4" aria-label={ar ? 'ملخص نشاطك' : 'Your business at a glance'}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-slate-900">{ar ? 'كيف يسير عملك؟' : 'How is business going?'}</h3>
      <bdi className="text-xs text-slate-500">{timezone}</bdi>
    </div>
    <div className="flex gap-2" role="group" aria-label={ar?'الفترة':'Period'}>{['today','month'].map(value=><button key={value} type="button" aria-pressed={period===value} className={period===value?primaryClass:buttonClass} onClick={()=>setPeriod(value)}>{value==='today'?(ar?'اليوم':'Today'):(ar?'هذا الشهر':'This month')}</button>)}</div>
    <Feedback error={error} c={c} retry={reload} />
    {!data && !error && <LoadingState>{c('loading')}</LoadingState>}
    {data && <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(8rem,9rem))]">
      {metrics.filter(([key])=>['sales','expenses','estimatedProfit'].includes(key)&&data[key]!==undefined&&(!pinLocked||key==='sales')).map(([key,en,arabic,Icon])=><div key={key} className={`${cardClass} ${key === 'netSales' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
        <dt className="flex items-center gap-1 text-sm text-slate-600">
          <Icon className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <span className="min-w-0">{ar ? arabic : en}</span>
          {key === 'estimatedProfit' && <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-emerald-50 hover:text-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-500"
                aria-label={ar ? 'كيف تُحسب الأرباح؟' : 'How is profit calculated?'}>
                <Info className="h-4 w-4" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent dir={ar ? 'rtl' : 'ltr'} sideOffset={8}
              className="w-80 max-w-[calc(100vw-2rem)] border-slate-200 bg-white text-start text-sm leading-relaxed text-slate-700">
              <div className="space-y-2">
                <p className="font-semibold text-slate-900">{ar ? 'كيف يُحسب الربح التقديري؟' : 'How is estimated profit calculated?'}</p>
                <p>{ar
                  ? 'نبدأ بالمبيعات بعد المرتجعات وقبل الضريبة، ثم نطرح تكلفة البضاعة المباعة والمصروفات.'
                  : 'Start with sales after returns, excluding tax. Subtract the cost of goods sold and recorded expenses.'}</p>
                <p>{ar
                  ? 'نأخذ أيضًا في الحسبان فروق الجرد، وتالف المخزون وفاقد التحويل، وفروق تكلفة مرتجعات الموردين.'
                  : 'The estimate also includes stock count adjustments, damage, transfer losses, and supplier return cost differences.'}</p>
                <p className="rounded-lg bg-emerald-50 p-2 text-emerald-900">{ar
                  ? 'مثال: مبيعات ١٠٠ − تكلفة ٦٠ − مصروفات ١٠ = ربح تقديري ٣٠.'
                  : 'Example: 100 in sales − 60 in costs − 10 in expenses = 30 estimated profit.'}</p>
                <p>{ar?'الربح التقديري ليس النقد الموجود في الصندوق. يعتمد على التكاليف والمصروفات التي سجّلتها.':'Estimated profit is not the cash in your drawer. It depends on the costs and expenses you recorded.'}</p>
                {data.unvaluedTransferLosses > 0 && <p className="text-amber-800">{c('profitMissingLossCosts')}</p>}
              </div>
            </PopoverContent>
          </Popover>}
        </dt>
        <dd className="mt-1 break-words text-lg font-semibold tabular-nums text-slate-900">
          <bdi>{data[key]===null ? c('profitUnavailable') : format.format(data[key])}</bdi>
        </dd>
      </div>)}
    </dl>}
    {data && !pinLocked && <Disclosure title={ar?'تفاصيل أكثر ورسوم بيانية':'More details and charts'}><DashboardCharts data={pinLocked?Object.fromEntries(Object.entries(data).filter(([key])=>!['expenses','grossProfit','estimatedProfit','estimatedCost','damageCost','transferLossCost','supplierReturnAdjustment','countAdjustmentValue'].includes(key))):data} lang={lang}/></Disclosure>}
  </section>;
}
export default function Dashboard({context,api,c,lang,onSection,visibleTabs,pinLocked}){
 return <PageLayout title={c('dashboard')} data-testid="business-dashboard"
  accessory={<bdi className="break-words rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">{context.business.name}</bdi>}>
  <DashboardActions permissions={context.permissions} {...{lang,onSection,visibleTabs}}/><SetupProgressCard {...{context,api,lang,onSection,visibleTabs}}/>{context.permissions['reports.view']?<><Summary key={String(pinLocked)} {...{context,api,c,lang,pinLocked}}/><MoneyNext {...{context,lang,onSection,visibleTabs}}/></>:context.permissions['sales.view']&&<MySalesDay {...{context,api,c,lang,onSection,visibleTabs}}/>}</PageLayout>;
}

function MoneyNext({context,lang,onSection,visibleTabs}){
 const ar=lang==='ar',p=context.permissions;
 if(!visibleTabs.includes('reports'))return null;
 const links=[...(p['catalogue.cost']&&p['purchasing.view']?[['balances',ar?'ما عليك للموردين وما لهم أن يعيدوه لك':'What you owe suppliers and what they owe you']]:[]),...(p['payments.view']?[['refunds',ar?'مبالغ يجب إعادتها للعملاء':'Customer refunds to pay']]:[])];
 return links.length>0&&<section className="space-y-3"><h3 className="font-semibold">{ar?'مبالغ تحتاج إلى متابعة':'Money to follow up'}</h3><div className="flex flex-wrap gap-3">{links.map(([view,label])=><button type="button" key={view} className={buttonClass} onClick={()=>onSection('reports',view)}>{label}</button>)}</div></section>;
}
