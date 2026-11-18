import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '../context/LanguageContext';

export default function CopyableCode({ children, kind = 'sku', className = '' }) {
  const { lang } = useLanguage();
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = String(children ?? '');
  if (!value) return null;
  const name = kind === 'barcode' ? (lang === 'ar' ? 'الباركود' : 'barcode') : (lang === 'ar' ? 'رمز الصنف' : 'SKU');
  const label = `${lang === 'ar' ? 'نسخ' : 'Copy'} ${name}: ${value}`;
  async function copy(event) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(lang === 'ar' ? `تم نسخ ${name}` : `${name} copied`);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(lang === 'ar' ? 'تعذّر النسخ. حدد النص وانسخه يدوياً.' : 'Could not copy. Select the code and copy it manually.');
    }
  }
  return <span className={`inline-flex max-w-full items-center gap-1 align-middle ${className}`}>
    <bdi dir="ltr" className="select-all break-all">{value}</bdi>
    <button type="button" onClick={copy} aria-label={label} title={label} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 print:hidden">
      {copied ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" /> : <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
    </button>
  </span>;
}
