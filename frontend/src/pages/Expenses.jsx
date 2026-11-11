import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Plus, Receipt, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useOnlineStatus } from "../lib/pwa";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fmtMoney, num } from "../lib/calculations";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "../components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";
const CATEGORIES = ["rent", "utilities", "salaries", "advertising", "shipping", "packaging", "maintenance", "transportation", "taxes", "other"];
const EMPTY = { amount: "", category: "other", date: "", description: "", payment_method: "cash", notes: "" };

export default function Expenses() {
  const { t, lang } = useLanguage();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [expenses, setExpenses] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(params.get("new") === "1");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const canCreate = can("expenses.create");
  const canEdit = can("expenses.edit");
  const canDelete = can("expenses.delete");
  const manage = canCreate || canEdit || canDelete;

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/expenses");
      setExpenses(data);
    } catch {
      toast.error(t("somethingWrong"));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };

  const openEdit = (e) => {
    setEditing(e);
    setForm({ amount: String(e.amount), category: e.category, date: e.date, description: e.description, payment_method: e.payment_method, notes: e.notes });
    setDialogOpen(true);
  };

  const closeDialog = (open) => {
    setDialogOpen(open);
    if (!open && params.get("new")) setParams({});
  };

  const submit = async (ev) => {
    ev.preventDefault();
    setSaving(true);
    const payload = { ...form, amount: num(form.amount), date: form.date || null };
    try {
      if (editing) {
        await api.put(`/expenses/${editing.expense_id}`, payload);
        toast.success(t("expenseUpdated"));
      } else {
        await api.post("/expenses", payload);
        toast.success(t("expenseCreated"));
      }
      const backToWizard = params.get("onboarding") === "1";
      setDialogOpen(false);
      if (params.get("new")) setParams({});
      if (backToWizard) {
        navigate("/onboarding");
        return;
      }
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/expenses/${toDelete.expense_id}`);
      toast.success(t("expenseDeleted"));
      setToDelete(null);
      load();
    } catch {
      toast.error(t("somethingWrong"));
      setToDelete(null);
    }
  };

  const fmtDate = (iso) => {
    try {
      return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(iso));
    } catch { return iso; }
  };

  const total = (expenses || []).reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-6 fade-up" data-testid="expenses-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("expensesTitle")}</h1>
          {expenses && <p className="text-slate-500 text-sm mt-1 tabular">{t("grandTotal")}: {fmtMoney(total)}</p>}
        </div>
        {canCreate && (
          <button onClick={openCreate} data-testid="new-expense-btn"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors">
            <Plus className="w-4 h-4" /> {t("newExpense")}
          </button>
        )}
      </div>

      {!expenses ? (
        <div className="flex items-center justify-center py-20"><div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" /></div>
      ) : expenses.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center" data-testid="expenses-empty">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <Receipt className="w-7 h-7 text-emerald-500" />
          </div>
          <p className="font-semibold text-slate-800">{t("noExpenses")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto" data-testid="expenses-table">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="text-start font-medium px-5 py-3.5">{t("dateLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("categoryLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("descriptionLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("paymentMethod")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("amountLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("byLabel")}</th>
                {manage && <th className="px-5 py-3.5" />}
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.expense_id} className="border-b border-slate-50" data-testid={`expense-row-${e.expense_id}`}>
                  <td className="px-5 py-3.5 text-slate-600">{fmtDate(e.date)}</td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{t(`cat_${e.category}`)}</span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-700">{e.description || "—"}</td>
                  <td className="px-5 py-3.5 text-slate-500">{t(`pm${e.payment_method.charAt(0).toUpperCase()}${e.payment_method.slice(1)}`)}</td>
                  <td className="px-5 py-3.5 tabular font-semibold text-slate-800">{fmtMoney(e.amount)}</td>
                  <td className="px-5 py-3.5 text-slate-500">{e.created_by_name}</td>
                  {manage && (
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1 justify-end">
                        {canEdit && (
                          <button data-testid={`edit-expense-${e.expense_id}`} onClick={() => openEdit(e)}
                            className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {canDelete && (
                          <button data-testid={`delete-expense-${e.expense_id}`} onClick={() => setToDelete(e)}
                            className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={closeDialog}>
        <DialogContent data-testid="expense-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? t("editExpense") : t("newExpense")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" data-testid="expense-form">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("amountLabel")} *</label>
                <input data-testid="expense-amount-input" type="number" min="0.01" step="0.01" required value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={`${inputCls} tabular`} />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("dateLabel")}</label>
                <input data-testid="expense-date-input" type="date" value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={`${inputCls} tabular`} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("categoryLabel")}</label>
                <select data-testid="expense-category-select" value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={inputCls}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat_${c}`)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("paymentMethod")}</label>
                <select data-testid="expense-payment-select" value={form.payment_method}
                  onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))} className={inputCls}>
                  <option value="cash">{t("pmCash")}</option>
                  <option value="card">{t("pmCard")}</option>
                  <option value="transfer">{t("pmTransfer")}</option>
                  <option value="other">{t("pmOther")}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("descriptionLabel")}</label>
              <input data-testid="expense-description-input" value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={inputCls} />
            </div>
            <button data-testid="expense-save-btn" type="submit" disabled={saving || !online || !form.amount}
              className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("saveProduct")}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent data-testid="expense-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete")}؟</AlertDialogTitle>
            <AlertDialogDescription>{fmtMoney(toDelete?.amount || 0)} — {t(`cat_${toDelete?.category || "other"}`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="expense-delete-cancel">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="expense-delete-confirm" onClick={doDelete} className="bg-red-500 hover:bg-red-600 text-white">
              {t("confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
