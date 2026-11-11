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
import { num } from "../lib/calculations";
import { CURRENCY_OPTIONS } from "../lib/locale";
import { ProductAutocomplete, inputCls } from "../components/ProductAutocomplete";

const newRow = (fields) => ({ rowId: crypto.randomUUID(), ...fields });

const SALE_CURRENCIES = CURRENCY_OPTIONS;
const CUR_MARK = {
  en: { USD: "$", EUR: "€", EGP: "EGP", SYP: "SYP", AED: "AED" },
  ar: { USD: "$", EUR: "€", EGP: "جنيه مصري", SYP: "ل.س", AED: "د.إ" },
};

export function fmtSaleMoney(v, currency, lang) {
  const mark = (CUR_MARK[lang] || CUR_MARK.en)[currency] || currency || "$";
  const n = num(v).toFixed(2);
  return mark === "$" || mark === "€" ? `${mark}${n}` : `${n} ${mark}`;
}

export default function SaleNew() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const online = useOnlineStatus();
  const { id } = useParams();
  const isEdit = !!id;
  const location = useLocation();
  const editPin = location.state?.pin;
  const [products, setProducts] = useState([]);
  const [customer, setCustomer] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [currency, setCurrency] = useState(user?.business?.base_currency && SALE_CURRENCIES.includes(user.business.base_currency) ? user.business.base_currency : "USD");
  const [items, setItems] = useState(() => [newRow({ product_id: "", quantity: 1, unit_type: "piece", unit_price: "", discount: "", total: "" })]);
  const [saving, setSaving] = useState(false);
  const clientRef = useRef(crypto.randomUUID());
  const draftSnapshot = useMemo(() => ({
    customer,
    paymentMethod,
    currency,
    items: items.map(({ product_id, quantity, unit_type, unit_price, discount, total }) => ({ product_id, quantity, unit_type, unit_price, discount, total })),
  }), [customer, paymentMethod, currency, items]);
  const draftDirty = !isEdit && (!!customer.trim() || items.some((r) => r.product_id));
  const { status: draftStatus, clearDraft } = useInvoiceDraft("sale", draftSnapshot, {
    enabled: !isEdit,
    dirty: draftDirty,
    onRestore: (p) => {
      setCustomer(p.customer || "");
      setPaymentMethod(p.paymentMethod || "cash");
      if (p.currency) setCurrency(p.currency);
      if (Array.isArray(p.items) && p.items.length) {
        setItems(p.items.map((it) => newRow({ product_id: "", quantity: 1, unit_type: "piece", unit_price: "", discount: "", total: "", ...it })));
      }
      toast.success(t("draftRestored"));
    },
  });
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    api.get("/products").then(({ data }) => setProducts(data)).catch(() => toast.error(t("somethingWrong")));
  }, [t]);

  const loadedRef = useRef(false);
  useEffect(() => {
    if (!isEdit || loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        const { data } = await api.get("/sales");
        const s = data.find((x) => x.sale_id === id);
        if (!s) throw new Error("not found");
        setCustomer(s.customer || "");
        setPaymentMethod(s.payment_method || "cash");
        if (s.currency && SALE_CURRENCIES.includes(s.currency)) setCurrency(s.currency);
        setItems(s.items.map((l) => newRow({
          product_id: l.product_id,
          quantity: l.quantity,
          unit_type: l.unit_type || "piece",
          unit_price: String(l.unit_price ?? ""),
          discount: String(l.discount || ""),
          total: String(+(num(l.total) + num(l.discount)).toFixed(2)),
        })));
      } catch {
        toast.error(t("somethingWrong"));
        navigate("/sales");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit, navigate, t]);

  const setItem = (i, k, v) => {
    setItems((rows) => rows.map((r, j) => {
      if (j !== i) return r;
      const next = { ...r, [k]: v };
      if (k === "product_id") {
        const p = products.find((x) => x.product_id === v);
        if (p && r.unit_price === "") next.unit_price = String(p.selling_price);
      }
      if (k === "total" || k === "quantity") {
        const q = parseInt(next.quantity, 10) || 0;
        next.unit_price = q > 0 && next.total !== "" ? String(+(num(next.total) / q).toFixed(4)) : "";
      }
      return next;
    }));
  };

  const totals = useMemo(() => {
    let subtotal = 0, discount = 0;
    for (const r of items) {
      const lineTotal = num(r.total);
      const d = Math.min(num(r.discount), lineTotal);
      subtotal += lineTotal;
      discount += d;
    }
    return { subtotal, discount, total: subtotal - discount };
  }, [items]);

  const submit = async (e) => {
    e.preventDefault();
    const valid = items.filter((r) => r.product_id && (parseInt(r.quantity, 10) || 0) > 0 && r.unit_type && r.total !== "");
    if (!valid.length) return;
    setSaving(true);
    const payload = {
      customer,
      payment_method: paymentMethod,
      currency,
      client_ref: clientRef.current,
      items: valid.map((r) => ({
        product_id: r.product_id,
        quantity: parseInt(r.quantity, 10),
        unit_type: r.unit_type,
        unit_price: num(r.unit_price),
        discount: num(r.discount),
        total: num(r.total),
      })),
    };
    try {
      if (isEdit) {
        await api.put(`/sales/${id}`, { ...payload, pin: editPin || null });
        toast.success(t("saleUpdated"));
      } else {
        await api.post("/sales", payload);
        toast.success(t("saleCreated"));
        if (!isEdit) await clearDraft();
      }
      navigate(searchParams.get("onboarding") === "1" ? "/onboarding" : "/sales");
    } catch (err) {
      if (err?.response?.status === 401) {
        toast.error(t("pinWrong"));
        navigate("/sales");
      } else {
        toast.error(formatApiError(err, t("somethingWrong")));
      }
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && user && !editPin) return <Navigate to="/sales" replace />;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="sale-edit-loading">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="fade-up max-w-4xl" data-testid="sale-new-page">
      <button onClick={() => navigate("/sales")} data-testid="sale-back-btn"
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-6">
        <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("back")}
      </button>
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6">{isEdit ? t("editSaleTitle") : t("newSale")}</h1>

      <form onSubmit={submit} className="space-y-6" data-testid="sale-form">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("customer")}</label>
            <input data-testid="sale-customer-input" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder={t("customerPh")} className={inputCls} />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("paymentMethod")}</label>
            <select data-testid="sale-payment-select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls}>
              <option value="cash">{t("pmCash")}</option>
              <option value="card">{t("pmCard")}</option>
              <option value="transfer">{t("pmTransfer")}</option>
              <option value="other">{t("pmOther")}</option>
              <option value="credit">{t("pmCredit")}</option>
            </select>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-bold text-slate-900 mb-4">{t("itemsLabel")}</h3>
          <div className="space-y-3">
            {items.map((r, i) => {
              const p = products.find((x) => x.product_id === r.product_id);
              return (
                <div key={r.rowId} className="grid grid-cols-2 md:grid-cols-[minmax(0,2.4fr)_repeat(2,minmax(0,1fr))] xl:grid-cols-[minmax(240px,2.4fr)_72px_120px_112px_112px_40px] gap-3 items-end rounded-xl border border-slate-100 bg-slate-50/60 p-3" data-testid={`sale-item-${i}`}>
                  <div className="col-span-2 md:col-span-3 xl:col-span-1">
                    <label className="text-xs text-slate-500 mb-1 block">{t("selectProduct")}</label>
                    <ProductAutocomplete
                      products={products}
                      value={r.product_id}
                      index={i}
                      prefix="sale-item"
                      t={t}
                      onPick={(p) => setItem(i, "product_id", p ? p.product_id : "")}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t("qtyLabel")}</label>
                    <input data-testid={`sale-item-qty-${i}`} type="number" min="1" step="1" value={r.quantity}
                      onChange={(e) => setItem(i, "quantity", e.target.value)} className={`${inputCls} tabular`} required />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t("unitType")} *</label>
                    <select data-testid={`sale-item-unit-${i}`} value={r.unit_type} onChange={(e) => setItem(i, "unit_type", e.target.value)} className={`${inputCls} h-[42px]`} required>
                      <option value="gram">{t("unitGram")}</option>
                      <option value="kilogram">{t("unitKilogram")}</option>
                      <option value="milliliter">{t("unitMilliliter")}</option>
                      <option value="piece">{t("unitPiece")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t("unitPriceLabel")}</label>
                    <input data-testid={`sale-item-price-${i}`} type="number" value={r.unit_price} readOnly
                      className={`${inputCls} tabular bg-slate-100 text-slate-600 cursor-not-allowed`} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t("lineDiscount")}</label>
                    <input data-testid={`sale-item-discount-${i}`} type="number" min="0" step="0.01" value={r.discount}
                      onChange={(e) => setItem(i, "discount", e.target.value)} className={`${inputCls} tabular`} placeholder="0" />
                  </div>
                  <div className="col-span-2 flex justify-end md:col-span-3 xl:col-span-1">
                    <button type="button" data-testid={`sale-item-remove-${i}`} onClick={() => setItems((rows) => rows.filter((_, j) => j !== i))}
                      className="p-2.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="col-span-2 md:col-span-3 xl:col-span-6 xl:max-w-md">
                    <label className="text-xs text-slate-500 mb-1 block">{t("lineTotal")} *</label>
                    <div className="flex items-stretch rounded-lg border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500 transition-shadow overflow-hidden h-[46px]">
                      <select data-testid={`sale-item-currency-${i}`} value={currency} onChange={(e) => setCurrency(e.target.value)}
                        className="shrink-0 w-14 border-0 border-e border-slate-200 bg-slate-50 pe-4 ps-3 text-sm tabular font-bold text-slate-600 focus:outline-none appearance-auto cursor-pointer" title={t("currencyLabel")}>
                        {SALE_CURRENCIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <input data-testid={`sale-item-total-${i}`} type="number" min="0" step="0.01" value={r.total}
                        onChange={(e) => setItem(i, "total", e.target.value)} className="flex-1 min-w-0 border-0 px-4 text-lg font-extrabold tabular text-emerald-700 focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" required placeholder="0" />
                    </div>
                  </div>
                  {p && (parseInt(r.quantity, 10) || 0) > p.stock_qty && (
                    <p className="col-span-full text-xs text-amber-600 font-medium">⚠ {p.name}: {t("currentStock")} = {p.stock_qty}</p>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" data-testid="sale-add-item-btn" onClick={() => setItems((rows) => [...rows, newRow({ product_id: "", quantity: 1, unit_type: "piece", unit_price: "", discount: "", total: "" })])}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-slate-300 text-slate-600 text-sm font-medium hover:border-emerald-400 hover:text-emerald-600 transition-colors">
            <Plus className="w-4 h-4" /> {t("addItem")}
          </button>
        </div>

        <div className="bg-white rounded-xl border border-emerald-100 shadow-sm p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-8">
            <div>
              <p className="text-xs text-slate-500">{t("subtotalLabel")}</p>
              <p className="font-bold text-slate-900 tabular" data-testid="sale-subtotal">{fmtSaleMoney(totals.subtotal, currency, lang)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t("lineDiscount")}</p>
              <p className="font-bold text-slate-900 tabular" data-testid="sale-discount-total">{fmtSaleMoney(totals.discount, currency, lang)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t("grandTotal")}</p>
              <p className="text-xl font-extrabold text-emerald-600 tabular" data-testid="sale-grand-total">{fmtSaleMoney(totals.total, currency, lang)}</p>
            </div>
          </div>
          <DraftStatus status={draftStatus} />
          <button data-testid="sale-submit-btn" type="submit" disabled={saving || !online || !items.some((r) => r.product_id)}
            className="inline-flex items-center gap-2 px-8 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? t("saveChanges") : t("confirmSale")}
          </button>
        </div>
      </form>
    </div>
  );
}
