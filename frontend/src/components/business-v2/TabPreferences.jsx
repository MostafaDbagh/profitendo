import { ArrowUp, ArrowDown } from 'lucide-react';
import { useState } from 'react';
import { Feedback, panelClass, primaryClass, buttonClass } from './UI';
const bottom = ['security', 'settings'];
const fixed = ['dashboard', 'billing', 'security', 'settings'];
export default function TabPreferences({ context, api, c, lang, availableTabs, hiddenTabs, tabOrder, onTabsSaved }) {
  const [hidden, setHidden] = useState(hiddenTabs), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [order, setOrder] = useState(() => [...tabOrder, ...availableTabs.map(([key])=>key).filter(key=>!tabOrder.includes(key))]);
  const orderedTabs = [...order.filter(key=>!bottom.includes(key)), ...bottom].filter(key=>availableTabs.some(([id])=>id===key));
  function move(key, offset) {
    const target = orderedTabs[orderedTabs.indexOf(key)+offset];
    if (!target || bottom.includes(key) || bottom.includes(target)) return;
    setOrder(rows => {const next=[...rows], a=next.indexOf(key), b=next.indexOf(target);[next[a],next[b]]=[next[b],next[a]];return next;});setNotice('');
  }
  const ar = lang === 'ar';
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/businesses/${context.business.id}/preferences`, { method: 'PATCH', body: { hiddenTabs: hidden, tabOrder: order } });
      setHidden(result.hiddenTabs); onTabsSaved(result); setNotice('saved');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <form onSubmit={save} className={`${panelClass} space-y-5 max-w-3xl`} data-testid="tab-preferences">
    <div><h2 className="text-lg font-bold">{ar ? 'تخصيص تبويبات لوحتي' : 'Customize my dashboard tabs'}</h2><p className="text-sm text-slate-500 mt-2">{ar ? 'اختر التبويبات التي تحتاجها في هذا النشاط. تُحفظ اختياراتك لحسابك فقط على جميع أجهزتك. إخفاء التبويب لا يحذف بياناته ولا يغيّر صلاحيات الفريق.' : 'Choose the tabs you need for this business. Your choices apply only to your account, across devices. Hiding a tab does not delete its data or change team permissions.'}</p></div>
    <Feedback {...{c,error,notice}} />
    <fieldset disabled={busy} className="space-y-3"><legend className="text-sm font-medium mb-3">{ar ? 'التبويبات من الأعلى إلى الأسفل' : 'Tabs from top to bottom'}</legend>
      <p className="text-sm text-slate-500">{ar ? 'استخدم الأسهم لترتيب التبويبات، ثم احفظ التغييرات.' : 'Use the arrows to arrange your tabs, then save your changes.'}</p>
      <ol className="space-y-2">{orderedTabs.map((key,index) => <li key={key} data-tab-key={key} className="flex items-center gap-2 border border-slate-200 rounded-xl p-3 text-sm">
        <span aria-hidden="true" className="w-6 shrink-0 text-center font-semibold tabular-nums text-slate-500">{index+1}</span>
        <label className="flex flex-1 min-w-0 items-center gap-3 cursor-pointer">
          <input type="checkbox" className="h-5 w-5 shrink-0 accent-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-500" checked={fixed.includes(key) || !hidden.includes(key)} disabled={fixed.includes(key)} onChange={e => {setNotice('');setHidden(rows => e.target.checked ? rows.filter(v => v !== key) : [...rows, key]);}} />
          <span>{c(key)}{fixed.includes(key) && <span className="block text-xs text-slate-500 mt-1">{ar ? (bottom.includes(key) ? 'ثابت أسفل القائمة' : 'متاح دائماً') : (bottom.includes(key) ? 'Pinned to bottom' : 'Always available')}</span>}</span>
        </label>
        <div className="flex shrink-0 gap-1">{[[-1,ArrowUp,ar?'نقل لأعلى':'Move up'],[1,ArrowDown,ar?'نقل لأسفل':'Move down']].map(([offset,Icon,label])=><button key={offset} type="button" aria-label={`${label}: ${c(key)}`} title={label} disabled={bottom.includes(key) || (offset===-1 ? index===0 : index>=orderedTabs.length-3)} onClick={()=>move(key,offset)} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-30"><Icon className="w-5 h-5" aria-hidden="true"/></button>)}</div>
      </li>)}</ol>
    </fieldset>
    <div className="flex flex-wrap gap-3"><button className={primaryClass} disabled={busy}>{c(busy ? 'saving' : 'save')}</button><button type="button" className={buttonClass} disabled={busy} onClick={() => {setHidden([]);setNotice('');}}>{ar ? 'إظهار جميع التبويبات' : 'Show all tabs'}</button></div>
  </form>;
}
