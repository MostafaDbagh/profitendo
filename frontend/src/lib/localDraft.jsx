import { createContext, useContext, useLayoutEffect, useRef, useState, useEffect } from 'react';

export const DraftScope = createContext(null);
const prefix = 'profitendo:entry:v1:';

// Only explicitly selected business fields belong here. Never store credentials,
// confirmation flags, File objects, or a pending financial action.
export function useLocalDraft(name, values, restore) {
  const scope = useContext(DraftScope);
  const key = scope?.membershipId ? prefix + JSON.stringify([scope.business.id, scope.membershipId, scope.permissions, name]) : null;
  const serialized = JSON.stringify(values);
  const latest = useRef({values, restore});
  latest.current = {values, restore};
  const state = useRef(null);
  const [status, setStatus] = useState('idle');
  const [restored, setRestored] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useLayoutEffect(() => {
    const initial = JSON.stringify(latest.current.values);
    state.current = {key, initial, last: initial, stored: null, skip: true, blocked: false};
    setRestored(false);
    setStatus('idle');
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      state.current.stored = raw;
      if (raw) {
        const entry = JSON.parse(raw);
        if (entry.version !== 1 || !entry.values || typeof entry.values !== 'object' ||
            Object.keys(latest.current.values).some(field => !(field in entry.values))) throw new Error('Invalid draft');
        latest.current.restore(entry.values);
        state.current.last = JSON.stringify(entry.values);
        setRestored(true);
        setStatus('saved');
      }
    } catch { state.current.blocked = true; setStatus('error'); }
  }, [key]);

  useLayoutEffect(() => {
    const current = state.current;
    if (!key || current.key !== key) return;
    if (current.skip) { current.skip = false; return; }
    if (current.blocked || serialized === current.last) return;
    try {
      // A second tab must not silently replace another tab's work.
      if (localStorage.getItem(key) !== current.stored) {
        current.blocked = true; setStatus('conflict'); return;
      }
      const raw = JSON.stringify({version: 1, updatedAt: new Date().toISOString(), values: latest.current.values});
      localStorage.setItem(key, raw);
      current.stored = raw;
      current.last = serialized;
      setStatus('saved');
    } catch { setStatus('error'); }
  }, [key, serialized]);

  useEffect(() => {
    const network = () => setOnline(navigator.onLine);
    const leave = e => {
      if (status === 'error' || status === 'conflict') { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('online', network);
    window.addEventListener('offline', network);
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
      window.removeEventListener('beforeunload', leave);
    };
  }, [status]);

  function checkpoint(extra) {
    const current = state.current;
    if (!key || current.blocked) return;
    try {
      if (localStorage.getItem(key) !== current.stored) { current.blocked = true; setStatus('conflict'); return; }
      const values = {...latest.current.values, ...extra};
      const raw = JSON.stringify({version: 1, updatedAt: new Date().toISOString(), values});
      localStorage.setItem(key, raw);
      current.stored = raw; current.last = JSON.stringify(values);
    } catch { setStatus('error'); }
  }
  function clear() {
    try {
      if (key && localStorage.getItem(key) === state.current.stored) localStorage.removeItem(key);
      state.current.stored = null;
      state.current.last = JSON.stringify(latest.current.values);
      setStatus('idle'); setRestored(false);
    } catch { setStatus('error'); }
  }
  // Call reset only after any caller-specific confirmation and server cleanup.
  function reset() {
    try {
      if (key) localStorage.removeItem(key);
      state.current.stored = null; state.current.blocked = false;
      const initial = JSON.parse(state.current.initial);
      if ('clientKey' in initial) initial.clientKey = crypto.randomUUID();
      if ('fingerprint' in initial) initial.fingerprint = '';
      state.current.last = JSON.stringify(initial);
      latest.current.restore(initial);
      setStatus('idle'); setRestored(false);
    } catch { setStatus('error'); }
  }
  function discard() {
    if (!window.confirm(scope.lang === 'ar' ? 'حذف هذه المسودة وإعادة الحقول إلى البداية؟' : 'Discard this draft and reset the fields?')) return;
    reset();
  }
  return {status, restored, online, clear, discard, reset, checkpoint};
}

export function LocalDraftNotice({draft, lang, busy}) {
  const ar = lang === 'ar';
  const problem = ['error', 'conflict'].includes(draft.status);
  if(draft.status==='idle'&&!draft.restored&&draft.online)return null;
  const text = problem
    ? (ar ? 'تعذّر حفظ المسودة على هذا الجهاز. قد تكون مساحة التخزين ممتلئة أو المسودة مفتوحة في تبويب آخر. لا تغلق الصفحة قبل حفظ عملك.' : 'Draft could not be saved on this device. Storage may be unavailable or another tab may have changed it. Keep this page open until you save your work.')
    : draft.restored
      ? (ar ? 'تمت استعادة عملك غير المكتمل. راجعه قبل الإرسال.' : 'Your unfinished work was restored. Review it before submitting.')
      : draft.status === 'saved'
        ? (ar ? 'تم حفظ المسودة على هذا الجهاز.' : 'Draft saved on this device.')
        : (ar ? 'لم تُرسل البيانات بعد.' : 'Changes have not been submitted.');
  return <div className={`text-xs flex flex-wrap items-center justify-between gap-2 ${problem ? 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900' : 'text-slate-500'}`} data-testid="local-draft-notice">
    <p role={problem ? 'alert' : 'status'}>{text}{!draft.online && <> {ar ? 'أنت غير متصل؛ الإرسال يحتاج إلى الإنترنت.' : 'You are offline; submitting requires internet.'}</>}</p>
    {draft.status !== 'idle' && <button type="button" disabled={busy} className="underline underline-offset-4 font-medium" onClick={draft.discard}>{ar ? 'حذف المسودة' : 'Discard draft'}</button>}
  </div>;
}
