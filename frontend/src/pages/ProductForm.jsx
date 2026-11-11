import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation, useSearchParams, Navigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { computeMetrics, fmtMoney, fmtPct } from "../lib/calculations";
import { CalcPanel } from "../components/products/CalcPanel";
import { SPEC_UNITS, specUnitLabel } from "../i18n";
import { CURRENCY_OPTIONS } from "../lib/locale";

const EMPTY = {
  name: "",
  sku: "",
  selling_price: "",
  product_cost: "",
  currency: "",
  shipping_cost: "",
  shipping_cost_mode: "unit",
  advertising_cost: "",
  advertising_cost_mode: "unit",
  payment_fee: "",
  payment_fee_mode: "unit",
  discount: "",
  discount_mode: "unit",
  other_costs: "",
  other_costs_mode: "unit",
  minimum_stock_level: "",
  launch_date: "",
  spec_quantity: "",
  spec_unit: "",
  spec_unit_custom: "",
};

const PRODUCT_CURRENCIES = CURRENCY_OPTIONS;

const inputCls =
  "w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors";
const moneyCls =
  "w-full ps-7 pe-4 py-2.5 rounded-lg border border-slate-200 text-sm tabular focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors";

function ModeToggle({ value, onChange, options, testid }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shrink-0" data-testid={testid}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          data-testid={`${testid}-${o.value}`}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors duration-150 ${
            value === o.value ? "bg-emerald-500 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CostField({ t, label, field, modeField, form, set }) {
  const mode = form[modeField];
  const modeOptions = useMemo(() => [
    { value: "unit", label: t("modeUnit") },
    { value: "total", label: t("modeTotal") },
  ], [t]);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4" data-testid={`cost-field-${field.replace(/_/g, "-")}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <label className="text-sm font-medium text-slate-700">
          {t(label)}
          <span className="ms-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 align-middle">
            {t("optionalBadge")}
          </span>
        </label>
        <ModeToggle
          testid={`mode-toggle-${field.replace(/_/g, "-")}`}
          value={mode}
          onChange={(v) => set(modeField, v)}
          options={modeOptions}
        />
      </div>
      <div className="relative">
        <span className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 text-sm">$</span>
        <input
          data-testid={`form-${field.replace(/_/g, "-")}-input`}
          type="number"
          min="0"
          step="0.01"
          value={form[field]}
          onChange={(e) => set(field, e.target.value)}
          placeholder="0"
          className={moneyCls}
        />
      </div>
      <p className="text-xs text-slate-400 mt-1.5">{mode === "total" ? t("hintTotal") : t("hintUnit")}</p>
    </div>
  );
}

const OPTIONAL_FIELDS = [
  { field: "shipping_cost", label: "fShipping" },
  { field: "advertising_cost", label: "fAds" },
  { field: "payment_fee", label: "fFee" },
  { field: "other_costs", label: "fOther" },
];

