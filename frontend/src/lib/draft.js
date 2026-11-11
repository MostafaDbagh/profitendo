import { useCallback, useEffect, useRef, useState } from "react";
import api from "./api";

const lsKey = (kind) => `pl_draft_${kind}`;

/**
 * Autosaves an invoice form snapshot as a server-side draft (debounced, upserted
 * per user+kind — never duplicates). Offline: keeps the latest snapshot in
 * localStorage, flags error status, and retries automatically on reconnect.
 * Restore runs once on mount (server draft first, localStorage fallback).
 */
export function useInvoiceDraft(kind, snapshot, { enabled = true, dirty = true, onRestore } = {}) {
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  const [ready, setReady] = useState(false);
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;
  const timerRef = useRef(null);

  useEffect(() => {
    if (!enabled) {
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      let payload = null;
      if (navigator.onLine) {
        try {
          const { data } = await api.get(`/drafts/${kind}`);
          payload = data?.payload ?? null;
        } catch {
          try { payload = JSON.parse(localStorage.getItem(lsKey(kind)) || "null"); } catch {}
        }
      } else {
        try { payload = JSON.parse(localStorage.getItem(lsKey(kind)) || "null"); } catch {}
      }
      if (!cancelled) {
        if (payload && typeof payload === "object") restoreRef.current?.(payload);
        setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, kind]);

  const save = useCallback(async (snap) => {
    try { localStorage.setItem(lsKey(kind), JSON.stringify(snap)); } catch {}
    if (!navigator.onLine) {
      setStatus("error");
      return;
    }
    setStatus("saving");
    try {
      await api.put(`/drafts/${kind}`, { payload: snap });
      try { localStorage.removeItem(lsKey(kind)); } catch {}
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }, [kind]);

  useEffect(() => {
    if (!enabled || !ready || !dirty) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(snapRef.current), 800);
    return () => clearTimeout(timerRef.current);
  }, [snapshot, enabled, ready, dirty, save]);

  useEffect(() => {
    const onOnline = () => { if (ready && dirty) save(snapRef.current); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [ready, dirty, save]);

  const clearDraft = useCallback(async () => {
    clearTimeout(timerRef.current);
    try { localStorage.removeItem(lsKey(kind)); } catch {}
    try { await api.delete(`/drafts/${kind}`); } catch {}
  }, [kind]);

  return { status, clearDraft };
}
