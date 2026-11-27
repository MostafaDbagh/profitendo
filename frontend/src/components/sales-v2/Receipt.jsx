import { saleStaff } from './saleStaff';
import { currencyFormatter } from '../../lib/currencyFormat';
import { formatQuantity } from '@/lib/quantity';
import { unitLabel } from '../catalogue-v2/units';
export function money(value,doc,lang){return currencyFormatter(lang==='ar'?'ar':'en',{style:'currency',currency:doc.currency,minimumFractionDigits:doc.currencyDigits,maximumFractionDigits:doc.currencyDigits}).format(value);}
export default function Receipt({doc,c,lang}) {
 const ar=lang==='ar',amount=v=>money(v,doc,lang);
 const price=v=>currencyFormatter(ar?'ar':'en',{style:'currency',currency:doc.currency,minimumFractionDigits:doc.currencyDigits,maximumFractionDigits:4}).format(v);
 const customerName=doc.customerName?.trim();
 const date=doc.completedAt||(doc.status==='DRAFT'?doc.expiresAt:doc.createdAt)||doc.expiresAt;
 const totals=[['saleSubtotal',doc.subtotal],['saleDiscount',doc.discount],...(Number(doc.taxRate??0)>0||Number(doc.tax??0)>0?[['saleTax',doc.tax??'0']]:[])];
 const footer=doc.status==='CANCELLED'?(ar?'فاتورة ملغاة — لا تُستخدم للتحصيل.':'Cancelled invoice — not for collection.'):c(doc.status==='COMPLETED'?'saleReceiptHint':'saleNoStock');
 return <article className="space-y-4 break-words text-sm text-slate-900" data-testid="sale-receipt" dir={ar?'rtl':'ltr'}>
  <header className="space-y-1.5 border-b border-slate-200 pb-4 text-center">
   <h3 className="text-lg font-bold"><bdi>{doc.locationName}</bdi></h3>
   <p className="font-semibold"><bdi>{doc.reference}</bdi></p>
   <div className="flex flex-wrap items-center justify-center gap-2">
    <span className="text-xs text-slate-500">{ar?'فاتورة بيع':'Sales invoice'}</span>
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${doc.status==='COMPLETED'?'bg-emerald-50 text-emerald-700':doc.status==='CANCELLED'?'bg-red-50 text-red-700':'bg-slate-100 text-slate-600'}`}>{c(doc.status)}</span>
   </div>
  </header>
  <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
   {customerName&&<div className="flex items-baseline gap-2"><dt className="text-slate-500">{ar?'اسم العميل':'Customer name'}</dt><dd className="font-medium text-end"><bdi>{customerName}</bdi></dd></div>}
   <div className="flex items-baseline gap-2"><dt className="text-slate-500">{saleStaff(doc,c).label}</dt><dd className="text-end"><bdi className="font-semibold text-emerald-700">{saleStaff(doc,c).name}</bdi></dd></div>
   <div className="basis-full flex flex-wrap items-baseline gap-2"><dt className="text-slate-500">{doc.status==='DRAFT'?c('saleExpiry'):(ar?'تاريخ البيع':'Sale date')}</dt><dd><bdi>{new Intl.DateTimeFormat(lang,{dateStyle:'medium',timeStyle:'short',timeZone:doc.timezone}).format(new Date(date))}</bdi></dd></div>
  </dl>
  <table className="w-full table-fixed text-start text-xs sm:text-sm">
   <colgroup><col/><col className="w-16 sm:w-20"/><col className="w-24 sm:w-28"/></colgroup>
   <thead className="bg-slate-50 text-slate-500"><tr><th scope="col" className="p-2 text-start font-medium">{ar?'الصنف':'Item'}</th><th scope="col" className="p-2 text-center font-medium">{c('quantity')}</th><th scope="col" className="p-2 text-end font-medium">{ar?'الإجمالي':'Total'}</th></tr></thead>
   <tbody className="divide-y divide-slate-100">{doc.lines.map(l=><tr key={l.id} className="align-top break-inside-avoid">
    <td className="px-2 py-3"><p className="font-medium">{l.name}</p><p className="mt-1 text-xs text-slate-500">{c('salePrice')}: <bdi>{price(l.unitPrice)}</bdi></p>{Number(l.discount)>0&&<p className="mt-1 text-xs text-slate-500">{c('saleDiscount')}: <bdi>{l.discountPercent!=null?`${Number(l.discountPercent)}%`:amount(l.discount)}</bdi>{l.discountReason&&<> · {l.discountReason}</>}</p>}</td>
    <td className="px-1 py-3 text-center tabular-nums"><bdi>{formatQuantity(l.quantity)}</bdi><span className="mt-1 block text-xs text-slate-500">{l.packName||unitLabel(l.unit,c)}</span></td>
    <td className="px-2 py-3 text-end font-medium tabular-nums"><bdi>{amount(l.total)}</bdi></td>
   </tr>)}</tbody>
  </table>
  <dl className="border-t border-slate-200 pt-3 space-y-2 w-full break-inside-avoid">
   {totals.map(([key,value])=><div key={key} className="flex justify-between gap-3 px-2"><dt className="text-slate-600">{key==='saleTax'?`${c(key)} (${Number(doc.taxRate??0)}%)`:c(key)}</dt><dd className="text-end tabular-nums"><bdi>{amount(value)}</bdi></dd></div>)}
   <div className="flex justify-between items-center gap-3 rounded-lg bg-emerald-50 px-3 py-3 font-bold text-emerald-800"><dt>{c(doc.status==='COMPLETED'?'salePaidTotal':'saleTotal')}</dt><dd className="text-lg text-end tabular-nums"><bdi>{amount(doc.total)}</bdi></dd></div>
  </dl>
  {doc.payment&&<dl className="border-t border-slate-100 pt-3 space-y-1.5 text-xs">{[['salePayment',c(doc.payment.method)],['saleReceived',amount(doc.payment.received)],['saleChange',amount(doc.payment.change)],...(doc.payment.reference?[['salePaymentReference',doc.payment.reference]]:[])].map(([key,value])=><div key={key} className="flex justify-between gap-3"><dt className="text-slate-500">{c(key)}</dt><dd className="text-end"><bdi>{value}</bdi></dd></div>)}</dl>}
  {doc.notes&&<p className="border-t border-slate-100 pt-3 text-xs whitespace-pre-wrap">{doc.notes}</p>}
  <footer className="border-t border-slate-100 pt-3 text-center text-xs text-slate-500">{footer}</footer>
 </article>;
}
