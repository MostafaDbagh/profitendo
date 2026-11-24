import {useEffect, useRef, useState} from 'react';
import {Barcode} from 'lucide-react';
import {inputClass} from '../auth-v2/Fields';
import {buttonClass} from '../business-v2/UI';
import {errorText} from '../business-v2/feedbackCopy';

export default function BarcodeField({api, lookupPath, lang, c, value, onChange, add, disabled, onPending, onManual}) {
  const ar = lang === 'ar';
  const [error, setError] = useState('');
  const input = useRef(null), queue = useRef(Promise.resolve()), controller = useRef(null);
  const edit = useRef(0), submitted = useRef(null);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => active.abort();
  }, []);
  function submit(event) {
    event.preventDefault();
    const code = input.current.value.trim(), version = edit.current;
    if (!code || disabled || submitted.current === version) return;
    submitted.current = version;
    // The next keyboard scan replaces this selection, even while the first lookup is in flight.
    input.current.focus(); input.current.select();
    onPending(n => n + 1);
    const {signal} = controller.current;
    queue.current = queue.current.then(async () => {
      if (signal.aborted) return;
      try {
        const data = await api(`${lookupPath}&barcode=${encodeURIComponent(code)}`, {signal});
        if (signal.aborted) return;
        if (!data.items.length) throw new Error('PRODUCT_NOT_FOUND');
        if (data.items.length > 1) throw new Error('PRODUCT_CODE_AMBIGUOUS');
        add(data.items[0]);
        if (edit.current === version) onChange('');
        setError('');
      } catch (err) {
        if (!signal.aborted) {
          setError(err.message);
          if (submitted.current === version) submitted.current = null;
        }
      } finally {
        if (!signal.aborted) onPending(n => n - 1);
      }
    });
  }
  return <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <label htmlFor="pos-barcode" className="text-sm font-medium text-slate-700">{ar ? 'الباركود' : 'Barcode'}</label>
      <div className="flex min-w-0 flex-1 basis-52 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Barcode className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true"/>
          <input ref={input} id="pos-barcode" className={`${inputClass} ps-10`} value={value} autoComplete="off" spellCheck="false"
            placeholder={ar ? 'امسح أو أدخل الباركود...' : 'Scan or enter barcode...'} disabled={disabled} maxLength={100}
            aria-describedby={error ? 'pos-scan-error' : undefined}
            onChange={e => {edit.current++; setError(''); onChange(e.target.value);}}/>
        </div>
        <button className={buttonClass} type="submit" disabled={disabled || !value.trim()}>{ar ? 'إضافة' : 'Add'}</button>
      </div>
    </div>
    {error && <div id="pos-scan-error" className="mt-2 flex flex-wrap items-center gap-3 text-sm">
      <span role="alert" className="text-red-700">{errorText(error,c,lang)}</span>
      <button type="button" onClick={onManual} className="font-semibold text-emerald-700 underline underline-offset-4">{ar ? 'اختر المنتج يدوياً' : 'Select product manually'}</button>
    </div>}
  </form>;
}
