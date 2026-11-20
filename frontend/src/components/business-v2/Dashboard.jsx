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
  ['estimatedProfit', 'Net Profit', 'صافي الربح', ChartNoAxesCombined],
  ['netSales', 'Net Sales', 'صافي المبيعات', TrendingUp],
];
const cardClass = 'min-h-24 min-w-0 rounded-xl border px-3 py-4 shadow-sm sm:px-4';

function Summary({context, api, c, lang}) {
  const ar = lang === 'ar';
  const { timezone } = context.business;
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const path = `/businesses/${context.business.id}/workflows/reports?view=summary&from=${today.slice(0,8)}01&to=${today}`;
  const {data,error,reload} = useResource(api,path);
  const format = data && currencyFormatter(lang,{style:'currency',currency:data.currency});

  return <section className="space-y-4" aria-label={ar ? 'ملخص هذا الشهر' : 'Monthly overview'}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-slate-900">{ar ? 'ملخص هذا الشهر' : 'This month’s overview'}</h3>
      <bdi className="text-xs text-slate-500">{timezone}</bdi>
    </div>
    <Feedback error={error} c={c} retry={reload} />
    {!data && !error && <p role="status">{c('loading')}</p>}
    {data && <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(8rem,9rem))]">
      {metrics.filter(([key])=>data[key]!==undefined).map(([key,en,arabic,Icon])=><div key={key} className={`${cardClass} ${key === 'netSales' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
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
                <p className="font-semibold text-slate-900">{ar ? 'كيف يُحسب صافي الربح؟' : 'How is net profit calculated?'}</p>
                <p>{ar
                  ? 'نبدأ بالمبيعات بعد المرتجعات وقبل الضريبة، ثم نطرح تكلفة البضاعة المباعة والمصروفات.'
                  : 'Start with sales after returns, excluding tax. Subtract the cost of goods sold and recorded expenses.'}</p>
                <p>{ar
                  ? 'نأخذ أيضًا في الحسبان فروق الجرد، وتالف المخزون وفاقد التحويل، وفروق تكلفة مرتجعات الموردين.'
                  : 'The estimate also includes stock count adjustments, damage, transfer losses, and supplier return cost differences.'}</p>
                <p className="rounded-lg bg-emerald-50 p-2 text-emerald-900">{ar
                  ? 'مثال: مبيعات ١٠٠ − تكلفة ٦٠ − مصروفات ١٠ = صافي ربح ٣٠.'
                  : 'Example: 100 in sales − 60 in costs − 10 in expenses = 30 net profit.'}</p>
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
    {data && <DashboardCharts {...{data,lang}} />}
  </section>;
}
export default function Dashboard({context,api,c,lang,onSection,visibleTabs,pinLocked}){
 return <section className="space-y-7" data-testid="business-dashboard"><div dir="ltr" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-200 pb-4"><span dir="auto" className="min-w-0 max-w-[55%] truncate rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs sm:text-sm font-medium text-emerald-800" title={context.business.name}>{context.business.name}</span><h2 dir={lang==='ar'?'rtl':'ltr'} className="min-w-0 break-words text-xl font-bold tracking-tight sm:text-2xl">{c('dashboard')}</h2></div><DashboardActions permissions={context.permissions} {...{lang,onSection,visibleTabs}}/><SetupProgressCard {...{context,api,lang,onSection,visibleTabs}}/>{context.permissions['reports.view']?<Summary key={String(pinLocked)} {...{context,api,c,lang}}/>:context.permissions['sales.view']&&<MySalesDay {...{context,api,c,lang,onSection,visibleTabs}}/>}</section>;
}
