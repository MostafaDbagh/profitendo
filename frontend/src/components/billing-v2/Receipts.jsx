import { ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Pager, Table } from '../business-v2/UI';
export default function Receipts({ businessId, timezone, api, c, lang }) {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useResource(api, `/billing/businesses/${businessId}/payments?page=${page}`);
  return <section aria-labelledby="payment-receipts-title" className="space-y-4">
    <h3 id="payment-receipts-title" className="text-lg font-bold text-slate-900">{c('receipts')}</h3>
    <Feedback error={error} c={c} retry={reload} />
    {!data && !error && <p role="status" className="text-sm text-slate-500">{c('loading')}</p>}
    {data && !data.items.length && <div className="rounded-xl border border-slate-200 bg-white p-8 text-center space-y-3"><ReceiptText className="h-8 w-8 text-slate-400 mx-auto" aria-hidden="true" /><p className="text-sm font-semibold text-slate-700">{c('noReceipts')}</p><p className="text-xs text-slate-500">{lang==='ar'?'ستظهر الدفعات المؤكدة ومراجعها هنا.':'Confirmed payments and their references will appear here.'}</p></div>}
    {data && data.items.length > 0 && <><Table headers={['date', 'receiptAmount', 'receiptReference']} c={key => c(key === 'empty' ? 'noReceipts' : key)} empty={!data.items.length}>
      {data.items.map(receipt => <tr key={receipt.id}>
        <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{new Date(receipt.paidAt).toLocaleString(lang === 'ar' ? 'ar' : 'en', { timeZone: timezone })}</td>
        <td className="px-5 py-3 font-semibold text-slate-800 whitespace-nowrap tabular">{new Intl.NumberFormat(lang, { style: 'currency', currency: receipt.currency }).format(receipt.amountMinor / 100)}</td>
        <td className="px-5 py-3 text-slate-500"><span dir="ltr">{receipt.reference}</span></td>
      </tr>)}
    </Table>{data.total > data.pageSize && <Pager data={data} setPage={setPage} c={c} />}</>}
  </section>;
}
