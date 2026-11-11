import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Handshake, Plus, Loader2, Pencil, AlertTriangle, Landmark, Percent } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError, isPinRequired } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fmtMoney, num } from "../lib/calculations";
import { fmtDateTime } from "./Sales";
import PinGate from "../components/PinGate";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { CURRENCY_OPTIONS } from "../lib/locale";

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";
const EMPTY_FORM = { name: "", ownership_percentage: "", notes: "", paid_in_capital: "", capital_currency: "USD" };
const TXN_TYPES = ["allocation", "withdrawal", "contribution"];
const txnLabel = { allocation: "ttAllocation", withdrawal: "ttWithdrawal", contribution: "ttContribution" };

export default function Partners() {
  const { t, lang } = useLanguage();
  const { can } = useAuth();
  const manage = can("partners.manage");
  const [partners, setPartners] = useState(null);
  const [pinLocked, setPinLocked] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [txnOpen, setTxnOpen] = useState(false);
  const [txnForm, setTxnForm] = useState({ type: "allocation", amount: "", date: "", notes: "" });
  const [savingTxn, setSavingTxn] = useState(false);

  const totalCapital = (partners || []).reduce((s, p) => s + num(p.paid_in_capital || 0), 0);
  const pctTotal = Math.round((partners || []).reduce((s, p) => s + num(p.ownership_percentage || 0), 0) * 100) / 100;
  const pctOk = Math.abs(pctTotal - 100) < 0.005;

  const selectedRef = useRef(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/partners");
      setPartners(data);
      setPinLocked(false);
      const cur = selectedRef.current;
      if (cur) {
        const fresh = await api.get(`/partners/${cur.partner_id}`);
        setSelected(fresh.data);
      }
    } catch (err) {
      if (isPinRequired(err)) {
        setPinLocked(true);
      } else {
        toast.error(t("somethingWrong"));
      }
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const submitAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/partners", {
        name: form.name,
        ownership_percentage: num(form.ownership_percentage),
        notes: form.notes,
        paid_in_capital: num(form.paid_in_capital),
        capital_currency: form.capital_currency,
      });
      toast.success(t("partnerCreated"));
      setAddOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (p) => {
    setEditTarget(p);
    setEditForm({
      name: p.name || "",
      ownership_percentage: p.ownership_percentage ?? "",
      notes: p.notes || "",
      paid_in_capital: p.paid_in_capital ?? "",
      capital_currency: p.capital_currency || "USD",
    });
    setEditOpen(true);
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    setSavingEdit(true);
    try {
      await api.put(`/partners/${editTarget.partner_id}`, {
        name: editForm.name,
        ownership_percentage: num(editForm.ownership_percentage),
        notes: editForm.notes,
        paid_in_capital: num(editForm.paid_in_capital),
        capital_currency: editForm.capital_currency,
      });
      toast.success(t("partnerUpdated"));
      setEditOpen(false);
      setEditTarget(null);
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSavingEdit(false);
    }
  };

  const openPartner = async (p) => {
    try {
      const { data } = await api.get(`/partners/${p.partner_id}`);
      setSelected(data);
    } catch {
      toast.error(t("somethingWrong"));
    }
  };

  const submitTxn = async (e) => {
    e.preventDefault();
    setSavingTxn(true);
    try {
      await api.post(`/partners/${selected.partner_id}/transactions`, {
        ...txnForm,
        amount: num(txnForm.amount),
        date: txnForm.date || null,
      });
      toast.success(t("txnCreated"));
      setTxnOpen(false);
      setTxnForm({ type: "allocation", amount: "", date: "", notes: "" });
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSavingTxn(false);
    }
  };

  return (
    <div className="space-y-6 fade-up" data-testid="partners-page">
      {pinLocked ? (
        <PinGate testid="partners-pin-gate" onSuccess={() => { setPinLocked(false); load(); }} />
      ) : (
        <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("partnersTitle")}</h1>
        {manage && (
          <button onClick={() => setAddOpen(true)} data-testid="add-partner-btn"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors">
            <Plus className="w-4 h-4" /> {t("addPartner")}
          </button>
        )}
      </div>

      {!partners ? (
        <div className="flex items-center justify-center py-20"><div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" /></div>
      ) : partners.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center" data-testid="partners-empty">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <Handshake className="w-7 h-7 text-emerald-500" />
          </div>
          <p className="font-semibold text-slate-800">{t("noPartners")}</p>
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center gap-4" data-testid="total-capital-card">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">{t("totalCapitalLabel")}</p>
              <p className="text-xl font-extrabold tabular text-slate-900" data-testid="total-capital-value">{fmtMoney(totalCapital)}</p>
            </div>
          </div>
          <div className={`rounded-xl border shadow-sm p-5 flex items-center gap-4 ${pctOk ? "bg-white border-slate-200" : "bg-amber-50 border-amber-200"}`} data-testid="pct-status-card">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${pctOk ? "bg-emerald-50" : "bg-amber-100"}`}>
              {pctOk ? <Percent className="w-5 h-5 text-emerald-600" /> : <AlertTriangle className="w-5 h-5 text-amber-600" />}
            </div>
            <div>
              <p className="text-xs text-slate-500">{t("profitShareTotalLabel")}</p>
              <p className={`text-xl font-extrabold tabular ${pctOk ? "text-slate-900" : "text-amber-700"}`} data-testid="pct-total-value">{pctTotal}%</p>
              {!pctOk && <p className="text-xs font-medium text-amber-700 mt-0.5" data-testid="pct-warning">{t("pctWarning")}</p>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="partners-grid">
          {partners.map((p) => (
            <div key={p.partner_id} data-testid={`partner-card-${p.partner_id}`}
              className={`bg-white rounded-xl border p-5 shadow-sm hover:shadow-md transition-all ${selected?.partner_id === p.partner_id ? "border-emerald-300 ring-2 ring-emerald-100" : "border-slate-200"}`}>
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => openPartner(p)} className="font-bold text-slate-900 hover:text-emerald-700 transition-colors text-start" data-testid={`partner-name-${p.partner_id}`}>{p.name}</button>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 tabular" data-testid={`partner-pct-${p.partner_id}`}>{p.ownership_percentage}%</span>
                  {manage && (
                    <button onClick={() => openEdit(p)} data-testid={`partner-edit-${p.partner_id}`}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors" title={t("edit")}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-400 mb-3">{p.notes || "—"}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[11px] text-slate-500">{t("paidCapitalLabel")}</p>
                  <p className="text-sm font-bold tabular text-slate-800" data-testid={`partner-capital-${p.partner_id}`}>{fmtMoney(p.paid_in_capital || 0)} <span className="text-[10px] font-semibold text-slate-400">{p.capital_currency || "USD"}</span></p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[11px] text-slate-500">{t("balanceLabel")}</p>
                  <p className={`text-sm font-bold tabular ${p.balance < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmtMoney(p.balance)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        </>
      )}
      {selected && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6" data-testid="partner-detail">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="font-bold text-slate-900">{selected.name} — {t("transactionsLabel")}</h3>
            {manage && (
              <button onClick={() => setTxnOpen(true)} data-testid="add-partner-txn-btn"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors">
                <Plus className="w-4 h-4" /> {t("addTransaction")}
              </button>
            )}
          </div>
          {(selected.transactions || []).length === 0 ? (
            <p className="text-sm text-slate-400">{t("noTxns")}</p>
          ) : (
            <ul className="space-y-3">
              {selected.transactions.map((txn) => (
                <li key={txn.txn_id} className="flex items-center justify-between gap-3 border-b border-slate-50 pb-3" data-testid={`txn-${txn.txn_id}`}>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{t(txnLabel[txn.type])}</p>
                    <p className="text-xs text-slate-400">{txn.date} · {txn.created_by_name}{txn.notes ? ` · ${txn.notes}` : ""}</p>
                  </div>
                  <p className={`text-sm font-bold tabular ${txn.type === "withdrawal" ? "text-red-600" : "text-emerald-600"}`}>
                    {txn.type === "withdrawal" ? "-" : "+"}{fmtMoney(txn.amount)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="partner-dialog">
          <DialogHeader>
            <DialogTitle>{t("addPartner")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitAdd} className="space-y-4" data-testid="partner-form">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("name")} *</label>
              <input data-testid="partner-name-input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("ownershipLabel")} *</label>
              <input data-testid="partner-ownership-input" type="number" min="0" max="100" step="0.01" required value={form.ownership_percentage} onChange={(e) => setForm((f) => ({ ...f, ownership_percentage: e.target.value }))} className={`${inputCls} tabular`} />
            </div>
            <div className="grid grid-cols-[1fr_90px] gap-3">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("paidCapitalLabel")}</label>
                <input data-testid="partner-capital-input" type="number" min="0" step="0.01" value={form.paid_in_capital} onChange={(e) => setForm((f) => ({ ...f, paid_in_capital: e.target.value }))} className={`${inputCls} tabular`} placeholder="0" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("currencyLabel")}</label>
                <select data-testid="partner-currency-select" value={form.capital_currency} onChange={(e) => setForm((f) => ({ ...f, capital_currency: e.target.value }))} className={`${inputCls} tabular`}>
                  {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("notesLabel")}</label>
              <input data-testid="partner-notes-input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls} />
            </div>
            <button data-testid="partner-save-btn" type="submit" disabled={saving || !form.name || form.ownership_percentage === ""}
              className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("addPartner")}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent data-testid="partner-edit-dialog">
          <DialogHeader>
            <DialogTitle>{t("edit")} — {editTarget?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitEdit} className="space-y-4" data-testid="partner-edit-form">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("name")} *</label>
              <input data-testid="partner-edit-name-input" required value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("ownershipLabel")} *</label>
              <input data-testid="partner-edit-ownership-input" type="number" min="0" max="100" step="0.01" required value={editForm.ownership_percentage} onChange={(e) => setEditForm((f) => ({ ...f, ownership_percentage: e.target.value }))} className={`${inputCls} tabular`} />
            </div>
            <div className="grid grid-cols-[1fr_90px] gap-3">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("paidCapitalLabel")}</label>
                <input data-testid="partner-edit-capital-input" type="number" min="0" step="0.01" value={editForm.paid_in_capital} onChange={(e) => setEditForm((f) => ({ ...f, paid_in_capital: e.target.value }))} className={`${inputCls} tabular`} placeholder="0" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("currencyLabel")}</label>
                <select data-testid="partner-edit-currency-select" value={editForm.capital_currency} onChange={(e) => setEditForm((f) => ({ ...f, capital_currency: e.target.value }))} className={`${inputCls} tabular`}>
                  {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("notesLabel")}</label>
              <input data-testid="partner-edit-notes-input" value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls} />
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {t("capitalEditNote")}</p>
            <div className="flex gap-3">
              <button type="button" data-testid="partner-edit-cancel-btn" onClick={() => setEditOpen(false)}
                className="flex-1 py-3 rounded-lg border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors">{t("cancel")}</button>
              <button data-testid="partner-edit-save-btn" type="submit" disabled={savingEdit || !editForm.name || editForm.ownership_percentage === ""}
                className="flex-1 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {savingEdit && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("edit")}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={txnOpen} onOpenChange={setTxnOpen}>
        <DialogContent data-testid="partner-txn-dialog">
          <DialogHeader>
            <DialogTitle>{t("addTransaction")} — {selected?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitTxn} className="space-y-4" data-testid="partner-txn-form">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("txnType")}</label>
                <select data-testid="txn-type-select" value={txnForm.type} onChange={(e) => setTxnForm((f) => ({ ...f, type: e.target.value }))} className={inputCls}>
                  {TXN_TYPES.map((tt) => <option key={tt} value={tt}>{t(txnLabel[tt])}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("amountLabel")} *</label>
                <input data-testid="txn-amount-input" type="number" min="0.01" step="0.01" required value={txnForm.amount} onChange={(e) => setTxnForm((f) => ({ ...f, amount: e.target.value }))} className={`${inputCls} tabular`} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("dateLabel")}</label>
              <input data-testid="txn-date-input" type="date" value={txnForm.date} onChange={(e) => setTxnForm((f) => ({ ...f, date: e.target.value }))} className={`${inputCls} tabular`} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("notesLabel")}</label>
              <input data-testid="txn-notes-input" value={txnForm.notes} onChange={(e) => setTxnForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls} />
            </div>
            <button data-testid="txn-save-btn" type="submit" disabled={savingTxn || !txnForm.amount}
              className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {savingTxn && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("addTransaction")}
            </button>
          </form>
        </DialogContent>
      </Dialog>
        </>
      )}
    </div>
  );
}
