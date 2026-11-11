import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import api from "../lib/api";
import { isPinRequired } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fmtMoney, fmtPct } from "../lib/calculations";
import { fmtDateTime } from "./Sales";
import PinGate from "../components/PinGate";
import { PremiumLock } from "../components/PremiumLock";
import { Crown } from "lucide-react";

const inputCls = "px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";

const REPORT_TYPES = [
  { key: "sales", label: "repSales", perm: "sales.view" },
  { key: "purchases", label: "repPurchases", perm: "purchases.view" },
  { key: "inventory", label: "repInventory", perm: "inventory.view" },
  { key: "returns", label: "repReturns", perm: "returns.view" },
  { key: "expenses", label: "repExpenses", perm: "expenses.view" },
  { key: "profit", label: "repProfit", perm: "finance.reports", premium: true },
  { key: "cash", label: "repCash", perm: "cash.view" },
];

const RANGES = [
  { key: "today", label: "rangeToday" },
  { key: "7d", label: "range7" },
  { key: "30d", label: "range30" },
  { key: "month", label: "rangeMonth" },
  { key: "last_month", label: "rangeLastMonth" },
  { key: "year", label: "rangeYear" },
  { key: "custom", label: "rangeCustom" },
];

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

function resolveRange(range, customFrom, customTo) {
  const now = new Date();
  const today = isoDay(now);
  switch (range) {
    case "today":
      return { from: today, to: today };
    case "7d": {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      return { from: isoDay(d), to: today };
    }
    case "30d": {
      const d = new Date(now); d.setDate(d.getDate() - 29);
      return { from: isoDay(d), to: today };
    }
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_month": {
      const d = new Date(now); d.setMonth(d.getMonth() - 1);
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0");
      const last = new Date(y, d.getMonth() + 1, 0).getDate();
      return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, "0")}` };
    }
    case "year":
      return { from: `${now.getFullYear()}-01-01`, to: today };
    case "custom":
      return { from: customFrom || null, to: customTo || null };
    default:
      return { from: null, to: null };
  }
}

const cell = "px-5 py-3 text-slate-700";
const head = "text-start font-medium px-5 py-3 text-slate-500";

export default function Reports() {
  const { t, lang } = useLanguage();
  const { can } = useAuth();
  const fin = can("finance.profit");
  const available = REPORT_TYPES.filter((r) => can(r.perm));
  const [type, setType] = useState(available[0]?.key || "sales");
  const [range, setRange] = useState("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pinLocked, setPinLocked] = useState(false);
  const [subOk, setSubOk] = useState(null);

  useEffect(() => {
    api.get("/subscription/status")
      .then(({ data }) => setSubOk(!!data.assistant_access))
      .catch(() => setSubOk(true));
  }, []);

  const activeType = available.some((r) => r.key === type) ? type : available[0]?.key;
  const premiumLocked = activeType === "profit" && subOk === false;

  const load = useCallback(async () => {
    if (!activeType) return;
    if (range === "custom" && (!applied.from || !applied.to)) return;
    if (premiumLocked) {
      setData(null);
      return;
    }
    setLoading(true);
    const { from, to } = resolveRange(range, applied.from, applied.to);
    try {
      const params = new URLSearchParams();
      if (from) params.set("date_from", from);
      if (to) params.set("date_to", to);
      const { data } = await api.get(`/reports/${activeType}?${params.toString()}`);
      setData(data);
      setPinLocked(false);
    } catch (err) {
      if (isPinRequired(err)) {
        setPinLocked(true);
        setData(null);
      } else if (err?.response?.data?.detail === "SUBSCRIPTION_REQUIRED") {
        setSubOk(false);
        setData(null);
      } else {
        toast.error(t("somethingWrong"));
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, [activeType, range, applied, premiumLocked, t]);

  useEffect(() => { load(); }, [load]);

  const applyCustom = () => {
    if (!customFrom || !customTo) {
      toast.error(t("selectBothDates"));
      return;
    }
    const [from, to] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
    setApplied({ from, to });
  };

  const summaryCards = useMemo(() => {
    if (!data) return [];
    if (activeType === "sales") {
      const cards = [
        { label: t("revenueLabel"), value: fmtMoney(data.revenue), testid: "rep-sales-revenue" },
        { label: t("salesTitle"), value: data.count, testid: "rep-sales-count" },
      ];
      if (data.profit !== undefined) cards.push({ label: t("profitLabel"), value: fmtMoney(data.profit), testid: "rep-sales-profit" });
      return cards;
    }
    if (activeType === "purchases") return [
      { label: t("grandTotal"), value: fmtMoney(data.total), testid: "rep-purchases-total" },
      { label: t("purchasesTitle"), value: data.count, testid: "rep-purchases-count" },
    ];
    if (activeType === "returns") return [
      { label: t("refundTotalLabel"), value: fmtMoney(data.refund_total), testid: "rep-returns-total" },
      { label: t("returnsTitle"), value: data.count, testid: "rep-returns-count" },
    ];
    if (activeType === "expenses") return [
      { label: t("grandTotal"), value: fmtMoney(data.total), testid: "rep-expenses-total" },
      { label: t("expensesTitle"), value: data.count, testid: "rep-expenses-count" },
    ];
    if (activeType === "inventory") {
      const cards = [
        { label: t("productsTitle"), value: data.count, testid: "rep-inv-count" },
        { label: t("lowStockTitle"), value: data.low_count, testid: "rep-inv-low" },
      ];
      if (data.inventory_value !== undefined) cards.push({ label: t("inventoryValue"), value: fmtMoney(data.inventory_value), testid: "rep-inv-value" });
      return cards;
    }
    if (activeType === "cash") return [{ label: t("cashBalance"), value: fmtMoney(data.balance), testid: "rep-cash-balance" }];
    return [];
  }, [data, activeType, t]);

  return (
    <div className="space-y-6 fade-up" data-testid="reports-page">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("reportsTitle")}</h1>

      <div className="flex flex-wrap gap-2" data-testid="report-type-tabs">
        {available.map((r) => (
          <button key={r.key} data-testid={`report-tab-${r.key}`} onClick={() => setType(r.key)}
            className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors inline-flex items-center gap-1.5 ${
              activeType === r.key ? "bg-emerald-500 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}>
            {r.premium && <Crown className={`w-3.5 h-3.5 ${activeType === r.key ? "text-amber-200" : "text-amber-500"}`} />}
            {t(r.label)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="report-range-bar">
        {RANGES.map((r) => (
          <button key={r.key} data-testid={`range-${r.key}`} onClick={() => setRange(r.key)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
              range === r.key ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}>
            {t(r.label)}
          </button>
        ))}
        {range === "custom" && (
          <div className="flex flex-wrap items-end gap-2" data-testid="range-custom-bar">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">{t("fromLabel")}</label>
              <input data-testid="range-custom-from" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={`${inputCls} tabular`} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">{t("toLabel")}</label>
              <input data-testid="range-custom-to" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={`${inputCls} tabular`} />
            </div>
            <button data-testid="range-custom-apply" onClick={applyCustom}
              className="px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors">
              {t("viewReport")}
            </button>
          </div>
        )}
      </div>

      {premiumLocked ? (
        <PremiumLock testid="premium-lock-reports" />
      ) : loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" /></div>
      ) : pinLocked ? (
        <PinGate testid="reports-pin-gate" onSuccess={() => { setPinLocked(false); load(); }} />
      ) : !data ? (
        <p className="text-sm text-slate-400" data-testid="report-empty">{t("noResults")}</p>
      ) : activeType === "profit" ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="report-profit">
          {[
            { label: t("revenueLabel"), value: fmtMoney(data.revenue), testid: "rep-profit-revenue" },
            { label: t("refundsLabel"), value: `-${fmtMoney(data.refunds)}`, testid: "rep-profit-refunds", tone: "text-red-600" },
            { label: t("netRevenue"), value: fmtMoney(data.net_revenue), testid: "rep-profit-net-revenue" },
            { label: t("cogsLabel"), value: fmtMoney(data.cogs), testid: "rep-profit-cogs" },
            { label: t("grossProfitLabel"), value: fmtMoney(data.gross_profit), testid: "rep-profit-gross", tone: data.gross_profit < 0 ? "text-red-600" : "text-emerald-600" },
            { label: t("grossMarginLabel"), value: fmtPct(data.gross_margin), testid: "rep-profit-gross-margin" },
            { label: t("opExpenses"), value: fmtMoney(data.operating_expenses), testid: "rep-profit-opex" },
            { label: t("netProfit"), value: fmtMoney(data.net_profit), testid: "rep-profit-net", tone: data.net_profit < 0 ? "text-red-600" : "text-emerald-600", strong: true },
          ].map((c) => (
            <div key={c.testid} className={`bg-white rounded-xl border p-5 shadow-sm ${c.strong ? "border-emerald-200 ring-1 ring-emerald-100" : "border-slate-200"}`} data-testid={c.testid}>
              <p className="text-xs text-slate-500 font-medium mb-2">{c.label}</p>
              <p className={`text-xl font-bold tabular ${c.tone || "text-slate-900"}`}>{c.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {summaryCards.map((c) => (
              <div key={c.testid} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm" data-testid={c.testid}>
                <p className="text-xs text-slate-500 font-medium mb-2">{c.label}</p>
                <p className="text-xl font-bold text-slate-900 tabular">{c.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto" data-testid="report-table">
            {activeType === "sales" && (
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="border-b border-slate-100">
                  <th className={head}>{t("saleNumber")}</th><th className={head}>{t("dateLabel")}</th><th className={head}>{t("customer")}</th><th className={head}>{t("grandTotal")}</th>
                  {fin && <th className={head}>{t("profitLabel")}</th>}
                </tr></thead>
                <tbody>
                  {data.rows.map((s) => (
                    <tr key={s.sale_id} className="border-b border-slate-50">
                      <td className={`${cell} font-semibold tabular`}>{s.sale_number}</td>
                      <td className={cell}>{fmtDateTime(s.date, lang)}</td>
                      <td className={cell}>{s.customer || "—"}</td>
                      <td className={`${cell} tabular font-semibold`}>{fmtMoney(s.total)}</td>
                      {fin && <td className={`${cell} tabular ${s.profit < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmtMoney(s.profit)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {activeType === "purchases" && (
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="border-b border-slate-100">
                  <th className={head}>{t("purchaseNumber")}</th><th className={head}>{t("supplier")}</th><th className={head}>{t("purchaseDate")}</th><th className={head}>{t("grandTotal")}</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((p) => (
                    <tr key={p.purchase_id} className="border-b border-slate-50">
                      <td className={`${cell} font-semibold tabular`}>{p.purchase_number}</td>
                      <td className={cell}>{p.supplier}</td>
                      <td className={cell}>{p.purchase_date}</td>
                      <td className={`${cell} tabular font-semibold`}>{fmtMoney(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {activeType === "inventory" && (
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="border-b border-slate-100">
                  <th className={head}>{t("thProduct")}</th><th className={head}>{t("currentStock")}</th><th className={head}>{t("minStockLabel")}</th><th className={head}>{t("stockStatus")}</th>
                  {fin && <th className={head}>{t("inventoryValue")}</th>}
                </tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.product_id} className="border-b border-slate-50">
                      <td className={`${cell} font-medium`}>{r.name}</td>
                      <td className={`${cell} tabular`}>{r.stock_qty}</td>
                      <td className={`${cell} tabular`}>{r.minimum_stock_level}</td>
                      <td className={cell}>{t(r.status === "ok" ? "stOk" : r.status === "low" ? "stLow" : "stOut")}</td>
                      {fin && <td className={`${cell} tabular`}>{fmtMoney(r.stock_value || 0)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {activeType === "returns" && (
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="border-b border-slate-100">
                  <th className={head}>{t("returnNumber")}</th><th className={head}>{t("dateLabel")}</th><th className={head}>{t("saleNumber")}</th><th className={head}>{t("refundTotalLabel")}</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.return_id} className="border-b border-slate-50">
                      <td className={`${cell} font-semibold tabular`}>{r.return_number}</td>
                      <td className={cell}>{fmtDateTime(r.return_date, lang)}</td>
                      <td className={`${cell} tabular`}>{r.sale_number || "—"}</td>
                      <td className={`${cell} tabular text-red-600`}>{fmtMoney(r.refund_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {activeType === "expenses" && (
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="border-b border-slate-100">
                  <th className={head}>{t("dateLabel")}</th><th className={head}>{t("categoryLabel")}</th><th className={head}>{t("descriptionLabel")}</th><th className={head}>{t("amountLabel")}</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((e) => (
                    <tr key={e.expense_id} className="border-b border-slate-50">
                      <td className={cell}>{e.date}</td>
                      <td className={cell}>{t(`cat_${e.category}`)}</td>
                      <td className={cell}>{e.description || "—"}</td>
                      <td className={`${cell} tabular font-semibold`}>{fmtMoney(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {activeType === "cash" && (
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="border-b border-slate-100">
                  <th className={head}>{t("dateLabel")}</th><th className={head}>{t("expectedCash")}</th><th className={head}>{t("actualCash")}</th><th className={head}>{t("differenceLabel")}</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((c) => (
                    <tr key={c.closing_id} className="border-b border-slate-50">
                      <td className={cell}>{fmtDateTime(c.date, lang)}</td>
                      <td className={`${cell} tabular`}>{fmtMoney(c.expected)}</td>
                      <td className={`${cell} tabular`}>{fmtMoney(c.actual)}</td>
                      <td className={`${cell} tabular font-semibold ${c.difference === 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtMoney(c.difference)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(data.rows || []).length === 0 && activeType !== "inventory" && (
              <p className="text-sm text-slate-400 text-center py-12">{t("noResults")}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
