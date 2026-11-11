import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  Crown, Calendar, Clock, CheckCircle2, XCircle, Loader2, AlertTriangle,
  RefreshCw, Receipt, ShieldCheck, CalendarX2, Headphones, Zap, Check, MessageCircle, Mail,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { PayPalSubscribeButton } from "../components/PayPalSubscribeButton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";

const HERO_BG = "https://images.unsplash.com/photo-1709377195538-5522ed0f9e10?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwyfHxhYnN0cmFjdCUyMGRhcmslMjBnb2xkJTIwYmFja2dyb3VuZCUyMHNhYXN8ZW58MHx8fHwxNzg5NTU2NTczfDA&ixlib=rb-4.1.0&q=85";

const STATE_STYLE = {
  active: { cls: "bg-teal-500/15 text-teal-300 border border-teal-500/30", icon: CheckCircle2 },
  trial: { cls: "bg-amber-500/15 text-amber-300 border border-amber-500/30", icon: Clock },
  pending_payment: { cls: "bg-sky-500/15 text-sky-300 border border-sky-500/30", icon: Loader2 },
  past_due: { cls: "bg-orange-500/15 text-orange-300 border border-orange-500/30", icon: AlertTriangle },
  cancellation_scheduled: { cls: "bg-amber-500/15 text-amber-300 border border-amber-500/30", icon: Calendar },
  free: { cls: "bg-slate-500/15 text-slate-300 border border-slate-500/30", icon: XCircle },
  expired: { cls: "bg-red-500/15 text-red-300 border border-red-500/30", icon: XCircle },
  unverified: { cls: "bg-red-500/15 text-red-300 border border-red-500/30", icon: AlertTriangle },
};

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : "—");

const tileCls = "rounded-xl bg-slate-800/40 border border-slate-800 p-4";
const tileLabel = "flex items-center gap-2 text-slate-400 text-xs mb-1";
const tileValue = "text-sm font-semibold text-slate-100 tabular";

