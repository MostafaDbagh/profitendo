import {useLanguage} from '../../context/LanguageContext';
export function localPhone(value){
 return value.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[\s()-]/g,'').replace(/^00963/,'').replace(/^\+?963/,'').replace(/^0/,'');
}
export default function PhoneInput({id,value,onChange,disabled=false,label}){
 const {lang}=useLanguage();
 return <div><label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
 <div className="flex gap-2" dir="ltr">
  <span className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-600" aria-label={lang==='ar'?'رمز سوريا':'Syria calling code'}>+963</span>
  <input id={id} name="phone" type="tel" inputMode="tel" autoComplete="tel-national" dir="ltr" required pattern="9[0-9]{8}" maxLength={40} placeholder="9XX XXX XXX" value={value} disabled={disabled} onChange={e=>onChange(localPhone(e.target.value))} title={lang==='ar'?'أدخل 9 أرقام تبدأ بالرقم 9':'Enter 9 digits starting with 9'} className="min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"/>
 </div><p className="mt-2 text-xs text-slate-500">{lang==='ar'?'سنرسل رمزًا للتحقق من رقم هاتفك.':'We will send a code to verify your phone number.'}</p></div>;
}
