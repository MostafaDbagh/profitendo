import {BarChart,Bar,Cell,CartesianGrid,ReferenceLine,XAxis,YAxis,Tooltip,ResponsiveContainer,PieChart,Pie} from 'recharts';
import {panelClass} from './UI';
const palette={sales:'#059669',returns:'#d97706',expenses:'#0284c7',profit:'#0f766e',loss:'#dc2626',stock:'#64748b'};
const number=value=>value===null||value===undefined?null:Number.isFinite(Number(value))?Number(value):null;
export default function DashboardCharts({data,lang}){
 const ar=lang==='ar',t=(en,arabic)=>ar?arabic:en;
 const money=value=>new Intl.NumberFormat(lang,{style:'currency',currency:data.currency}).format(value);
 const compact=value=>new Intl.NumberFormat(lang,{notation:'compact',maximumFractionDigits:1}).format(value);
 const performance=[
  {key:'netSales',label:t('Net sales','صافي المبيعات'),color:palette.sales},
  {key:'customerReturns',label:t('Returns','المرتجعات'),color:palette.returns},
  {key:'expenses',label:t('Expenses','المصروفات'),color:palette.expenses},
  {key:'estimatedProfit',label:t('Estimated profit','الربح التقديري'),color:number(data.estimatedProfit)<0?palette.loss:palette.profit},
 ].map(row=>({...row,value:number(data[row.key])})).filter(row=>row.value!==null);
 const costRows=[
  {key:'estimatedCost',label:t('Cost of goods sold','تكلفة البضاعة المباعة'),color:palette.sales},
  {key:'expenses',label:t('Operating expenses','المصروفات التشغيلية'),color:palette.expenses},
  {key:'damageCost',label:t('Damaged stock','المخزون التالف'),color:palette.returns},
  {key:'transferLossCost',label:t('Transfer losses','فاقد التحويلات'),color:palette.stock},
 ].map(row=>({...row,value:number(data[row.key])}));
 const allowed=costRows.every(row=>row.value!==null),negative=costRows.some(row=>row.value<0),incomplete=!!data.unvaluedTransferLosses;
 const total=costRows.reduce((sum,row)=>sum+(row.value??0),0),slices=costRows.filter(row=>row.value>0);
 const hasActivity=performance.some(row=>row.value!==0);
 const tooltip={borderRadius:12,border:'1px solid #e2e8f0',fontSize:12,direction:ar?'rtl':'ltr'};
 return <div className={`grid gap-4 ${allowed?'xl:grid-cols-5':''}`} data-testid="dashboard-charts">
  <section className={`${panelClass} min-w-0 ${allowed?'xl:col-span-3':''}`} aria-label={t('Monthly financial comparison','المقارنة المالية الشهرية')}>
   <div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold text-slate-900">{t('Your month at a glance','أداء شهرك بالأرقام')}</h4><p className="mt-1 text-xs leading-relaxed text-slate-500">{t('Sales, returns, expenses and estimated profit','المبيعات والمرتجعات والمصروفات والربح التقديري')}</p></div><span className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-500"><bdi>{data.currency}</bdi></span></div>
   {hasActivity?<div className="h-64 mt-5" dir="ltr"><ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={performance} layout="vertical" margin={{top:4,right:16,bottom:4,left:0}} accessibilityLayer>
    <CartesianGrid horizontal={false} stroke="#e2e8f0" strokeDasharray="3 4"/><XAxis type="number" tickFormatter={compact} tick={{fontSize:11,fill:'#64748b'}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="label" width={ar?102:100} tick={{fontSize:11,fill:'#475569'}} axisLine={false} tickLine={false}/><ReferenceLine x={0} stroke="#94a3b8"/><Tooltip cursor={{fill:'#f1f5f9'}} formatter={(value,_name,entry)=>[money(value),entry.payload.label]} contentStyle={tooltip}/><Bar dataKey="value" barSize={24} radius={4} isAnimationActive={false}>{performance.map(row=><Cell key={row.key} fill={row.color}/>)}</Bar>
   </BarChart></ResponsiveContainer></div>:<div className="min-h-64 flex flex-col justify-center items-center gap-3 text-center"><div className="flex items-end gap-2 h-14" aria-hidden="true">{['h-6','h-10','h-14','h-8'].map(height=><span key={height} className={`w-5 rounded-t bg-slate-100 ${height}`}/>)}</div><p className="text-sm text-slate-500">{t('Your chart will appear as you record activity this month.','سيظهر الرسم عند تسجيل حركة أعمال هذا الشهر.')}</p></div>}
   <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">{performance.map(row=><div key={row.key} className="min-w-0"><dt className="text-xs text-slate-500 flex items-center gap-2"><span className="w-2 h-2 shrink-0 rounded-full" style={{backgroundColor:row.color}} aria-hidden="true"/>{row.label}</dt><dd className={`mt-1 text-sm font-semibold break-words tabular-nums ${row.value<0?'text-red-700':'text-slate-800'}`}><bdi>{money(row.value)}</bdi></dd></div>)}</dl>
  </section>
  {allowed&&<section className={`${panelClass} min-w-0 xl:col-span-2`} aria-label={t('Cost breakdown','توزيع التكاليف')} data-testid="dashboard-cost-donut">
   <h4 className="font-semibold text-slate-900">{t('Where your costs go','كيف تتوزع تكاليفك؟')}</h4><p className="mt-1 text-xs leading-relaxed text-slate-500">{t('Goods sold, operating expenses and recorded stock losses','البضاعة المباعة والمصروفات التشغيلية وخسائر المخزون المسجلة')}</p>
   <div className="relative h-60 mt-3" dir="ltr">{total>0&&!negative&&!incomplete?<><ResponsiveContainer width="100%" height="100%" minWidth={0}><PieChart><Pie data={slices} dataKey="value" nameKey="label" innerRadius="66%" outerRadius="88%" paddingAngle={slices.length>1?3:0} stroke="none" isAnimationActive={false}>{slices.map(row=><Cell key={row.key} fill={row.color}/>)}</Pie><Tooltip formatter={value=>money(value)} contentStyle={tooltip}/></PieChart></ResponsiveContainer><div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-12"><span className="text-xs text-slate-500">{t('Total costs','إجمالي التكاليف')}</span><bdi className="mt-1 text-xl font-semibold text-slate-900">{compact(total)}</bdi><span className="text-xs text-slate-500">{data.currency}</span></div></>:<div className="h-full flex flex-col items-center justify-center gap-3 text-center"><svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="none" stroke="#f1f5f9" strokeWidth="15"/></svg><p className="text-sm text-slate-500">{incomplete?t('Complete missing loss costs to see the breakdown.','أكمل تكاليف الفاقد الناقصة لعرض التوزيع.'):negative?t('Cost reversals are shown below; a percentage breakdown is not applicable.','تظهر تسويات التكاليف أدناه؛ لا يمكن تمثيلها كنسب في الرسم.'):t('No costs recorded this month.','لم تُسجّل تكاليف هذا الشهر.')}</p></div>}</div>
   <dl className="space-y-3 border-t border-slate-100 pt-4">{costRows.map(row=><div key={row.key} className="flex items-center justify-between gap-3 text-xs"><dt className="flex items-center gap-2 text-slate-500"><span className="h-2 w-2 shrink-0 rounded-full" style={{backgroundColor:row.color}} aria-hidden="true"/>{row.label}</dt><dd className="font-semibold text-slate-800 whitespace-nowrap tabular-nums"><bdi>{row.key==='transferLossCost'&&incomplete?t('Incomplete','غير مكتمل'):money(row.value)}</bdi></dd></div>)}</dl>
  </section>}
 </div>;
}
