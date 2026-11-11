import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Pencil, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fmtMoney, fmtPct, num } from "../lib/calculations";
import { BreakdownCard } from "../components/products/BreakdownCard";

const COST_COLORS = ["#64748B", "#38BDF8", "#F59E0B", "#A78BFA", "#FB7185", "#94A3B8"];

function Stat({ label, value, tone = "text-slate-900", testid }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm" data-testid={testid}>
      <p className="text-sm text-slate-500 font-medium mb-2">{label}</p>
      <p className={`text-xl font-bold tabular ${tone}`}>{value}</p>
    </div>
  );
}

export function fmtDate(iso, lang, empty) {
  if (!iso) return empty;
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ageText(days, lang, todayLabel) {
  if (days === null || days === undefined) return null;
  if (lang === "ar") {
    if (days === 0) return todayLabel;
    if (days === 1) return "يوم واحد";
    if (days === 2) return "يومان";
    if (days <= 10) return `${days} أيام`;
    return `${days} يومًا`;
  }
  if (days === 0) return todayLabel;
  return days === 1 ? "1 day" : `${days} days`;
}

export default function ProductDetails() {
  const { t, lang } = useLanguage();
  const { can } = useAuth();
  const fin = can("products.costs") && can("finance.profit") && can("finance.margin");
  const navigate = useNavigate();
  const { id } = useParams();
  const [p, setP] = useState(null);
  const [newPrice, setNewPrice] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/products/${id}`);
        setP(data);
      } catch {
        toast.error(t("somethingWrong"));
        navigate("/products");
      }
    })();
  }, [id, navigate, t]);

  const sim = useMemo(() => {
    if (!p) return null;
    const np = num(newPrice);
    if (!newPrice || np <= 0) return null;
    const unitProfit = np - p.unit_cost;
    const revenue = np * p.quantity_sold;
    const totalProfit = unitProfit * p.quantity_sold;
    const margin = revenue > 0 ? (totalProfit / revenue) * 100 : 0;
    return { unitProfit, totalProfit, margin, diffUnit: unitProfit - p.unit_profit, diffTotal: totalProfit - p.net_profit };
  }, [newPrice, p]);

  if (!p) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="product-details-loading">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const bd = p.breakdown || {
    product_cost: p.product_cost,
    shipping: p.shipping_cost,
    advertising: p.advertising_cost,
    payment_fee: p.payment_fee,
    discount: p.discount,
    other: p.other_costs,
  };

  const optionalRows = [
    { label: t("fShipping"), value: bd.shipping, mode: p.shipping_cost_mode || "unit", raw: p.shipping_cost },
    { label: t("fAds"), value: bd.advertising, mode: p.advertising_cost_mode || "unit", raw: p.advertising_cost },
    { label: t("fFee"), value: bd.payment_fee, mode: p.payment_fee_mode || "unit", raw: p.payment_fee },
    { label: t("fDiscount"), value: bd.discount, mode: p.discount_mode || "unit", raw: p.discount },
    { label: t("fOther"), value: bd.other, mode: p.other_costs_mode || "unit", raw: p.other_costs },
  ];

  const pieData = [
    { name: t("fCost"), value: bd.product_cost },
    ...optionalRows.map((r) => ({ name: r.label, value: r.value })),
  ]
    .filter((d) => d.value > 0)
    .map((d, i) => ({ ...d, color: COST_COLORS[i % COST_COLORS.length] }));

  return (
    <div className="space-y-6 fade-up" data-testid="product-details-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/products")}
            data-testid="details-back-btn"
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{p.name}</h1>
              {p.is_demo && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                  {t("demoBadge")}
                </span>
              )}
            </div>
            {p.sku && <p className="text-sm text-slate-400 tabular">{p.sku}</p>}
          </div>
        </div>
        {can("products.edit") && (
          <Link
            to={`/products/${p.product_id}/edit`}
            data-testid="details-edit-btn"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors"
          >
            <Pencil className="w-4 h-4" /> {t("edit")}
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={t("sellingPrice")} value={fmtMoney(p.selling_price)} testid="detail-price" />
        <Stat label={t("fQty")} value={`${p.quantity_sold} ${t("unitsSold")}`} testid="detail-qty" />
        <Stat label={t("revenueLabel")} value={fmtMoney(p.revenue)} testid="detail-revenue" />
        <Stat
          label={t("stockCol")}
          value={`${p.stock_qty ?? 0}${p.minimum_stock_level > 0 ? ` / ${p.minimum_stock_level}` : ""}`}
          tone={p.minimum_stock_level > 0 && (p.stock_qty ?? 0) <= p.minimum_stock_level ? "text-amber-600" : "text-slate-900"}
          testid="detail-stock"
        />
        {fin && (
          <>
            <Stat label={t("totalCostsLabel")} value={fmtMoney(p.total_costs)} testid="detail-total-costs" />
            <Stat
              label={t("netProfit")}
              value={fmtMoney(p.net_profit)}
              tone={p.net_profit < 0 ? "text-red-600" : "text-emerald-600"}
              testid="detail-net-profit"
            />
            <Stat
              label={t("profitMargin")}
              value={fmtPct(p.profit_margin)}
              tone={p.profit_margin < 0 ? "text-red-600" : "text-emerald-600"}
              testid="detail-margin"
            />
            <Stat
              label={t("unitProfit")}
              value={fmtMoney(p.unit_profit)}
              tone={p.unit_profit < 0 ? "text-red-600" : "text-emerald-600"}
              testid="detail-unit-profit"
            />
          </>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5" data-testid="product-dates-card">
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <p className="text-xs text-slate-400 font-medium mb-1">{t("createdAtLabel")}</p>
            <p className="text-sm font-semibold text-slate-800" data-testid="detail-created-at">
              {fmtDate(p.created_at, lang, t("notSpecified"))}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium mb-1">{t("launchDate")}</p>
            <p className="text-sm font-semibold text-slate-800" data-testid="detail-launch-date">
              {fmtDate(p.launch_date, lang, t("notSpecified"))}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium mb-1">{t("lastUpdated")}</p>
            <p className="text-sm font-semibold text-slate-800" data-testid="detail-updated-at">
              {fmtDate(p.updated_at, lang, t("notSpecified"))}
            </p>
          </div>
          {p.age_days !== null && p.age_days !== undefined && (
            <div>
              <p className="text-xs text-slate-400 font-medium mb-1">{t("productAge")}</p>
              <p className="text-sm font-semibold text-emerald-700" data-testid="detail-product-age">
                {ageText(p.age_days, lang, t("ageToday"))}
              </p>
            </div>
          )}
        </div>
      </div>

      {fin && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <BreakdownCard p={p} bd={bd} optionalRows={optionalRows} pieData={pieData} t={t} />

        <div className="lg:col-span-5 bg-white rounded-xl border border-emerald-100 shadow-sm p-6" data-testid="price-simulator">
          <div className="flex items-center gap-2 mb-2">
            <FlaskConical className="w-5 h-5 text-emerald-500" />
            <h3 className="font-bold text-slate-900">{t("simTitle")}</h3>
          </div>
          <p className="text-sm text-slate-500 mb-5">{t("simDesc")}</p>

          <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("simNewPrice")}</label>
          <div className="relative mb-5">
            <span className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 text-sm">$</span>
            <input
              data-testid="simulator-price-input"
              type="number"
              min="0"
              step="0.01"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder={`${t("simCurrentPrice")}: $${p.selling_price}`}
              className="w-full ps-7 pe-4 py-2.5 rounded-lg border border-slate-200 text-sm tabular focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3" aria-live="polite">
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs text-slate-500 mb-1">{t("simCurrentPrice")}</p>
              <p className="font-bold text-slate-900 tabular" data-testid="sim-current-price">{fmtMoney(p.selling_price)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs text-slate-500 mb-1">{t("simCurrentProfit")}</p>
              <p className="font-bold text-slate-900 tabular" data-testid="sim-current-profit">{fmtMoney(p.unit_profit)}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-4">
              <p className="text-xs text-emerald-600 mb-1">{t("simNewProfit")}</p>
              <p className="font-bold text-emerald-700 tabular" data-testid="sim-new-profit">
                {sim ? fmtMoney(sim.unitProfit) : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-4">
              <p className="text-xs text-emerald-600 mb-1">{t("simNewMargin")}</p>
              <p className="font-bold text-emerald-700 tabular" data-testid="sim-new-margin">
                {sim ? fmtPct(sim.margin) : "—"}
              </p>
            </div>
          </div>

          {sim && (
            <div
              className={`mt-4 rounded-lg p-4 border ${
                sim.diffUnit >= 0 ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"
              }`}
              data-testid="sim-diff"
            >
              <p className="text-xs text-slate-500 mb-1">{t("simDiff")}</p>
              <p className={`font-bold tabular ${sim.diffUnit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                {sim.diffUnit >= 0 ? "+" : ""}
                {fmtMoney(sim.diffUnit)}{" "}{t("perUnit")}{" "}·{" "}{sim.diffTotal >= 0 ? "+" : ""}
                {fmtMoney(sim.diffTotal)}
              </p>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
