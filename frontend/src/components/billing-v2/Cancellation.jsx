import {LoadingState} from '../page-layout/PageResults';
import { CalendarClock } from 'lucide-react';
import { useRef, useState } from 'react';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Modal, buttonClass, panelClass } from '../business-v2/UI';
export default function Cancellation({ businessId, api, c, lang, compact=false }) {
  const path = `/billing/businesses/${businessId}/cancellation`;
  const { data, error, reload } = useResource(api, path);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const trigger = useRef(null);
  async function submit() {
    setBusy(true); setFailure('');
    try { await api(path, { method: 'POST', body: { confirm: true } }); setOpen(false); reload(); }
    catch (e) { setFailure(e.message); } finally { setBusy(false); }
  }
  return <section className={compact ? "grid gap-3 py-6 sm:grid-cols-[1fr_auto]" : `${panelClass} space-y-4`}>
    <div className="space-y-2"><h3 className={`font-bold flex items-center gap-2 ${compact ? "text-lg" : ""}`}><CalendarClock className={compact ? "h-[22px] w-[22px] text-orange-600" : "w-4 h-4 text-slate-500"} aria-hidden="true" />{lang==='ar'?'إدارة التجديد':'Manage renewal'}</h3>
    <Feedback error={error} c={c} retry={reload} />
    {!data && !error && <LoadingState className="text-sm text-slate-500">{c('loading')}</LoadingState>}
    {data && (data.cancellation ? <div role="status" className="space-y-2"><p className="font-semibold text-sm">{c(`cancellation_${data.cancellation.status}`)}</p><p className="text-sm text-slate-600">{c(data.cancellation.status === 'CONFIRMED' ? 'cancellationConfirmedHint' : data.cancellation.status === 'REVIEW' ? 'cancellationReviewHint' : 'cancellationPendingHint')}</p></div>
        : <p className="text-sm text-slate-600">{c(data.cancellationAvailable ? 'cancellationHint' : 'noLinkedSubscription')}</p>)}
    </div>
      {data && <div className="flex flex-wrap items-center gap-2">
        {data.cancellationAvailable && !data.cancellation && <button ref={trigger} className={`${buttonClass} !text-red-700 !border-red-200 hover:!bg-red-50`} onClick={() => { setFailure(''); setOpen(true); }}>{c('cancelSubscription')}</button>}
        <button className={compact ? `${buttonClass} !border-orange-300 !bg-orange-300 !text-slate-950 hover:!bg-orange-400` : buttonClass} onClick={reload}>{c('refreshStatus')}</button>
      </div>}
    {open && <Modal title={c('cancelSubscription')} description={c('cancellationConfirmHint')} {...{c,lang,busy}} returnFocus={trigger.current} close={() => setOpen(false)}>
      <Feedback error={failure} c={c} />
      <div className="flex flex-wrap justify-end gap-2 rtl:flex-row-reverse"><button className={buttonClass} disabled={busy} onClick={() => setOpen(false)}>{c('keepSubscription')}</button><button className={`${buttonClass} !bg-red-600 !text-white !border-red-600 hover:!bg-red-700`} disabled={busy} onClick={submit}>{c(busy ? 'saving' : 'confirmCancellation')}</button></div>
    </Modal>}
  </section>;
}
