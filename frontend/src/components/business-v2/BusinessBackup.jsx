import { useState } from 'react';
import { Download } from 'lucide-react';
import { buttonClass, Feedback, panelClass, primaryClass } from './UI';

const copy = {
  ar: {
    title: 'النسخ الاحتياطي',
    description: 'نزّل نسخة من سجلات هذا النشاط، بما فيها المنتجات والمبيعات والمشتريات والموردون والشركاء والمخزون والمصروفات وحركات الخزينة.',
    formats: 'ملف JSON للأرشفة، وملف Excel بأوراق عمل منفصلة للمراجعة. لا تتضمن النسخة صور المنتجات أو بيانات تسجيل الدخول.',
    json: 'تحميل نسخة JSON',
    excel: 'تحميل نسخة Excel',
    large: 'تجاوزت بيانات النشاط الحد المسموح للتحميل.',
    cell: 'توجد قيمة أكبر من الحد الذي يقبله Excel. حمّل نسخة JSON.',
  },
  en: {
    title: 'Business backup',
    description: 'Download this business’s products, sales, purchases, suppliers, partners, stock, expenses, and cash activity.',
    formats: 'Use JSON for archiving or Excel to review the records in separate worksheets. Product images and sign-in data are excluded.',
    json: 'Download JSON backup',
    excel: 'Download Excel backup',
    large: 'This business exceeds the backup download limit.',
    cell: 'A value is too large for Excel. Download JSON instead.',
  },
};

export default function BusinessBackup({ context, api, c, lang }) {
  const labels = copy[lang === 'ar' ? 'ar' : 'en'];
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function download(format) {
    setBusy(format);
    setError('');
    try {
      const file = await api(`/businesses/${context.business.id}/backup?format=${format}`, { download: true });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `profitlens-backup-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy('');
    }
  }

  const errorLabel = code => ({
    BACKUP_TOO_LARGE: labels.large,
    BACKUP_EXCEL_CELL_TOO_LARGE: labels.cell,
  }[code] ?? c(code));

  return <section className={`${panelClass} max-w-3xl space-y-3`} aria-labelledby="business-backup-title">
    <h2 id="business-backup-title" className="flex items-center gap-2 font-bold text-slate-900">
      <Download className="h-5 w-5 text-emerald-600" aria-hidden="true" />{labels.title}
    </h2>
    <p className="text-sm leading-relaxed text-slate-700">{labels.description}</p>
    <p className="text-sm leading-relaxed text-slate-500">{labels.formats}</p>
    <Feedback error={error} c={errorLabel} />
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => download('json')}>
        <Download className="h-4 w-4" aria-hidden="true" />{busy === 'json' ? c('loading') : labels.json}
      </button>
      <button type="button" className={primaryClass} disabled={Boolean(busy)} onClick={() => download('xlsx')}>
        <Download className="h-4 w-4" aria-hidden="true" />{busy === 'xlsx' ? c('loading') : labels.excel}
      </button>
    </div>
  </section>;
}
