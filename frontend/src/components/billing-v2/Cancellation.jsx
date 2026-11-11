import { useRef, useState } from 'react';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Modal, buttonClass, panelClass } from '../business-v2/UI';
export default function Cancellation({ businessId, api, c, lang }) {
  const path = `/billing/businesses/${businessId}/cancellation`;
  const { data, error, reload } = useResource(api, path);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const trigger = useRef(null);
  async function submit() {
    setBusy(true); setFailure('');
    try { await api(path, { method: 'POST', body: { confirm: true } }); setOpen(false); reload(); }
    catch (e) { setFailure(e.message); } finally { setBusy(false); }
  }
  return <section className={`${panelClass} space-y-4`}>
    <h3 className="font-bold">{c('cancellationTitle')}</h3>
    <Feedback error={error} c={c} retry={reload} />
    {!data && !error && <p role="status" className="text-sm text-slate-500">{c('loading')}</p>}
    {data && <>
      {data.cancellation ? <div role="status" className="space-y-2"><p className="font-semibold text-sm">{c(`cancellation_${data.cancellation.status}`)}</p><p className="text-sm text-slate-600">{c(data.cancellation.status === 'CONFIRMED' ? 'cancellationConfirmedHint' : data.cancellation.status === 'REVIEW' ? 'cancellationReviewHint' : 'cancellationPendingHint')}</p></div>
        : <p className="text-sm text-slate-600">{c(data.cancellationAvailable ? 'cancellationHint' : 'noLinkedSubscription')}</p>}
      <div className="flex flex-wrap gap-2">
        {data.cancellationAvailable && !data.cancellation && <button ref={trigger} className={`${buttonClass} !text-red-700 !border-red-200 hover:!bg-red-50`} onClick={() => { setFailure(''); setOpen(true); }}>{c('cancelSubscription')}</button>}
        <button className={buttonClass} onClick={reload}>{c('refreshStatus')}</button>
      </div>
    </>}
    {open && <Modal title={c('cancelSubscription')} description={c('cancellationConfirmHint')} {...{c,lang,busy}} returnFocus={trigger.current} close={() => setOpen(false)}>
      <Feedback error={failure} c={c} />
      <div className="flex flex-wrap justify-end gap-2"><button className={buttonClass} disabled={busy} onClick={() => setOpen(false)}>{c('keepSubscription')}</button><button className={`${buttonClass} !bg-red-600 !text-white !border-red-600 hover:!bg-red-700`} disabled={busy} onClick={submit}>{c(busy ? 'saving' : 'confirmCancellation')}</button></div>
    </Modal>}
  </section>;
}
