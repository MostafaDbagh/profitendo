import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation, Navigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useInvoiceDraft } from "../lib/draft";
import { DraftStatus } from "../components/DraftStatus";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { fmtMoney, num } from "../lib/calculations";

const newRow = (fields) => ({ rowId: crypto.randomUUID(), ...fields });

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";

export default function ReturnNew() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const location = useLocation();
  const editPin = location.state?.pin;
  const [sales, setSales] = useState([]);
  const [saleId, setSaleId] = useState("");
  const [reason, setReason] = useState("changed_mind");
  const [notes, setNotes] = useState("");
  const [restock, setRestock] = useState(true);
  const [refundMethod, setRefundMethod] = useState("cash");
  const [items, setItems] = useState(() => [newRow({ product_id: "", quantity: 1 })]);
  const clientRef = useRef(crypto.randomUUID());
  const draftSnapshot = useMemo(() => ({
    saleId,
    reason,
    notes,
    restock,
    refundMethod,
    items: items.map(({ product_id, quantity }) => ({ product_id, quantity })),
  }), [saleId, reason, notes, restock, refundMethod, items]);
  const draftDirty = !isEdit && (!!saleId || items.some((r) => r.product_id));
  const { status: draftStatus, clearDraft } = useInvoiceDraft("sale_return", draftSnapshot, {
    enabled: !isEdit,
    dirty: draftDirty,
    onRestore: (p) => {
      setSaleId(p.saleId || "");
      setReason(p.reason || "changed_mind");
      setNotes(p.notes || "");
      setRestock(p.restock !== false);
      setRefundMethod(p.refundMethod || "cash");
      if (Array.isArray(p.items) && p.items.length) {
        setItems(p.items.map((it) => newRow({ product_id: "", quantity: 1, ...it })));
      }
      toast.success(t("draftRestored"));
    },
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    api.get("/sales").then(({ data }) => setSales(data.filter((s) => s.status === "confirmed"))).catch(() => {});
  }, []);

  const loadedRef = useRef(false);
  useEffect(() => {
    if (!isEdit || loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        const { data } = await api.get("/returns");
        const r = data.find((x) => x.return_id === id);
        if (!r) throw new Error("not found");
        setSaleId(r.sale_id || "");
        setReason(r.reason || "changed_mind");
        setNotes(r.notes || "");
        setRestock(r.restock !== false);
        setRefundMethod(r.refund_method || "cash");
        setItems(r.items.map((l) => newRow({ product_id: l.product_id, quantity: l.quantity })));
      } catch {
        toast.error(t("somethingWrong"));
        navigate("/returns");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit, navigate, t]);

  const selectedSale = useMemo(() => sales.find((s) => s.sale_id === saleId), [sales, saleId]);

  const setItem = (i, k, v) => setItems((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const total = useMemo(() => {
    let sum = 0;
    for (const r of items) {
      const q = parseInt(r.quantity, 10) || 0;
      if (!q) continue;
      let price = 0;
      if (selectedSale) {
        const line = selectedSale.items.find((l) => l.product_id === r.product_id);
        price = line ? line.unit_price : 0;
      }
      sum += price * q;
    }
    return sum;
  }, [items, selectedSale]);

  const submit = async (e) => {
    e.preventDefault();
    const valid = items.filter((r) => r.product_id && (parseInt(r.quantity, 10) || 0) > 0);
    if (!valid.length) return;
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/returns/${id}`, {
          reason,
          notes,
          restock,
          refund_method: refundMethod,
          items: valid.map((r) => ({ product_id: r.product_id, quantity: parseInt(r.quantity, 10) })),
          pin: editPin || null,
        });
        toast.success(t("returnUpdated"));
      } else {
        await api.post("/returns", {
          sale_id: saleId || null,
          reason,
          notes,
          restock,
          refund_method: refundMethod,
          client_ref: clientRef.current,
          items: valid.map((r) => ({ product_id: r.product_id, quantity: parseInt(r.quantity, 10) })),
        });
        toast.success(t("returnCreated"));
        await clearDraft();
      }
      navigate("/returns");
    } catch (err) {
      if (err?.response?.status === 401) {
        toast.error(t("pinWrong"));
        navigate("/returns");
      } else {
        toast.error(formatApiError(err, t("somethingWrong")));
      }
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && user && !editPin) return <Navigate to="/returns" replace />;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="return-edit-loading">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="fade-up max-w-4xl" data-testid="return-new-page">
      <button onClick={() => navigate("/returns")} data-testid="return-back-btn"
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-6">
        <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("back")}
      </button>
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6">{isEdit ? t("editReturnTitle") : t("newReturn")}</h1>

      <form onSubmit={submit} className="space-y-6" data-testid="return-form">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("originalSale")}</label>
            <select data-testid="return-sale-select" value={saleId} onChange={(e) => setSaleId(e.target.value)} className={inputCls} disabled={isEdit}>
              <option value="">—</option>
              {sales.map((s) => (
                <option key={s.sale_id} value={s.sale_id}>
                  {s.sale_number} · {fmtMoney(s.total)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("reasonLabel")}</label>
            <select data-testid="return-reason-select" value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
              <option value="changed_mind">{t("rChangedMind")}</option>
              <option value="damaged">{t("rDamaged")}</option>
              <option value="wrong_product">{t("rWrongProduct")}</option>
              <option value="defect">{t("rDefect")}</option>
              <option value="other">{t("rOther")}</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("refundMethod")}</label>
            <select data-testid="return-refund-select" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} className={inputCls}>
              <option value="cash">{t("pmCash")}</option>
              <option value="card">{t("pmCard")}</option>
              <option value="transfer">{t("pmTransfer")}</option>
              <option value="other">{t("pmOther")}</option>
            </select>
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
              <input data-testid="return-restock-check" type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500" />
              {t("restockLabel")}
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("notesLabel")}</label>
            <input data-testid="return-notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-bold text-slate-900 mb-4">{t("itemsLabel")}</h3>
          <div className="space-y-3">
            {items.map((r, i) => (
              <div key={r.rowId} className="grid grid-cols-2 md:grid-cols-[1fr_100px_40px] gap-3 items-end rounded-xl border border-slate-100 bg-slate-50/60 p-3" data-testid={`return-item-${i}`}>
                <div className="col-span-2 md:col-span-1">
                  <label className="text-xs text-slate-500 mb-1 block">{t("selectProduct")}</label>
                  <select data-testid={`return-item-product-${i}`} value={r.product_id} onChange={(e) => setItem(i, "product_id", e.target.value)} className={inputCls} required>
                    <option value="">{t("selectProduct")}</option>
                    {(selectedSale ? selectedSale.items : []).map((l) => (
                      <option key={l.product_id} value={l.product_id}>
                        {l.name} (×{l.quantity})
                      </option>
                    ))}
                  </select>
                  {!selectedSale && (
                    <p className="text-xs text-amber-600 mt-1">{t("originalSale")}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t("qtyLabel")}</label>
                  <input data-testid={`return-item-qty-${i}`} type="number" min="1" step="1" value={r.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} className={`${inputCls} tabular`} required />
                </div>
                <button type="button" data-testid={`return-item-remove-${i}`} onClick={() => setItems((rows) => rows.filter((_, j) => j !== i))}
                  className="p-2.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" data-testid="return-add-item-btn" onClick={() => setItems((rows) => [...rows, newRow({ product_id: "", quantity: 1 })])}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-slate-300 text-slate-600 text-sm font-medium hover:border-emerald-400 hover:text-emerald-600 transition-colors">
            <Plus className="w-4 h-4" /> {t("addItem")}
          </button>
        </div>

        <div className="bg-white rounded-xl border border-emerald-100 shadow-sm p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500">{t("refundTotalLabel")}</p>
            <p className="text-xl font-extrabold text-red-600 tabular" data-testid="return-total">{fmtMoney(total)}</p>
          </div>
          <DraftStatus status={draftStatus} />
          <button data-testid="return-submit-btn" type="submit" disabled={saving || !saleId || !items.some((r) => r.product_id)}
            className="inline-flex items-center gap-2 px-8 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? t("saveChanges") : t("confirmReturn")}
          </button>
        </div>
      </form>
    </div>
  );
}
