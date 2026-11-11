import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  DollarSign,
  ShoppingCart,
  ShoppingBag,
  Wallet,
  TrendingUp,
  Percent,
  AlertTriangle,
  Plus,
  Database,
  Trash2,
  Package,
  Boxes,
  Undo2,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { DrilldownModal } from "../components/dashboard/DrilldownModal";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fmtMoney, fmtPct, buildInsights } from "../lib/calculations";
import { AiAssistant } from "../components/AiAssistant";
import { PremiumLock, PremiumBadge } from "../components/PremiumLock";
import { ChartsSection } from "../components/dashboard/ChartsSection";
import { InsightsPanel } from "../components/dashboard/InsightsPanel";

const quickActions = [
  { id: "add-product", to: "/products/new", icon: Plus, label: "qaAddProduct", perm: "products.create" },
  { id: "new-sale", to: "/sales/new", icon: ShoppingCart, label: "qaNewSale", perm: "sales.create" },
  { id: "new-purchase", to: "/purchases/new", icon: ShoppingBag, label: "qaNewPurchase", perm: "purchases.create" },
  { id: "new-return", to: "/returns/new", icon: Undo2, label: "qaNewReturn", perm: "returns.create" },
  { id: "purchase-return", to: "/purchases?return=1", icon: Undo2, label: "qaPurchaseReturn", perm: "purchases.create" },
  { id: "new-expense", to: "/expenses?new=1", icon: Receipt, label: "qaAddExpense", perm: "expenses.create" },
];

function StatCard({ icon: Icon, label, value, tone = "default", testid, onDrill }) {
  const tones = {
    default: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-100 text-emerald-600",
    red: "bg-red-100 text-red-600",
    amber: "bg-amber-100 text-amber-600",
  };
  return (
    <div
      data-testid={testid}
      onClick={onDrill}
      role={onDrill ? "button" : undefined}
      className={`bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 ${onDrill ? "cursor-pointer hover:border-emerald-300" : ""}`}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500 font-medium">{label}</p>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${tones[tone]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-900 tabular">{value}</p>
      {onDrill && <p className="text-[11px] text-emerald-600 font-semibold mt-1.5">⤢</p>}
    </div>
  );
}

