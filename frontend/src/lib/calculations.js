import { getRegionalPrefs, NUMBER_LOCALES } from "./locale";

export function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function computeMetrics(p) {
  const qty = num(p.quantity_sold);
  const price = num(p.selling_price);
  const productCost = num(p.product_cost);
  const optUnit = (field, modeField) => {
    const v = num(p[field]);
    return p[modeField] === "total" ? (qty > 0 ? v / qty : 0) : v;
  };
  const shipping = optUnit("shipping_cost", "shipping_cost_mode");
  const advertising = optUnit("advertising_cost", "advertising_cost_mode");
  const paymentFee = optUnit("payment_fee", "payment_fee_mode");
  const other = optUnit("other_costs", "other_costs_mode");
  const discV = num(p.discount);
  const discount = p.discount_mode === "percent" ? (price * discV) / 100 : discV;
  const unitCost = productCost + shipping + advertising + paymentFee + discount + other;
  const revenue = price * qty;
  const totalCosts = unitCost * qty;
  const netProfit = revenue - totalCosts;
  const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
  return {
    unitCost,
    unitProfit: price - unitCost,
    revenue,
    totalCosts,
    netProfit,
    margin,
    breakdown: { product_cost: productCost, shipping, advertising, payment_fee: paymentFee, discount, other },
  };
}

let CURRENT_CURRENCY = "USD";

export function setCurrency(c) {
  if (c) CURRENT_CURRENCY = c;
}

export function fmtMoney(n, currency) {
  const cur = currency || CURRENT_CURRENCY;
  const nfLocale = NUMBER_LOCALES[getRegionalPrefs().number_format] || "en-US";
  try {
    return new Intl.NumberFormat(nfLocale, {
      style: "currency",
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(n) ? n : 0);
  } catch {
    return `${cur} ${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
  }
}

export function fmtPct(n) {
  return `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
}

export function marginTone(margin) {
  if (margin < 0) return "danger";
  if (margin < 10) return "warning";
  if (margin >= 40) return "success";
  return "neutral";
}

export function buildInsights(products) {
  const insights = [];
  const avgQty = products.length
    ? products.reduce((s, p) => s + p.quantity_sold, 0) / products.length
    : 0;
  for (const p of products) {
    if (p.profit_margin == null || p.profit_margin === undefined) continue;
    if (p.profit_margin < 0) {
      insights.push({ level: "danger", key: "insightNegative", name: p.name });
    } else if (p.profit_margin < 10) {
      insights.push({ level: "warning", key: "insightLow", name: p.name });
    } else if (p.profit_margin > 40) {
      insights.push({ level: "success", key: "insightStrong", name: p.name });
    }
    if (p.quantity_sold >= avgQty && p.quantity_sold > 0 && p.profit_margin >= 0 && p.profit_margin < 15) {
      insights.push({ level: "info", key: "insightVolume", name: p.name });
    }
  }
  const order = { danger: 0, warning: 1, info: 2, success: 3 };
  return insights.sort((a, b) => order[a.level] - order[b.level]).slice(0, 8);
}
