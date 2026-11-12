import { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Eye, EyeOff, Loader2, Mail, Lock, User, Building2, ShieldCheck } from 'lucide-react';
export const inputClass = 'w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm placeholder:text-slate-500 placeholder:opacity-100 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors';
export function Field({ label, id, hint, ...props }) {
  const [visible, setVisible] = useState(false);
  const { lang } = useLanguage();
  const password = props.type === 'password';
  const visibilityLabel = lang === 'ar' ? (visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور') : (visible ? 'Hide password' : 'Show password');
  const Icon = ({ 'v2-email': Mail, 'v2-inviteEmail': Mail, 'v2-password': Lock, 'v2-currentPassword': Lock, 'v2-name': User, 'v2-businessName': Building2, 'v2-code': ShieldCheck })[id];
  // Email inputs can retain LTR text direction inside an RTL form. Reserve
  // physical space using the form language, matching the surrounding icons.
  const leftPadding = lang === 'ar' ? (password ? 'pl-12' : 'pl-3') : (Icon ? 'pl-10' : 'pl-3');
  const rightPadding = lang === 'ar' ? (Icon ? 'pr-10' : 'pr-3') : (password ? 'pr-12' : 'pr-3');
  return <div><label htmlFor={id} className="text-sm font-medium text-slate-700 mb-1.5 block">{label}</label>
    <div className="relative">{Icon && <Icon aria-hidden="true" className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />}<input id={id} className={`${inputClass.replace('px-3', '')} ${leftPadding} ${rightPadding}`} aria-describedby={hint ? `${id}-hint` : undefined} {...props} type={password && visible ? 'text' : props.type} />
      {password && <button type="button" aria-label={visibilityLabel} title={visibilityLabel} aria-controls={id} aria-pressed={visible} disabled={props.disabled} onClick={() => setVisible(value => !value)} className="absolute end-1 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50">{visible ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}</button>}
    </div>
    {hint && <p id={`${id}-hint`} className="text-xs text-slate-500 mt-1.5">{hint}</p>}</div>;
}
export function Submit({ busy, children }) {
  return <button type="submit" disabled={busy} className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">
    {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}{children}</button>;
}
export const linkClass = 'text-sm text-emerald-600 font-semibold hover:text-emerald-700 transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-sm';