export default function ProductForm() {
  const { t } = useLanguage();
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id } = useParams();
  const isEdit = !!id;
  const location = useLocation();
  const returnTo = !isEdit ? location.state?.returnTo : null;
  const [form, setForm] = useState(() => ({ ...EMPTY, name: location.state?.prefillName || "" }));
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await api.get(`/products/${id}`);
        const next = { ...EMPTY };
        Object.keys(EMPTY).forEach((k) => {
          next[k] = data[k] ?? EMPTY[k];
        });
        if (next.spec_unit && !SPEC_UNITS.includes(next.spec_unit)) {
          next.spec_unit_custom = next.spec_unit;
          next.spec_unit = "__custom";
        }
        setForm(next);
      } catch {
        toast.error(t("somethingWrong"));
        navigate("/products");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit, navigate, t]);

  const discountModeOptions = useMemo(() => [
    { value: "unit", label: t("modeFixed") },
    { value: "percent", label: t("modePercent") },
  ], [t]);

  if (user && !(isEdit ? can("products.edit") : can("products.create"))) return <Navigate to="/dashboard" replace />;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const m = computeMetrics(form);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (form.discount_mode === "percent" && (parseFloat(form.discount) || 0) > 100) {
      toast.error(t("discountTooHigh"));
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      sku: form.sku || "",
      selling_price: form.selling_price === "" ? null : parseFloat(form.selling_price),
      product_cost: parseFloat(form.product_cost) || 0,
      currency: form.currency || null,
      shipping_cost: parseFloat(form.shipping_cost) || 0,
      shipping_cost_mode: form.shipping_cost_mode,
      advertising_cost: parseFloat(form.advertising_cost) || 0,
      advertising_cost_mode: form.advertising_cost_mode,
      payment_fee: parseFloat(form.payment_fee) || 0,
      payment_fee_mode: form.payment_fee_mode,
      discount: parseFloat(form.discount) || 0,
      discount_mode: form.discount_mode,
      other_costs: parseFloat(form.other_costs) || 0,
      other_costs_mode: form.other_costs_mode,
      minimum_stock_level: parseInt(form.minimum_stock_level, 10) || 0,
      launch_date: form.launch_date || null,
      spec_quantity: form.spec_quantity === "" ? null : parseFloat(form.spec_quantity),
      spec_unit: form.spec_unit === "__custom" ? form.spec_unit_custom.trim() || null : form.spec_unit || null,
    };
    try {
      let createdId = null;
      if (isEdit) {
        await api.put(`/products/${id}`, payload);
        toast.success(t("productUpdated"));
      } else {
        const { data } = await api.post("/products", payload);
        createdId = data?.product_id || null;
        toast.success(t("productSaved"));
      }
      if (returnTo) {
        navigate(returnTo, { state: { resume: location.state?.resume, pin: location.state?.resume?.pin ?? null, newProductId: createdId } });
      } else {
        navigate(searchParams.get("onboarding") === "1" ? "/onboarding" : "/products");
      }
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="product-form-loading">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="fade-up" data-testid="product-form-page">
      <button
        onClick={() => {
          if (returnTo) {
            navigate(returnTo, { state: { resume: location.state?.resume, pin: location.state?.resume?.pin ?? null } });
          } else {
            navigate(-1);
          }
        }}
        data-testid="form-back-btn"
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("back")}
      </button>

      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">
          {isEdit ? t("editProductTitle") : t("addProductTitle")}
        </h1>
        <p className="text-slate-500 text-sm mt-1">{t("formSubtitle")}</p>
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-testid="product-form">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h3 className="font-bold text-slate-900 mb-5">{t("requiredSection")}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                  {t("fName")}
                  <span className="ms-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 align-middle">{t("requiredBadge")}</span>
                </label>
                <input
                  data-testid="form-name-input"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  required
                  placeholder={t("fNamePh")}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("fSku")}</label>
                <input
                  data-testid="form-sku-input"
                  value={form.sku}
                  onChange={(e) => set("sku", e.target.value)}
                  placeholder={t("fSkuPh")}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                  {t("fPrice")}
                  <span className="ms-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 align-middle">{t("optionalBadge")}</span>
                </label>
                <div className="relative">
                  <span className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 text-sm">$</span>
                  <input
                    data-testid="form-selling-price-input"
                    type="number" min="0" step="0.01"
                    value={form.selling_price}
                    onChange={(e) => set("selling_price", e.target.value)}
                    placeholder="0"
                    className={moneyCls}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                  {t("fCost")}
                  <span className="ms-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 align-middle">{t("requiredBadge")}</span>
                </label>
                <div className="relative">
                  <span className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 text-sm">$</span>
                  <input
                    data-testid="form-product-cost-input"
                    type="number" min="0" step="any" required
                    value={form.product_cost}
                    onChange={(e) => set("product_cost", e.target.value)}
                    placeholder="0"
                    className={moneyCls}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                  {t("fCurrency")}
                  <span className="ms-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 align-middle">{t("optionalBadge")}</span>
                </label>
                <select
                  data-testid="form-currency-select"
                  value={form.currency}
                  onChange={(e) => set("currency", e.target.value)}
                  className={inputCls}
                >
                  <option value="">{t("fCurrencyNone")}</option>
                  {PRODUCT_CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                  {t("launchDate")}
                  <span className="ms-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 align-middle">{t("optionalBadge")}</span>
                </label>
                <input
                  data-testid="form-launch-date-input"
                  type="date"
                  value={form.launch_date || ""}
                  onChange={(e) => set("launch_date", e.target.value)}
                  className={`${inputCls} tabular`}
                />
                <p className="text-xs text-slate-400 mt-1.5">{t("launchDateHint")}</p>
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                  {t("fSpec")}
                  <span className="ms-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 align-middle">{t("optionalBadge")}</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    data-testid="form-spec-quantity-input"
                    type="number" min="0" step="0.01"
                    value={form.spec_quantity}
                    onChange={(e) => set("spec_quantity", e.target.value)}
                    placeholder={t("fSpecQty")}
                    className={`${inputCls} tabular`}
                  />
                  <select
                    data-testid="form-spec-unit-select"
                    value={form.spec_unit}
                    onChange={(e) => set("spec_unit", e.target.value)}
                    className={inputCls}
                  >
                    <option value="">{t("fSpecNone")}</option>
                    {SPEC_UNITS.map((u) => (
                      <option key={u} value={u}>{specUnitLabel(u, t)}</option>
                    ))}
                    <option value="__custom">{t("fSpecCustom")}</option>
                  </select>
                </div>
                {form.spec_unit === "__custom" && (
                  <input
                    data-testid="form-spec-unit-custom-input"
                    value={form.spec_unit_custom}
                    onChange={(e) => set("spec_unit_custom", e.target.value)}
                    placeholder={t("fSpecCustomPh")}
                    maxLength={30}
                    className={`${inputCls} mt-2`}
                  />
                )}
                <p className="text-xs text-slate-400 mt-1.5">{t("specHint")}</p>
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                  {t("minStockField")}
                  <span className="ms-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 align-middle">{t("optionalBadge")}</span>
                </label>
                <input
                  data-testid="form-min-stock-input"
                  type="number" min="0" step="1"
                  value={form.minimum_stock_level}
                  onChange={(e) => set("minimum_stock_level", e.target.value)}
                  placeholder="0"
                  className={`${inputCls} tabular`}
                />
                <p className="text-xs text-slate-400 mt-1.5">{t("minStockHint")}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h3 className="font-bold text-slate-900">{t("optionalSection")}</h3>
            <p className="text-xs text-slate-400 mt-1 mb-5">{t("optionalSectionDesc")}</p>
            <div className="grid grid-cols-1 gap-4">
              {OPTIONAL_FIELDS.map(({ field, label }) => (
                <CostField
                  key={field}
                  t={t}
                  label={label}
                  field={field}
                  modeField={`${field}_mode`}
                  form={form}
                  set={set}
                />
              ))}

              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4" data-testid="cost-field-discount">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                  <label className="text-sm font-medium text-slate-700">
                    {t("fDiscount")}
                    <span className="ms-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 align-middle">
                      {t("optionalBadge")}
                    </span>
                  </label>
                  <ModeToggle
                    testid="mode-toggle-discount"
                    value={form.discount_mode}
                    onChange={(v) => set("discount_mode", v)}
                    options={discountModeOptions}
                  />
                </div>
                <div className="relative">
                  <span className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 text-sm">
                    {form.discount_mode === "percent" ? "%" : "$"}
                  </span>
                  <input
                    data-testid="form-discount-input"
                    type="number"
                    min="0"
                    max={form.discount_mode === "percent" ? "100" : undefined}
                    step="0.01"
                    value={form.discount}
                    onChange={(e) => set("discount", e.target.value)}
                    placeholder="0"
                    className={moneyCls}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1.5">
                  {form.discount_mode === "percent" ? t("hintPercent") : t("hintFixed")}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <CalcPanel m={m} t={t} saving={saving} canSave={!!form.name.trim()} />
        </div>
      </form>
    </div>
  );
}
