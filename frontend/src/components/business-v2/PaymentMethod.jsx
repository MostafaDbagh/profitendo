import {Select} from './UI';
import {Field} from '../auth-v2/Fields';

const methods = ['CASH', 'TRANSFER', 'REMITTANCE', 'CREDIT', 'OTHER'];
const labels = {
  ar: {CASH:'كاش', TRANSFER:'تحويل بنكي', REMITTANCE:'حوالة مالية', CREDIT:'آجل', OTHER:'أخرى', CARD:'بطاقة'},
  en: {CASH:'Cash', TRANSFER:'Bank transfer', REMITTANCE:'Money remittance', CREDIT:'On credit', OTHER:'Other', CARD:'Card'},
};
export const methodLabel = (method,lang) => labels[lang]?.[method] ?? method;
export const descriptionLabel = lang => lang==='ar' ? 'وصف طريقة الدفع' : 'Payment method description';

export default function PaymentMethod({id, detailId, lang, method, reference, referenceLabel, onMethod, onReference, form, disabled}) {
  const fieldLabel = method==='OTHER' ? descriptionLabel(lang) : referenceLabel;
  return <>
    <Select id={id} label={lang==='ar'?'طريقة الدفع':'Payment method'} value={method} disabled={disabled} form={form}
      onChange={e=>onMethod(e.target.value)}>
      {!method && <option value="" disabled>{lang==='ar'?'اختر طريقة الدفع':'Choose a payment method'}</option>}
      {(method==='CARD' ? [...methods,'CARD'] : methods).map(option=><option key={option} value={option}>{methodLabel(option,lang)}</option>)}
    </Select>
    {fieldLabel && <Field id={detailId} form={form} lang={lang} label={fieldLabel} disabled={disabled}
      value={reference} onChange={e=>onReference(e.target.value)} required maxLength={150} pattern={'.*\\S.*'}/>}
  </>;
}
