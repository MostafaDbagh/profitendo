import { Loader2, Mail, Lock, User, Building2, ShieldCheck } from 'lucide-react';
export const inputClass = 'w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm placeholder:text-slate-500 placeholder:opacity-100 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors';
export function Field({ label, id, hint, ...props }) {
  const Icon = ({ 'v2-email': Mail, 'v2-inviteEmail': Mail, 'v2-password': Lock, 'v2-currentPassword': Lock, 'v2-name': User, 'v2-businessName': Building2, 'v2-code': ShieldCheck })[id];
  return <div><label htmlFor={id} className="text-sm font-medium text-slate-700 mb-1.5 block">{label}</label>
    <div className="relative">{Icon && <Icon aria-hidden="true" className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />}<input id={id} className={`${inputClass} ${Icon ? "ps-10 pe-4" : ""}`} aria-describedby={hint ? `${id}-hint` : undefined} {...props} /></div>
    {hint && <p id={`${id}-hint`} className="text-xs text-slate-500 mt-1.5">{hint}</p>}</div>;
}
export function Submit({ busy, children }) {
  return <button type="submit" disabled={busy} className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">
    {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}{children}</button>;
}
export const linkClass = 'text-sm text-emerald-600 font-semibold hover:text-emerald-700 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-sm';
