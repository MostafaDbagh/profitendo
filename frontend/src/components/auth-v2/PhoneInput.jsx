import {useLanguage} from '../../context/LanguageContext';
export function internationalPhone(value){
 return value.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[\s()-]/g,'').replace(/^00/,'+');
}
export default function PhoneInput({id,value,onChange,disabled=false,label,verificationRequired=true}){
 const {lang}=useLanguage();
 return <div><label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
  <input id={id} name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" required pattern="[+][1-9][0-9]{6,14}" maxLength={40} placeholder="+963 9XXXXXXX" value={value} disabled={disabled} onChange={e=>onChange(internationalPhone(e.target.value))} aria-describedby={`${id}-hint`} title={lang==='ar'?'أدخل الرقم كاملاً مع رمز الدولة بدءًا بعلامة +':'Enter the full number with its country code, starting with +'} className="min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"/>
 <p id={`${id}-hint`} className="mt-2 text-xs text-slate-500">{lang==='ar'?'أدخل مفتاح البلد ثم رقم الهاتف، بدءًا بعلامة +.':'Enter +, your country code and phone number.'}{verificationRequired&&(lang==='ar'?' سنرسل رمز التحقق برسالة نصية.':' We’ll send a verification code by SMS.')}</p></div>;
}
