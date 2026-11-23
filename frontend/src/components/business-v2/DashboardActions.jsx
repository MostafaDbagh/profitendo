import { Plus, Receipt, RotateCcw, ShoppingBag, ShoppingCart, Truck } from 'lucide-react';

const actions = [
  { tab: 'catalogue', action: 'new', Icon: Plus, permissions: ['catalogue.create', 'catalogue.cost'], ar: 'إضافة منتج', en: 'Add product' },
  { tab: 'suppliers', action: 'new', Icon: Truck, permissions: ['suppliers.create'], ar: 'إضافة مورد', en: 'Add supplier' },
  { tab: 'purchases', action: 'new', Icon: ShoppingBag, permissions: ['receiving.create'], ar: 'استلام بضاعة', en: 'Receive goods' },
  { tab: 'returns', action: 'customer', Icon: RotateCcw, permissions: ['returns.create', 'sales.view'], ar: 'تسجيل مرتجع', en: 'Record customer return' },
  { tab: 'expenses', action: 'new', Icon: Receipt, permissions: ['payments.manage'], ar: 'إضافة مصروف', en: 'Add expense' },
  { tab: 'sales', action: 'new', Icon: ShoppingCart, permissions: ['sales.create'], ar: 'تسجيل بيع', en: 'Record sale' },
];

export default function DashboardActions({ permissions, visibleTabs, onSection, lang }) {
  const ar = lang === 'ar';
  const available = actions.filter(({ tab, permissions: required }) =>
    visibleTabs.includes(tab) && required.every(permission => permissions[permission]));
  if (!available.length) return null;

  return <section aria-label={ar ? 'إجراءات لوحة التحكم' : 'Dashboard actions'}>
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
      {available.map(({ tab, action, Icon, ...labels }) => (
        <li key={`${tab}-${action}`} className="min-w-0">
          <button type="button" onClick={() => onSection(tab, action)}
            className="flex h-full min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-3 text-sm font-semibold text-slate-700 shadow-sm hover:border-emerald-200 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:px-4">
            <Icon className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>{ar ? labels.ar : labels.en}</span>
          </button>
        </li>
      ))}
    </ul>
  </section>;
}
