import { Field } from './Fields';
export default function OtpField({value,onChange,c,disabled=false}){
 return <Field id="v2-code" label={c('code')} placeholder={c('setupCodePlaceholder')} hint={c('otpHint')}
  type="text" dir="ltr" inputMode="numeric" autoComplete="one-time-code" spellCheck={false}
  required minLength={6} maxLength={6} pattern="[0-9]{6}" value={value} disabled={disabled}
  onChange={e=>{if(/^[0-9]{0,6}$/.test(e.target.value))onChange(e.target.value);}}/>;
}
