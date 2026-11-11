import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation, useSearchParams, Navigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useOnlineStatus } from "../lib/pwa";
import { useInvoiceDraft } from "../lib/draft";
import { DraftStatus } from "../components/DraftStatus";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { fmtMoney, num } from "../lib/calculations";
import { ProductAutocomplete, inputCls } from "../components/ProductAutocomplete";

const newRow = (fields) => ({ rowId: crypto.randomUUID(), ...fields });

export default function PurchaseNew() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const online = useOnlineStatus();
  const { id } = useParams();
  const isEdit = !!id;
  const location = useLocation();
  const editPin = location.state?.pin;
  const [products, setProducts] = useState([]);
  const [supplier, setSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [additionalCosts, setAdditionalCosts] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [items, setItems] = useState(() => [newRow({ product_id: "", quantity: 1, unit_cost: "" })]);
  const clientRef = useRef(crypto.randomUUID());
  const draftSnapshot = useMemo(() => ({
    supplier,
    invoiceNumber,
    purchaseDate,
    notes,
    additionalCosts,
    paymentMethod,
    items: items.map(({ product_id, quantity, unit_cost }) => ({ product_id, quantity, unit_cost })),
  }), [supplier, invoiceNumber, purchaseDate, notes, additionalCosts, paymentMethod, items]);
  const draftDirty = !isEdit && (!!supplier.trim() || items.some((r) => r.product_id));
  const { status: draftStatus, clearDraft } = useInvoiceDraft("purchase", draftSnapshot, {
    enabled: !isEdit,
    dirty: draftDirty,
    onRestore: (p) => {
      setSupplier(p.supplier || "");
      setInvoiceNumber(p.invoiceNumber || "");
      setPurchaseDate(p.purchaseDate || "");
      setNotes(p.notes || "");
      setAdditionalCosts(p.additionalCosts ?? "");
      setPaymentMethod(p.paymentMethod || "cash");
      if (Array.isArray(p.items) && p.items.length) {
        setItems(p.items.map((it) => newRow({ product_id: "", quantity: 1, unit_cost: "", ...it })));
      }
      toast.success(t("draftRestored"));
    },
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    api.get("/products").then(({ data }) => setProducts(data)).catch(() => toast.error(t("somethingWrong")));
  }, [t]);

  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    const r = location.state?.resume;
    if (!r) return;
    resumedRef.current = true;
    setSupplier(r.supplier || "");
    setInvoiceNumber(r.invoiceNumber || "");
    setPurchaseDate(r.purchaseDate || "");
    setNotes(r.notes || "");
    setAdditionalCosts(r.additionalCosts || "");
    setPaymentMethod(r.paymentMethod || "cash");
    if (Array.isArray(r.items) && r.items.length) setItems(r.items);
    // If we came back from creating a product, auto-select it in the row that initiated creation.
    const newPid = location.state?.newProductId;
    if (newPid) {
      const rowIdx = typeof r.addProductRow === "number" ? r.addProductRow : 0;
      api.get("/products").then(({ data }) => {
        setProducts(data);
        const p = data.find((x) => x.product_id === newPid);
        if (p) {
          setItems((rows) => rows.map((row, j) => (j === rowIdx ? { ...row, product_id: p.product_id, ...(p.product_cost != null && !row.unit_cost ? { unit_cost: String(p.product_cost) } : {}) } : row)));
          toast.success(`${p.name} ✓`);
        }
      }).catch(() => {});
    }
  }, [location]);

  const handleAddProduct = (rowIndex) => (prefillName) => {
    navigate("/products/new", {
      state: {
        returnTo: isEdit ? `/purchases/${id}/edit` : "/purchases/new",
        prefillName,
        resume: { supplier, invoiceNumber, purchaseDate, notes, additionalCosts, paymentMethod, items, pin: editPin || null, addProductRow: rowIndex },
      },
    });
  };

  const loadedRef = useRef(false);
  useEffect(() => {
    if (!isEdit || loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        const { data } = await api.get("/purchases");
        const p = data.find((x) => x.purchase_id === id);
        if (!p) throw new Error("not found");
        if (location.state?.resume) return;
        setSupplier(p.supplier || "");
        setInvoiceNumber(p.invoice_number || "");
        setPurchaseDate((p.purchase_date || "").slice(0, 10));
        setNotes(p.notes || "");
        setAdditionalCosts(String(p.additional_costs || ""));
        setPaymentMethod(p.payment_method || "cash");
        setItems(p.items.map((l) => newRow({ product_id: l.product_id, quantity: l.quantity, unit_cost: String(l.unit_cost) })));
      } catch {
        toast.error(t("somethingWrong"));
        navigate("/purchases");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit, navigate, t, location]);

  const setItem = (i, k, v) => setItems((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const subtotal = useMemo(
    () => items.reduce((s, r) => s + num(r.unit_cost) * (parseInt(r.quantity, 10) || 0), 0),
    [items]
  );
  const total = subtotal + num(additionalCosts);

  const submit = async (e) => {
    e.preventDefault();
    const valid = items.filter((r) => r.product_id && (parseInt(r.quantity, 10) || 0) > 0);
    if (!supplier.trim() || !valid.length) return;
    setSaving(true);
    const payload = {
      supplier,
      invoice_number: invoiceNumber,
      purchase_date: purchaseDate || null,
      notes,
      additional_costs: num(additionalCosts),
      payment_method: paymentMethod,
      client_ref: clientRef.current,
      items: valid.map((r) => ({
        product_id: r.product_id,
        quantity: parseInt(r.quantity, 10),
        unit_cost: num(r.unit_cost),
      })),
    };
    try {
      if (isEdit) {
        await api.put(`/purchases/${id}`, { ...payload, pin: editPin || null });
        toast.success(t("purchaseUpdated"));
      } else {
        await api.post("/purchases", payload);
        toast.success(t("purchaseCreated"));
        if (!isEdit) await clearDraft();
      }
      navigate(searchParams.get("onboarding") === "1" ? "/onboarding" : "/purchases");
    } catch (err) {
      if (err?.response?.status === 401) {
        toast.error(t("pinWrong"));
        navigate("/purchases");
      } else {
        toast.error(formatApiError(err, t("somethingWrong")));
      }
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && user && !editPin) return <Navigate to="/purchases" replace />;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="purchase-edit-loading">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="fade-up max-w-4xl" data-testid="purchase-new-page">
      <button onClick={() => navigate("/purchases")} data-testid="purchase-back-btn"
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-6">
        <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("back")}
      </button>
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6">{isEdit ? t("editPurchaseTitle") : t("newPurchase")}</h1>

      <form onSubmit={submit} className="space-y-6" data-testid="purchase-form">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("supplier")} *</label>
            <input data-testid="purchase-supplier-input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={t("supplierPh")} required className={inputCls} />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("invoiceNumber")}</label>
            <input data-testid="purchase-invoice-input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("purchaseDate")}</label>
            <input data-testid="purchase-date-input" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={`${inputCls} tabular`} />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("paymentMethod")}</label>
            <select data-testid="purchase-payment-select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls}>
              <option value="cash">{t("pmCash")}</option>
              <option value="card">{t("pmCard")}</option>
              <option value="transfer">{t("pmTransfer")}</option>
              <option value="other">{t("pmOther")}</option>
              <option value="credit">{t("pmCredit")}</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("additionalCostsLabel")}</label>
            <input data-testid="purchase-additional-input" type="number" min="0" step="0.01" value={additionalCosts} onChange={(e) => setAdditionalCosts(e.target.value)} placeholder="0" className={`${inputCls} tabular`} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("notesLabel")}</label>
            <input data-testid="purchase-notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-bold text-slate-900 mb-4">{t("itemsLabel")}</h3>
          <div className="space-y-3">
            {items.map((r, i) => (
              <div key={r.rowId} className="grid grid-cols-2 md:grid-cols-[1fr_100px_130px_110px_40px] gap-3 items-end rounded-xl border border-slate-100 bg-slate-50/60 p-3" data-testid={`purchase-item-${i}`}>
                <div className="col-span-2 md:col-span-1">
                  <label className="text-xs text-slate-500 mb-1 block">{t("selectProduct")}</label>
                  <ProductAutocomplete
                    products={products}
                    value={r.product_id}
                    index={i}
                    t={t}
                    prefix="purchase-item"
                    onAdd={handleAddProduct(i)}
                    onPick={(p) => {
                      setItem(i, "product_id", p ? p.product_id : "");
                      if (p && p.product_cost != null) setItem(i, "unit_cost", String(p.product_cost));
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t("qtyLabel")}</label>
                  <input data-testid={`purchase-item-qty-${i}`} type="number" min="1" step="1" value={r.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} className={`${inputCls} tabular`} required />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t("unitCostLabel")}</label>
                  <input data-testid={`purchase-item-cost-${i}`} type="number" min="0" step="any" value={r.unit_cost} onChange={(e) => setItem(i, "unit_cost", e.target.value)} className={`${inputCls} tabular`} required />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{t("lineTotal")}</label>
                  <p className="text-sm font-bold text-slate-900 tabular py-2.5" data-testid={`purchase-item-total-${i}`}>
                    {fmtMoney(num(r.unit_cost) * (parseInt(r.quantity, 10) || 0))}
                  </p>
                </div>
                <button type="button" data-testid={`purchase-item-remove-${i}`} onClick={() => setItems((rows) => rows.filter((_, j) => j !== i))}
                  className="p-2.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" data-testid="purchase-add-item-btn" onClick={() => setItems((rows) => [...rows, newRow({ product_id: "", quantity: 1, unit_cost: "" })])}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-slate-300 text-slate-600 text-sm font-medium hover:border-emerald-400 hover:text-emerald-600 transition-colors">
            <Plus className="w-4 h-4" /> {t("addItem")}
          </button>
        </div>

        <div className="bg-white rounded-xl border border-emerald-100 shadow-sm p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-8">
            <div>
              <p className="text-xs text-slate-500">{t("subtotalLabel")}</p>
              <p className="font-bold text-slate-900 tabular" data-testid="purchase-subtotal">{fmtMoney(subtotal)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t("grandTotal")}</p>
              <p className="text-xl font-extrabold text-emerald-600 tabular" data-testid="purchase-grand-total">{fmtMoney(total)}</p>
            </div>
          </div>
          <DraftStatus status={draftStatus} />
          <button data-testid="purchase-submit-btn" type="submit" disabled={saving || !online || !supplier.trim() || !items.some((r) => r.product_id)}
            className="inline-flex items-center gap-2 px-8 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? t("saveChanges") : t("confirmPurchase")}
          </button>
        </div>
      </form>
    </div>
  );
}
