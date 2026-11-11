import { useCallback, useEffect, useState } from "react";
import { Wallet, Loader2, Banknote, ArrowDownToLine, Plus } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError, isPinRequired } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fmtMoney, num } from "../lib/calculations";
import { fmtDateTime } from "./Sales";
import PinGate from "../components/PinGate";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";

export default function Cash() {
  const { t, lang } = useLanguage();
  const { can } = useAuth();
  const [summary, setSummary] = useState(null);
  const [closings, setClosings] = useState([]);
  const [pinLocked, setPinLocked] = useState(false);
  const [actual, setActual] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [savingClosing, setSavingClosing] = useState(false);
  const [wdOpen, setWdOpen] = useState(false);
  const [wdForm, setWdForm] = useState({ person: "", amount: "", reason: "", source: "cash", notes: "" });
  const [savingWd, setSavingWd] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data: s }, { data: c }] = await Promise.all([
        api.get("/cash/summary"),
        api.get("/cash/closings"),
      ]);
      setSummary(s);
      setClosings(c);
      setPinLocked(false);
    } catch (err) {
      if (isPinRequired(err)) {
        setPinLocked(true);
      } else {
        toast.error(t("somethingWrong"));
      }
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const diff = actual !== "" ? num(actual) - (summary?.balance || 0) : null;

  const submitClosing = async (e) => {
    e.preventDefault();
    setSavingClosing(true);
    try {
      await api.post("/cash/closing", { actual_cash: num(actual), notes: closingNotes });
      toast.success(t("closingSaved"));
      setActual("");
      setClosingNotes("");
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSavingClosing(false);
    }
  };

  const submitWithdrawal = async (e) => {
    e.preventDefault();
    setSavingWd(true);
    try {
      await api.post("/withdrawals", { ...wdForm, amount: num(wdForm.amount) });
      toast.success(t("withdrawalCreated"));
      setWdOpen(false);
      setWdForm({ person: "", amount: "", reason: "", source: "cash", notes: "" });
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSavingWd(false);
    }
  };

  if (pinLocked) {
    return <PinGate testid="cash-pin-gate" onSuccess={() => { setPinLocked(false); load(); }} />;
  }

  if (!summary) {
    return <div className="flex items-center justify-center py-24"><div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" /></div>;
  }

  const cards = [
    { label: t("openingBalance"), value: summary.opening, icon: Wallet, testid: "cash-opening" },
    { label: t("cashSalesLabel"), value: summary.cash_sales, icon: Banknote, testid: "cash-sales" },
    { label: t("cashRefundsLabel"), value: -summary.cash_refunds, icon: Banknote, testid: "cash-refunds" },
    { label: t("cashExpensesLabel"), value: -summary.cash_expenses, icon: Banknote, testid: "cash-expenses" },
    { label: t("cashWithdrawalsLabel"), value: -summary.cash_withdrawals, icon: ArrowDownToLine, testid: "cash-withdrawals" },
  ];

  return (
    <div className="space-y-6 fade-up" data-testid="cash-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("cashTitle")}</h1>
        {can("withdrawals.manage") && (
          <button onClick={() => setWdOpen(true)} data-testid="new-withdrawal-btn"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors">
            <Plus className="w-4 h-4" /> {t("newWithdrawal")}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {cards.map((c) => (
          <div key={c.testid} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm" data-testid={c.testid}>
            <p className="text-xs text-slate-500 font-medium mb-1.5">{c.label}</p>
            <p className={`text-lg font-bold tabular ${c.value < 0 ? "text-red-600" : "text-slate-900"}`}>{fmtMoney(c.value)}</p>
          </div>
        ))}
        <div className="bg-emerald-500 rounded-xl p-4 shadow-sm" data-testid="cash-balance">
          <p className="text-xs text-emerald-100 font-medium mb-1.5">{t("cashBalance")}</p>
          <p className="text-lg font-extrabold text-white tabular">{fmtMoney(summary.balance)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {can("cash.close") && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6" data-testid="closing-card">
            <h3 className="font-bold text-slate-900 mb-4">{t("dailyClosing")}</h3>
            <form onSubmit={submitClosing} className="space-y-4" data-testid="closing-form">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                <span className="text-sm text-slate-500">{t("expectedCash")}</span>
                <span className="font-bold text-slate-900 tabular" data-testid="closing-expected">{fmtMoney(summary.balance)}</span>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("actualCash")}</label>
                <input data-testid="closing-actual-input" type="number" min="0" step="0.01" required value={actual}
                  onChange={(e) => setActual(e.target.value)} className={`${inputCls} tabular`} />
              </div>
              {diff !== null && (
                <div className={`flex items-center justify-between rounded-lg px-4 py-3 border ${diff === 0 ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`} data-testid="closing-diff">
                  <span className="text-sm text-slate-600">{t("differenceLabel")}</span>
                  <span className={`font-bold tabular ${diff === 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {diff > 0 ? "+" : ""}{fmtMoney(diff)}
                  </span>
                </div>
              )}
              <input data-testid="closing-notes-input" value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} placeholder={t("notesLabel")} className={inputCls} />
              <button data-testid="closing-submit-btn" type="submit" disabled={savingClosing || actual === ""}
                className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {savingClosing && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("dailyClosing")}
              </button>
            </form>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6" data-testid="closings-card">
          <h3 className="font-bold text-slate-900 mb-4">{t("closingsHistory")}</h3>
          {closings.length === 0 ? (
            <p className="text-sm text-slate-400">{t("noClosings")}</p>
          ) : (
            <ul className="space-y-3 max-h-80 overflow-y-auto">
              {closings.map((c) => (
                <li key={c.closing_id} className="flex items-center justify-between gap-3 border-b border-slate-50 pb-3" data-testid={`closing-${c.closing_id}`}>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{fmtDateTime(c.date, lang)}</p>
                    <p className="text-xs text-slate-400">{c.created_by_name}</p>
                  </div>
                  <div className="text-end">
                    <p className="text-sm tabular text-slate-700">{fmtMoney(c.actual)} / {fmtMoney(c.expected)}</p>
                    <p className={`text-xs font-bold tabular ${c.difference === 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {c.difference > 0 ? "+" : ""}{fmtMoney(c.difference)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {can("withdrawals.view") && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6" data-testid="withdrawals-card">
          <h3 className="font-bold text-slate-900 mb-4">{t("withdrawalsTitle")}</h3>
          {(summary.withdrawals || []).length === 0 ? (
            <p className="text-sm text-slate-400">{t("noWithdrawals")}</p>
          ) : (
            <ul className="space-y-3">
              {summary.withdrawals.map((w) => (
                <li key={w.withdrawal_id} className="flex items-center justify-between gap-3 border-b border-slate-50 pb-3" data-testid={`withdrawal-${w.withdrawal_id}`}>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{w.person}</p>
                    <p className="text-xs text-slate-400">{w.reason || w.notes || "—"} · {w.source === "cash" ? t("srcCash") : t("srcBank")} · {w.date}</p>
                  </div>
                  <p className="text-sm font-bold tabular text-red-600">-{fmtMoney(w.amount)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog open={wdOpen} onOpenChange={setWdOpen}>
        <DialogContent data-testid="withdrawal-dialog">
          <DialogHeader>
            <DialogTitle>{t("newWithdrawal")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitWithdrawal} className="space-y-4" data-testid="withdrawal-form">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("personLabel")} *</label>
                <input data-testid="withdrawal-person-input" required value={wdForm.person} onChange={(e) => setWdForm((f) => ({ ...f, person: e.target.value }))} placeholder={t("personPh")} className={inputCls} />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("amountLabel")} *</label>
                <input data-testid="withdrawal-amount-input" type="number" min="0.01" step="0.01" required value={wdForm.amount} onChange={(e) => setWdForm((f) => ({ ...f, amount: e.target.value }))} className={`${inputCls} tabular`} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("reasonLabel")}</label>
                <input data-testid="withdrawal-reason-input" value={wdForm.reason} onChange={(e) => setWdForm((f) => ({ ...f, reason: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("sourceLabel")}</label>
                <select data-testid="withdrawal-source-select" value={wdForm.source} onChange={(e) => setWdForm((f) => ({ ...f, source: e.target.value }))} className={inputCls}>
                  <option value="cash">{t("srcCash")}</option>
                  <option value="bank">{t("srcBank")}</option>
                </select>
              </div>
            </div>
            <button data-testid="withdrawal-submit-btn" type="submit" disabled={savingWd || !wdForm.person || !wdForm.amount}
              className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {savingWd && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("newWithdrawal")}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
