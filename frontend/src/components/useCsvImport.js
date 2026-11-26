import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";

function formFor({ file, mapping, strategy }) {
  const form = new FormData();
  form.append("file", file);
  form.append("mapping", JSON.stringify(mapping || {}));
  if (strategy) form.append("strategy", strategy);
  return form;
}

export function useCsvImport(resource, t, onClose, onImported) {
  const initialStrategy = resource === "products" ? "skip" : undefined;
  const empty = () => ({ file: null, mapping: null, strategy: initialStrategy });
  const [selection, setSelection] = useState(empty);
  const [headers, setHeaders] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);
  const active = useRef(null);
  const reviewed = useRef(null);
  const submitting = useRef(false);

  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
    reviewed.current = null;
  }, []);

  async function review(next) {
    if (submitting.current) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    reviewed.current = null;
    setPreview(null);
    setSelection(next);
    setResult(null);
    setLoading(true);
    if (!next.mapping) setHeaders([]);
    try {
      const { data } = await api.post(`/${resource}/import/preview`, formFor(next), { signal: controller.signal });
      if (active.current !== controller) return;
      const verified = { ...next, mapping: data.suggested_mapping };
      reviewed.current = verified;
      setSelection(verified);
      setHeaders(data.headers);
      setPreview(data);
    } catch (error) {
      if (active.current === controller) toast.error(formatApiError(error, t("somethingWrong")));
    } finally {
      if (active.current === controller) setLoading(false);
    }
  }

  function close() {
    if (submitting.current) return;
    active.current?.abort();
    active.current = null;
    reviewed.current = null;
    setSelection(empty());
    setHeaders([]);
    setPreview(null);
    setResult(null);
    setLoading(false);
    onClose();
  }

  async function commit() {
    const snapshot = reviewed.current;
    if (!snapshot || submitting.current) return;
    submitting.current = true;
    setCommitting(true);
    try {
      const { data } = await api.post(`/${resource}/import/commit`, formFor(snapshot));
      reviewed.current = null;
      setResult(data);
      onImported();
    } catch (error) {
      toast.error(formatApiError(error, t("importFailed")));
      submitting.current = false;
      review(snapshot);
    } finally {
      submitting.current = false;
      setCommitting(false);
    }
  }

  return {
    ...selection, fileRef, headers, rows: preview?.rows || [], summary: preview?.summary,
    loading: loading || committing, committing, result, close, commit,
    pickFile: file => file && review({ file, mapping: null, strategy: selection.strategy }),
    setMapping: mapping => review({ ...selection, mapping }),
    setStrategy: strategy => review({ ...selection, strategy }),
  };
}