export default function Subscription() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [sub, setSub] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [busy, setBusy] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(() => {
    if (!user || user.role !== "OWNER") return;
    setLoading(true);
    Promise.all([
      api.get("/subscription"),
      api.get("/subscription/payments").catch(() => ({ data: [] })),
    ])
      .then(([s, p]) => { setSub(s.data); setPayments(p.data); })
      .catch((err) => toast.error(formatApiError(err, t("somethingWrong"))))
      .finally(() => setLoading(false));
  }, [user, t]);

  useEffect(() => { load(); }, [load]);

  if (user && user.role !== "OWNER") return <Navigate to="/dashboard" replace />;

  const subError = (err) => {
    const detail = err?.response?.data?.detail;
    return typeof detail === "string" && detail.includes("SUBSCRIPTION_NOT_LINKED")
      ? t("subNotLinkedMsg")
      : formatApiError(err, t("somethingWrong"));
  };

  const activate = async (plan, paypalSubscriptionId) => {
    setActivating(true);
    try {
      const { data } = await api.post("/subscription/activate", { plan, paypal_subscription_id: paypalSubscriptionId });
      setSub((s) => ({ ...s, ...data }));
      if (data.status === "active") {
        toast.success(t("subActivated"));
      } else {
        toast.info(t("subPendingDesc"));
      }
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setActivating(false);
    }
  };

  const doCancel = async () => {
    setConfirmCancel(false);
    setBusy("cancel");
    try {
      const { data } = await api.post("/subscription/cancel");
      setSub((s) => ({ ...s, ...data }));
      toast.success(t("subCancelScheduled"));
      load();
    } catch (err) {
      toast.error(subError(err));
    } finally {
      setBusy(null);
    }
  };

  const doReactivate = async () => {
    setBusy("reactivate");
    try {
      const { data } = await api.post("/subscription/reactivate");
      setSub((s) => ({ ...s, ...data }));
      toast.success(t("subReactivated"));
      load();
    } catch (err) {
      toast.error(subError(err));
    } finally {
      setBusy(null);
    }
  };

  const badge = (status) => {
    const s = STATE_STYLE[status] || STATE_STYLE.free;
    const Icon = s.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold ${s.cls}`} data-testid="sub-status-badge">
        <Icon className="w-3.5 h-3.5" /><span>{t(`subState_${status}`)}</span>
      </span>
    );
  };

  const lastPayment = payments[0] || null;
  const isPaid = ["active", "past_due", "cancellation_scheduled", "pending_payment"].includes(sub?.status);
  const isCurrentPlan = (p) => isPaid && sub?.plan === p;

  const planFeatures = [t("premF1"), t("premF2"), t("premF5"), t("premF6")];
  const compareRows = [
    { label: t("compAI"), monthly: true, yearly: true },
    { label: t("compInsights"), monthly: true, yearly: true },
    { label: t("compProfit"), monthly: true, yearly: true },
    { label: t("compReports"), monthly: true, yearly: true },
  ];
  const trustItems = [
    { icon: ShieldCheck, label: t("trustSecure"), tid: "trust-secure" },
    { icon: CalendarX2, label: t("trustCancel"), tid: "trust-cancel" },
    { icon: Headphones, label: t("trustSupport"), tid: "trust-support" },
    { icon: Zap, label: t("trustSetup"), tid: "trust-setup" },
  ];

  return (
    <div className="dark relative bg-slate-950 text-slate-50 -mx-4 md:-mx-8 -my-6 md:-my-8 px-4 sm:px-6 lg:px-8 py-14 min-h-screen overflow-hidden rounded-2xl border border-slate-800/60" data-testid="subscription-page">
      <img src={HERO_BG} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-5 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      <div className="relative animate-in fade-in duration-500">
        {/* Hero */}
        <div className="text-center mb-14 space-y-5 flex flex-col items-center">
          <span className="inline-flex items-center px-4 py-1.5 rounded-full text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20" data-testid="hero-badge">
            {t("heroBadge")}
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white" data-testid="subscription-title">{t("heroTitle")}</h1>
          <p className="text-base text-slate-400 max-w-xl leading-relaxed" data-testid="hero-subtitle">{t("heroSubtitle")}</p>
        </div>

        {loading ? (
          <div className="max-w-4xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>
        ) : sub ? (
          <>
            {/* Status card */}
            <div className="max-w-4xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl shadow-amber-900/5" data-testid="sub-status-card">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2"><Crown className="w-5 h-5 text-amber-400" /> {t("subStatus")}</h2>
                {badge(sub.status)}
              </div>

              {isPaid ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className={tileCls}>
                    <div className={tileLabel}><Crown className="w-3.5 h-3.5" /> {t("subPlan")}</div>
                    <p className={`${tileValue} text-base`} data-testid="sub-plan-name">
                      {t(sub.plan === "yearly" ? "planYearly" : "planMonthly")} · <span className="tabular">${sub.price}</span>
                    </p>
                  </div>
                  <div className={tileCls}>
                    <div className={tileLabel}><Calendar className="w-3.5 h-3.5" /> {sub.cancel_at_period_end ? t("subEndsOn") : t("subNextRenewal")}</div>
                    <p className={tileValue} data-testid="sub-period-end">{fmtDate(sub.cancel_at_period_end ? sub.current_period_end : (sub.next_renewal_date || sub.current_period_end))}</p>
                  </div>
                  <div className={tileCls}>
                    <div className={tileLabel}><Clock className="w-3.5 h-3.5" /> {t("subCurrentPeriod")}</div>
                    <p className={tileValue} data-testid="sub-period-start">{fmtDate(sub.current_period_start)} — {fmtDate(sub.current_period_end)}</p>
                  </div>
                  <div className={tileCls}>
                    <div className={tileLabel}><Receipt className="w-3.5 h-3.5" /> {t("subPaymentStatus")}</div>
                    <p className={tileValue} data-testid="sub-last-payment">{lastPayment ? t(`pay_${String(lastPayment.status).toLowerCase()}`) : "—"}</p>
                  </div>
                  <div className={tileCls}>
                    <div className={tileLabel}><Calendar className="w-3.5 h-3.5" /> {t("subStartDate")}</div>
                    <p className={tileValue} data-testid="sub-start-date">{fmtDate(sub.subscribed_at || sub.current_period_start)}</p>
                  </div>
                  <div className={tileCls}>
                    <div className={tileLabel}><RefreshCw className="w-3.5 h-3.5" /> {t("subBillingInterval")}</div>
                    <p className={tileValue} data-testid="sub-billing-interval">{t(sub.billing_interval === "year" ? "subIntervalYear" : "subIntervalMonth")}</p>
                  </div>
                  <div className={tileCls}>
                    <div className={tileLabel}><CheckCircle2 className="w-3.5 h-3.5" /> {t("subAutoRenew")}</div>
                    <p className={`${tileValue} ${sub.auto_renew ? "text-teal-300" : "text-slate-400"}`} data-testid="sub-auto-renew">{t(sub.auto_renew ? "subAutoOn" : "subAutoOff")}</p>
                  </div>
                  <div className={tileCls}>
                    <div className={tileLabel}><ShieldCheck className="w-3.5 h-3.5" /> {t("subPaypalId")}</div>
                    <p className={tileValue} dir="ltr" data-testid="sub-paypal-id">{sub.paypal_subscription_id || "—"}</p>
                  </div>
                </div>
              ) : sub.status === "unverified" ? (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 flex items-start gap-3" data-testid="sub-unverified-note">
                  <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-red-300 mb-1">{t("subState_unverified")}</p>
                    <p className="text-xs text-red-300/80">{t("subUnverifiedDesc")}</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className={tileCls}>
                    <div className={tileLabel}><Calendar className="w-3.5 h-3.5" /> {t("subTrialEnds")}</div>
                    <p className={`${tileValue} text-base`} data-testid="sub-trial-ends">{fmtDate(sub.trial_ends_at)}</p>
                  </div>
                  <div className={tileCls}>
                    <div className={tileLabel}><Clock className="w-3.5 h-3.5" /> {t("subDaysRemaining")}</div>
                    <p className={`${tileValue} text-base`} data-testid="sub-days-remaining">{`${sub.trial_days_remaining} / ${sub.trial_days_total}`}</p>
                  </div>
                </div>
              )}

              {sub.status === "trial" && (
                <div className="mt-5 h-2 rounded-full bg-slate-800 overflow-hidden" data-testid="sub-trial-progress">
                  <div className="h-full bg-amber-500 transition-all" style={{ width: `${Math.round((sub.trial_days_remaining / sub.trial_days_total) * 100)}%` }} />
                </div>
              )}
              {sub.status === "cancellation_scheduled" && (
                <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mt-5" data-testid="sub-cancel-scheduled-note">
                  {t("subCancelledNote", { date: fmtDate(sub.current_period_end) })}
                </p>
              )}
              {sub.status === "past_due" && (
                <p className="text-xs text-orange-300 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2 mt-5" data-testid="sub-past-due-note">{t("subPastDueDesc")}</p>
              )}
              {sub.status === "active" && sub.subscribed_at && (
                <p className="text-xs text-slate-500 mt-5">{t("subActiveSince")}: {fmtDate(sub.subscribed_at)}</p>
              )}

              {(sub.status === "active" || sub.status === "past_due") && (
                <div className="mt-6 pt-5 border-t border-slate-800">
                  <button
                    data-testid="sub-cancel-btn"
                    onClick={() => setConfirmCancel(true)}
                    disabled={!!busy}
                    className="px-4 py-2.5 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm font-semibold transition-colors active:scale-95 disabled:opacity-60 flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-slate-900"
                  >
                    {busy === "cancel" && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t("subCancelBtn")}
                  </button>
                </div>
              )}
              {sub.status === "cancellation_scheduled" && (
                <div className="mt-6 pt-5 border-t border-slate-800">
                  <button
                    data-testid="sub-reactivate-btn"
                    onClick={doReactivate}
                    disabled={!!busy}
                    className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold transition-colors active:scale-95 disabled:opacity-60 flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 focus:ring-offset-slate-900"
                  >
                    {busy === "reactivate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    {t("subReactivate")}
                  </button>
                </div>
              )}
              {sub.status === "pending_payment" && (
                <div className="mt-6 pt-5 border-t border-slate-800 flex items-center gap-3" data-testid="sub-pending-card">
                  <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                  <p className="text-sm text-slate-400 flex-1">{t("subPendingDesc")}</p>
                  <button data-testid="sub-refresh-btn" onClick={load} className="px-3 py-2 rounded-lg border border-slate-700 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors">
                    {t("subRefresh")}
                  </button>
                </div>
              )}
            </div>

            {/* Pricing cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto mt-14" data-testid="sub-plan-card">
              {/* Monthly */}
              <section aria-labelledby="plan-monthly-title" className={`rounded-2xl border bg-slate-900 p-7 flex flex-col transition-transform duration-300 hover:-translate-y-1 ${isCurrentPlan("monthly") ? "border-teal-500/50 shadow-[0_0_30px_-5px_rgba(13,148,136,0.25)]" : "border-slate-800"}`} data-testid="plan-monthly">
                <div className="flex items-center justify-between mb-2">
                  <h3 id="plan-monthly-title" className="text-lg font-bold text-white">{t("planMonthly")}</h3>
                  {isCurrentPlan("monthly") && (
                    <span className="px-3 py-1 rounded-full bg-teal-500/15 text-teal-300 border border-teal-500/30 text-xs font-bold" data-testid="current-plan-monthly">{t("subCurrentPlan")}</span>
                  )}
                </div>
                <p className="text-sm text-slate-400 mb-5">{t("monthlyDesc")}</p>
                <p className="mb-6"><span className="text-4xl font-extrabold text-white tabular">$29</span> <span className="text-sm text-slate-400">{t("perMonth")}</span></p>
                <ul className="space-y-2.5 mb-7 flex-1">
                  {planFeatures.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-slate-300"><Check className="w-4 h-4 text-teal-400 shrink-0" /> {f}</li>
                  ))}
                </ul>
                {isCurrentPlan("monthly") ? null : sub.paypal_ready && sub.plans?.monthly?.plan_id ? (
                  activating ? (
                    <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-400" data-testid="sub-activating">
                      <Loader2 className="w-4 h-4 animate-spin" /> {t("subPendingTitle")}
                    </div>
                  ) : (
                    <>
                      <PayPalSubscribeButton planId={sub.plans.monthly.plan_id} testid="paypal-monthly-btn" onApproved={(subId) => activate("monthly", subId)} />
                      {isPaid && <p className="text-[11px] text-amber-400/90 mt-3 text-center" data-testid="switch-note-monthly">{t("subSwitchNote")}</p>}
                    </>
                  )
                ) : (
                  <p className="text-xs text-slate-500 text-center py-2" data-testid="paypal-not-ready">{t("subPaypalUnavailable")}</p>
                )}
              </section>

              {/* Annual */}
              <section aria-labelledby="plan-yearly-title" className={`relative rounded-2xl border bg-slate-900 p-7 flex flex-col transition-transform duration-300 hover:-translate-y-1 before:absolute before:inset-0 before:-z-10 before:bg-gradient-to-br before:from-amber-500/10 before:to-transparent before:blur-xl before:rounded-3xl ${isCurrentPlan("yearly") ? "border-teal-500/50 shadow-[0_0_30px_-5px_rgba(13,148,136,0.25)]" : "border-amber-500/50 shadow-[0_0_30px_-5px_rgba(245,158,11,0.2)]"}`} data-testid="plan-yearly">
                <div className="flex items-center justify-between mb-2">
                  <h3 id="plan-yearly-title" className="text-lg font-bold text-white">{t("planYearly")}</h3>
                  <div className="flex items-center gap-2">
                    {isCurrentPlan("yearly") && (
                      <span className="px-3 py-1 rounded-full bg-teal-500/15 text-teal-300 border border-teal-500/30 text-xs font-bold" data-testid="current-plan-yearly">{t("subCurrentPlan")}</span>
                    )}
                    <span className="px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs font-bold" data-testid="yearly-best-value">{t("bestSaver")}</span>
                  </div>
                </div>
                <p className="mb-5">
                  <span className="text-4xl font-extrabold text-white tabular">$99</span>{" "}
                  <span className="text-lg font-semibold text-slate-500 line-through tabular">$299</span>{" "}
                  <span className="inline-block px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 text-xs font-bold align-middle" data-testid="yearly-save-badge">{t("saveUpTo")}</span>
                </p>
                <p className="text-xs text-slate-400 mb-6">{t("annualFirstYear")}</p>
                <ul className="space-y-2.5 mb-7 flex-1">
                  {planFeatures.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-slate-300"><Check className="w-4 h-4 text-amber-400 shrink-0" /> {f}</li>
                  ))}
                </ul>
                {isCurrentPlan("yearly") ? null : sub.paypal_ready && sub.plans?.yearly?.available ? (
                  <div>
                    <PayPalSubscribeButton planId={sub.plans.yearly.plan_id} testid="paypal-yearly-btn" onApproved={(subId) => activate("yearly", subId)} />
                    {isPaid && <p className="text-[11px] text-amber-400/90 mt-3 text-center" data-testid="switch-note-yearly">{t("subSwitchNote")}</p>}
                  </div>
                ) : (
                  <span className="block text-center px-3 py-2.5 rounded-xl bg-slate-800 text-slate-400 text-xs font-bold" data-testid="yearly-coming-soon">{t("yearlyComingSoon")}</span>
                )}
              </section>
            </div>

            {/* Comparison table */}
            <div className="max-w-4xl mx-auto mt-20 overflow-x-auto">
              <h2 className="text-2xl sm:text-3xl font-semibold text-slate-100 text-center mb-8">{t("compareTitle")}</h2>
              <table className="w-full text-sm border border-slate-800 rounded-2xl overflow-hidden bg-slate-900" data-testid="compare-table">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-400">
                    <th className="text-start py-3.5 px-5 font-medium">{t("colFeature")}</th>
                    <th className="text-center py-3.5 px-5 font-medium">{t("planMonthly")}</th>
                    <th className="text-center py-3.5 px-5 font-medium text-amber-300">{t("planYearly")}</th>
                  </tr>
                </thead>
                <tbody>
                  {compareRows.map((r) => (
                    <tr key={r.label} className="border-b border-slate-800/60">
                      <td className="py-3.5 px-5 text-slate-300">{r.label}</td>
                      <td className="py-3.5 px-5 text-center"><Check className="w-4 h-4 text-teal-400 inline" /></td>
                      <td className="py-3.5 px-5 text-center"><Check className="w-4 h-4 text-teal-400 inline" /></td>
                    </tr>
                  ))}
                  <tr className="border-b border-slate-800/60">
                    <td className="py-3.5 px-5 text-slate-300">{t("compPrice")}</td>
                    <td className="py-3.5 px-5 text-center tabular text-slate-200 font-semibold">{t("compMonthlyPrice")}</td>
                    <td className="py-3.5 px-5 text-center tabular text-amber-300 font-semibold">{t("compAnnualPrice")}</td>
                  </tr>
                  <tr>
                    <td className="py-3.5 px-5 text-slate-300">{t("compSavings")}</td>
                    <td className="py-3.5 px-5 text-center text-slate-500">{t("compSaveNone")}</td>
                    <td className="py-3.5 px-5 text-center text-teal-300 font-bold">{t("compSave67")}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Payment history */}
            <div className="max-w-4xl mx-auto mt-16 bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8" data-testid="sub-history-card">
              <h2 className="text-lg sm:text-xl font-bold text-white mb-5 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-slate-400" /> {t("subHistoryTitle")}
              </h2>
              {payments.length === 0 ? (
                <p className="text-sm text-slate-500" data-testid="sub-history-empty">{t("subHistoryEmpty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 border-b border-slate-800">
                        <th className="text-start py-2 font-medium">{t("colDate")}</th>
                        <th className="text-start py-2 font-medium">{t("subPlan")}</th>
                        <th className="text-start py-2 font-medium">{t("colAmount")}</th>
                        <th className="text-start py-2 font-medium">{t("colStatus")}</th>
                        <th className="text-start py-2 font-medium">{t("subEndsOn")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.payment_id} className="border-b border-slate-800/60" data-testid={`payment-row-${p.payment_id}`}>
                          <td className="py-2.5 tabular text-slate-400">{fmtDate(p.created_at)}</td>
                          <td className="py-2.5 text-slate-300">{t(p.plan === "yearly" ? "planYearly" : "planMonthly")}</td>
                          <td className="py-2.5 tabular text-slate-300">${p.amount}</td>
                          <td className="py-2.5"><span className="text-xs font-semibold text-slate-300">{t(`pay_${String(p.status).toLowerCase()}`)}</span></td>
                          <td className="py-2.5 tabular text-slate-500">{fmtDate(p.period_end)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Trust bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto mt-20" data-testid="trust-bar">
              {trustItems.map(({ icon: Icon, label, tid }) => (
                <div key={tid} className="flex flex-col items-center text-center space-y-3 p-4 text-slate-400 hover:text-slate-200 transition-colors" data-testid={tid}>
                  <div className="w-11 h-11 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-amber-400" />
                  </div>
                  <p className="text-xs font-semibold">{label}</p>
                </div>
              ))}
            </div>

            {/* Help card */}
            <div className="max-w-2xl mx-auto mt-20 bg-gradient-to-r from-slate-900 to-slate-800 border border-slate-700 rounded-2xl p-8 text-center" data-testid="help-card">
              <h2 className="text-xl sm:text-2xl font-semibold text-slate-100 mb-2">{t("helpTitle")}</h2>
              <p className="text-sm text-slate-400 mb-6">{t("helpDesc")}</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3" data-testid="help-cta">
                <a
                  href="https://wa.me/963985566918"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="help-whatsapp-btn"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-bold bg-teal-600 hover:bg-teal-500 text-white transition-colors active:scale-95 shadow-lg shadow-teal-500/20 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 focus:ring-offset-slate-900"
                >
                  <MessageCircle className="w-5 h-5" />
                  <span>{t("whatsappSupport")}</span>
                  <span className="text-xs font-medium opacity-80 tabular" dir="ltr">00963985566918</span>
                </a>
                <a
                  href="mailto:profitlens.team@gmail.com"
                  data-testid="help-email-btn"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors active:scale-95 shadow-lg shadow-amber-500/20 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-900"
                >
                  <Mail className="w-5 h-5" />
                  <span>{t("emailSupport")}</span>
                  <span className="text-xs font-medium opacity-80" dir="ltr">profitlens.team@gmail.com</span>
                </a>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent className="bg-slate-900 border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-100">{t("subCancelTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400" data-testid="sub-cancel-desc">
              {t("subCancelConfirm", { date: fmtDate(sub?.current_period_end) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="sub-cancel-keep" className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700">{t("subCancelKeep")}</AlertDialogCancel>
            <AlertDialogAction data-testid="sub-cancel-confirm" onClick={doCancel} className="bg-red-600 hover:bg-red-500 text-white">
              {t("subCancelConfirmBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
