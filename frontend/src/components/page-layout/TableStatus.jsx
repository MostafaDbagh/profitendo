const tones = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  RECEIVED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  OPEN: 'border-sky-200 bg-sky-50 text-sky-800',
  PARTIAL: 'border-amber-200 bg-amber-50 text-amber-800',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-800',
};

export default function TableStatus({status, children}) {
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tones[status] || 'border-slate-200 bg-slate-100 text-slate-600'}`}>
    {children}
  </span>;
}
