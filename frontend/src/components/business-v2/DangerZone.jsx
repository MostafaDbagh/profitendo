import { useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Field } from '../auth-v2/Fields';
import { buttonClass, Feedback, Modal, panelClass } from './UI';

const confirmation = 'DELETE ALL DATA';
const destructiveClass = 'min-h-11 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50';

const copy = {
  ar: {
    title: 'منطقة الخطر',
    action: 'حذف البيانات التشغيلية',
    description: 'احذف نهائيًا المبيعات والمشتريات والمرتجعات والمنتجات والمخزون والمصروفات وحركات الخزينة والموردين والشركاء وحركاتهم وسجلات العملاء وزيارات الولاء وهداياه. يبقى حسابك واشتراكك وإعداداتك وأعضاء فريقك ومواقعك وسجل التدقيق.',
    backup: 'نزّل نسخة احتياطية من القسم أعلاه قبل الحذف.',
    confirmTitle: 'هل تريد حذف بيانات هذا النشاط؟',
    confirmHint: 'لا يمكن التراجع عن الحذف. اكتب العبارة أدناه وأدخل كلمة مرور حسابك للتأكيد.',
    phrase: 'عبارة التأكيد',
    password: 'كلمة المرور الحالية',
    wrongPassword: 'كلمة المرور غير صحيحة.',
    done: 'تم حذف البيانات التشغيلية لهذا النشاط.',
  },
  en: {
    title: 'Danger Zone',
    action: 'Delete operational data',
    description: 'Permanently delete sales, purchases, returns, products, stock, expenses, cash activity, suppliers, partners, partner transactions, customer records, loyalty visits, and rewards. Your account, subscription, settings, team, locations, and audit log are kept.',
    backup: 'Download a backup from the section above before deleting data.',
    confirmTitle: 'Delete this business’s data?',
    confirmHint: 'This cannot be undone. Type the phrase below and enter your current password to confirm.',
    phrase: 'Confirmation phrase',
    password: 'Current password',
    wrongPassword: 'The password is incorrect.',
    done: 'This business’s operational data was deleted.',
  },
};

export default function DangerZone({context, api, c, lang, reload}) {
  const labels = copy[lang === 'ar' ? 'ar' : 'en'];
  const trigger = useRef(null);
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function close() {
    setOpen(false);
    setPassword('');
    setPhrase('');
    setError('');
  }

  async function reset(event) {
    event.preventDefault();
    if (busy || phrase !== confirmation || !password) return;
    setBusy(true);
    setError('');
    try {
      await api(`/businesses/${context.business.id}/operational-data`, {
        method: 'DELETE', body: {confirmation: phrase, password},
      });
      close();
      toast.success(labels.done);
      reload();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className={`${panelClass} max-w-3xl space-y-3 !border-rose-200`} aria-labelledby="operational-reset-title">
    <h2 id="operational-reset-title" className="flex items-center gap-2 font-bold text-rose-700">
      <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />{labels.title}
    </h2>
    <p className="text-sm leading-relaxed text-slate-600">{labels.description}</p>
    <p className="text-sm text-slate-500">{labels.backup}</p>
    <button ref={trigger} type="button" className={destructiveClass} onClick={() => setOpen(true)}>{labels.action}</button>
    {open && <Modal {...{c, lang, busy, close}} returnFocus={trigger.current} title={labels.confirmTitle}
      description={`${context.business.name} · ${labels.confirmHint}`}>
      <form className="space-y-4" onSubmit={reset}>
        {error === 'RESET_PASSWORD_INCORRECT'
          ? <p role="alert" className="text-sm text-rose-700">{labels.wrongPassword}</p>
          : <Feedback {...{error, c}} />}
        <Field id="reset-confirmation" label={labels.phrase} dir="ltr" placeholder={confirmation}
          hint={confirmation} autoComplete="off" value={phrase} onChange={event => setPhrase(event.target.value)} required disabled={busy} />
        <Field id="reset-password" type="password" label={labels.password} autoComplete="current-password"
          value={password} onChange={event => setPassword(event.target.value)} required maxLength={128} disabled={busy} />
        <div className="flex flex-wrap justify-end gap-2 rtl:justify-start">
          <button type="button" className={buttonClass} onClick={close} disabled={busy}>{c('cancel')}</button>
          <button type="submit" className={`${destructiveClass} rtl:order-first`} disabled={busy || phrase !== confirmation || !password}>
            {busy ? c('saving') : labels.action}
          </button>
        </div>
      </form>
    </Modal>}
  </section>;
}
