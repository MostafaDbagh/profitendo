import {Check,Minus} from 'lucide-react';
export default function PasswordStrength({value='',id,lang}){
 const ar=lang==='ar',t=(en,arabic)=>ar?arabic:en;
 const rules=[
  {met:value.length>=8,label:t('At least 8 characters (required)','8 أحرف على الأقل (مطلوب)')},
  {met:value.length>=12,label:t('12 or more characters for extra strength','12 حرفًا أو أكثر لقوة إضافية')},
  {met:/\p{L}/u.test(value)&&/\p{N}/u.test(value),label:t('Combine letters and numbers','اجمع بين الأحرف والأرقام')},
  {met:/[^\p{L}\p{N}\s]/u.test(value),label:t('Add a symbol, such as ! or @','أضف رمزًا مثل ! أو @')},
 ];
 const predictable=/^(.)\1+$/u.test(value)||/^(password|qwerty|123456|abcdefgh|87654321|111111|كلمةالمرور)/i.test(value.trim());
 const score=!value?0:value.length<8||predictable?1:rules.every(r=>r.met)?4:rules.filter(r=>r.met).length>=3?3:2;
 const labels=[t('Choose a password','اختر كلمة مرور'),t('Weak','ضعيفة'),t('Fair','متوسطة'),t('Good','جيدة'),t('Strong','قوية')];
 const colors=['bg-slate-200','bg-red-500','bg-amber-500','bg-sky-600','bg-emerald-600'];
 return <div id={id} className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="password-strength"><div className="flex justify-between gap-3 text-xs"><span className="text-slate-500">{t('Password strength estimate','تقدير قوة كلمة المرور')}</span><strong className="text-slate-800" aria-live="polite" aria-atomic="true">{labels[score]}</strong></div><div className="my-2 flex gap-1" aria-hidden="true">{[1,2,3,4].map(step=><span key={step} className={`h-1 flex-1 rounded-full ${step<=score?colors[score]:'bg-slate-200'}`}/>)}</div><ul className="space-y-1.5">{rules.map(rule=><li key={rule.label} className={`flex items-start gap-2 text-xs ${rule.met?'text-emerald-700':'text-slate-500'}`}>{rule.met?<Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/>:<Minus className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/>}<span>{rule.label}<span className="sr-only"> — {rule.met?t('met','مكتمل'):t('not yet met','غير مكتمل')}</span></span></li>)}</ul>{predictable&&value&&<p className="mt-2 text-xs text-red-700">{t('Avoid common passwords, repeated characters and simple sequences.','تجنب كلمات المرور الشائعة والأحرف المكررة والتسلسلات البسيطة.')}</p>}</div>;
}