function ProductMiniList({ title, products, valueKey, testid }) {
  const { t } = useLanguage();
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm" data-testid={testid}>
      <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">{title} <PremiumBadge /></h3>
      {products.length === 0 ? (
        <p className="text-sm text-slate-400">{t("noResults")}</p>
      ) : (
        <ul className="space-y-3">
          {products.map((p) => (
            <li key={p.product_id}>
              <Link
                to={`/products/${p.product_id}`}
                className="flex items-center justify-between gap-3 group"
                data-testid={`${testid}-item-${p.product_id}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate group-hover:text-emerald-700 transition-colors">
                    {p.name}
                  </p>
                  <p className="text-xs text-slate-400 tabular">
                    {p.quantity_sold} {t("unitsSold")}
                  </p>
                </div>
                {p[valueKey] == null ? (
                  <span className="text-xs font-semibold text-amber-500 whitespace-nowrap" data-testid={`${testid}-na-${p.product_id}`}>
                    {t("costUnavailable")}
                  </span>
                ) : (
                <span
                  className={`text-sm font-bold tabular whitespace-nowrap ${
                    p[valueKey] < 0 ? "text-red-600" : "text-emerald-600"
                  }`}
                >
                  {valueKey === "profit_margin" ? fmtPct(p[valueKey]) : fmtMoney(p[valueKey])}
                </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { t } = useLanguage();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [drill, setDrill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [subOk, setSubOk] = useState(true);
  const [ob, setOb] = useState(null);

  useEffect(() => {
    api.get("/subscription/status")
      .then(({ data }) => setSubOk(!!data.assistant_access))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/onboarding").then(({ data }) => setOb(data)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/dashboard");
      setData(data);
    } catch {
      toast.error(t("somethingWrong"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const seedDemo = async () => {
    setSeeding(true);
    try {
      await api.post("/demo/seed");
      toast.success(t("demoLoaded"));
      await load();
    } catch {
      toast.error(t("somethingWrong"));
    } finally {
      setSeeding(false);
    }
  };

  const clearDemo = async () => {
    try {
      await api.delete("/demo/clear");
      toast.success(t("demoCleared"));
      await load();
    } catch {
      toast.error(t("somethingWrong"));
    }
  };

  const obBanner = ob?.required ? (
    <Link to="/onboarding" data-testid="dashboard-onboarding-banner"
      className="block bg-slate-900 rounded-2xl border border-slate-800 p-5 mb-6 hover:border-emerald-500/50 transition-colors text-start">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-bold text-slate-100">{t("obTitle")}</p>
          <p className="text-xs text-slate-400 mt-1">{t("obBannerSub")}</p>
        </div>
        <span className="shrink-0 inline-flex items-center px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-bold" data-testid="ob-resume-btn">
          {t("obResume")}
        </span>
      </div>
      <div className="h-1.5 mt-4 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${Math.round(((ob.step || 0) / 5) * 100)}%` }} data-testid="ob-banner-progress" />
      </div>
    </Link>
  ) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="dashboard-loading">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!data || data.product_count === 0) {
    return (
      <div className="max-w-xl mx-auto text-center py-16 fade-up" data-testid="dashboard-empty">
        {obBanner}
        <img
          src="https://images.pexels.com/photos/6289064/pexels-photo-6289064.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
          alt="ProfitLens"
          className="w-full h-56 object-cover rounded-2xl border border-slate-200 mb-8"
        />
        <h2 className="text-2xl font-bold text-slate-900 mb-2">{t("emptyTitle")}</h2>
        <p className="text-slate-500 mb-8">{t("emptyDesc")}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8" data-testid="quick-actions-empty">
          {quickActions.filter((a) => can(a.perm)).map((a) => (
            <Link
              key={a.id}
              to={a.to}
              data-testid={`qa-empty-${a.id}`}
              className="flex items-center justify-center gap-2 bg-white border border-slate-200 rounded-xl py-3.5 px-3 text-sm font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50/50 transition-colors shadow-sm"
            >
              <a.icon className="w-4 h-4 text-emerald-500" /> {t(a.label)}
            </Link>
          ))}
        </div>
        {can("products.create") && (
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/products/new"
              data-testid="empty-add-product-btn"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors"
            >
              <Plus className="w-4 h-4" /> {t("addFirst")}
            </Link>
            <button
              onClick={seedDemo}
              disabled={seeding}
              data-testid="empty-load-demo-btn"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-sm transition-colors disabled:opacity-60"
            >
              <Database className="w-4 h-4" /> {t("loadDemo")}
            </button>
          </div>
        )}
      </div>
    );
  }

  const fin = data.finance !== false;

  const insights = buildInsights(data.products);
  const barData = [...data.products]
    .filter((p) => p.net_profit != null)
    .sort((a, b) => b.net_profit - a.net_profit)
    .slice(0, 6)
    .map((p) => ({ name: p.name.length > 14 ? p.name.slice(0, 14) + "…" : p.name, profit: p.net_profit }));
  const pieData = [
    { name: t("legendNetProfit"), value: Math.max(data.net_profit, 0), color: "#10B981" },
    { name: t("legendProductCosts"), value: data.total_product_costs, color: "#64748B" },
    { name: t("legendAdditionalCosts"), value: data.total_additional_costs, color: "#F59E0B" },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6 fade-up" data-testid="dashboard-page">
      {obBanner}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("dashboardTitle")}</h1>
          <p className="text-slate-500 text-sm mt-1">{t("dashboardSubtitle")}</p>
        </div>
        {data.has_demo ? (
          <div
            className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5"
            data-testid="demo-banner"
          >
            <span className="text-xs font-semibold text-amber-700">{t("demoActive")}</span>
            <button
              onClick={clearDemo}
              data-testid="clear-demo-btn"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> {t("clearDemo")}
            </button>
          </div>
        ) : can("products.create") ? (
          <button
            onClick={seedDemo}
            disabled={seeding}
            data-testid="load-demo-btn"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors disabled:opacity-60"
          >
            <Database className="w-4 h-4" /> {t("loadDemo")}
          </button>
        ) : null}
      </div>

      <AiAssistant />
      <DrilldownModal metric={drill} onClose={() => setDrill(null)} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="quick-actions">
        {quickActions.filter((a) => can(a.perm)).map((a) => (
          <Link
            key={a.id}
            to={a.to}
            data-testid={`qa-${a.id}`}
            className="flex items-center justify-center gap-2 bg-white border border-slate-200 rounded-xl py-3.5 px-3 text-sm font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50/50 transition-colors shadow-sm"
          >
            <a.icon className="w-4 h-4 text-emerald-500" /> {t(a.label)}
          </Link>
        ))}
      </div>

      {fin ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4" data-testid="stats-grid">
            <StatCard icon={DollarSign} label={t("totalSales")} value={fmtMoney(data.total_sales)} testid="stat-total-sales" onDrill={() => setDrill("total_sales")} />
            <StatCard icon={ShoppingCart} label={t("productCosts")} value={fmtMoney(data.total_product_costs)} tone="amber" testid="stat-product-costs" onDrill={() => setDrill("cogs")} />
            <StatCard icon={Wallet} label={t("additionalCosts")} value={fmtMoney(data.total_additional_costs)} tone="amber" testid="stat-additional-costs" onDrill={() => setDrill("additional_costs")} />
            <StatCard
              icon={TrendingUp}
              label={t("netProfit")}
              value={fmtMoney(data.net_profit)}
              tone={data.net_profit < 0 ? "red" : "emerald"}
              testid="stat-net-profit"
              onDrill={() => setDrill("net_profit")}
            />
            <StatCard
              icon={Percent}
              label={t("profitMargin")}
              value={fmtPct(data.profit_margin)}
              tone={data.profit_margin < 0 ? "red" : "emerald"}
              testid="stat-profit-margin"
              onDrill={() => setDrill("profit_margin")}
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="business-stats-grid">
            {data.inventory_value != null && (
              <StatCard icon={Boxes} label={t("statInventoryValue")} value={fmtMoney(data.inventory_value)} testid="stat-inventory-value" onDrill={() => setDrill("inventory_value")} />
            )}
            {data.cash_balance != null && (
              <StatCard icon={Wallet} label={t("statCash")} value={fmtMoney(data.cash_balance)} tone="emerald" testid="stat-cash-balance" onDrill={() => setDrill("cash_balance")} />
            )}
            <StatCard icon={AlertTriangle} label={t("statLowStock")} value={data.low_stock_count} tone={data.low_stock_count > 0 ? "amber" : "default"} testid="stat-low-stock" onDrill={() => setDrill("low_stock")} />
            <StatCard icon={Undo2} label={t("statReturns")} value={`${data.returns_count}${data.returns_total != null ? ` (${fmtMoney(data.returns_total)})` : ""}`} tone={data.returns_count > 0 ? "red" : "default"} testid="stat-returns" onDrill={() => setDrill("returns")} />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4" data-testid="stats-grid">
          <StatCard icon={DollarSign} label={t("totalSales")} value={fmtMoney(data.total_sales)} testid="stat-total-sales" />
          <StatCard icon={Package} label={t("productsTitle")} value={data.product_count} testid="stat-product-count" />
          <StatCard icon={AlertTriangle} label={t("statLowStock")} value={data.low_stock_count} tone={data.low_stock_count > 0 ? "amber" : "default"} testid="stat-low-stock" />
        </div>
      )}

      {fin && (subOk === false ? (
        <PremiumLock testid="premium-lock-dashboard" title={t("premiumAnalyticsTitle")} />
      ) : (
        <>
      <ChartsSection barData={barData} pieData={pieData} t={t} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ProductMiniList title={t("topProfitable")} products={data.top_profitable} valueKey="net_profit" testid="top-profitable-list" />
        <ProductMiniList title={t("lowestMargin")} products={data.lowest_margin} valueKey="profit_margin" testid="lowest-margin-list" />
        <ProductMiniList title={t("volumeLowMargin")} products={data.volume_low_margin} valueKey="net_profit" testid="volume-low-margin-list" />
      </div>

      <InsightsPanel insights={insights} t={t} />
        </>
      ))}

      {data.low_stock.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 p-5 shadow-sm" data-testid="low-stock-list">
          <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" /> {t("lowStockTitle")}
          </h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.low_stock.map((p) => (
              <li key={p.product_id}>
                <Link
                  to={`/products/${p.product_id}`}
                  data-testid={`low-stock-${p.product_id}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-amber-50/60 border border-amber-100 px-4 py-3 hover:bg-amber-50 transition-colors"
                >
                  <span className="text-sm font-medium text-slate-800 truncate">{p.name}</span>
                  <span className="text-xs font-bold text-amber-700 tabular whitespace-nowrap">
                    {p.stock_qty} / {p.minimum_stock_level}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
