import { useCallback, useEffect, useState } from "react";
import { Users, UserPlus, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fmtMoney } from "../lib/calculations";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";

const PERM_KEYS = [
  "products.view", "products.create", "products.edit", "products.delete", "products.costs",
  "sales.view", "sales.create", "sales.edit", "sales.cancel",
  "purchases.view", "purchases.create", "purchases.edit", "purchases.cancel",
  "inventory.view", "inventory.adjust",
  "returns.view", "returns.create", "returns.edit", "returns.cancel",
  "expenses.view", "expenses.create", "expenses.edit", "expenses.delete",
  "finance.profit", "finance.margin", "finance.reports",
  "cash.view", "cash.close", "salaries.view",
  "withdrawals.view", "withdrawals.manage",
  "employees.view", "employees.manage",
  "partners.view", "partners.manage",
  "users.manage", "permissions.manage", "settings.business",
  "audit.view",
];

const EMPTY_EMP = { name: "", email: "", password: "", role: "EMPLOYEE", username: "", phone: "", salary: "", commission: "", hire_date: "" };

const roleBadge = {
  OWNER: "bg-emerald-100 text-emerald-700",
  MANAGER: "bg-sky-100 text-sky-700",
  EMPLOYEE: "bg-slate-100 text-slate-600",
  ACCOUNTANT: "bg-amber-100 text-amber-700",
};

export default function Employees() {
  const { t } = useLanguage();
  const { can, user: me } = useAuth();
  const manage = can("users.manage");
  const canPerms = can("permissions.manage");
  const seeSalary = can("salaries.view");
  const [members, setMembers] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_EMP);
  const [saving, setSaving] = useState(false);
  const [permFor, setPermFor] = useState(null);
  const [permDraft, setPermDraft] = useState({});
  const [savingPerms, setSavingPerms] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/team");
      setMembers(data);
    } catch {
      toast.error(t("somethingWrong"));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const submitAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/team", {
        ...form,
        username: form.username || null,
        salary: form.salary === "" ? null : parseFloat(form.salary),
        commission: form.commission === "" ? null : parseFloat(form.commission),
        hire_date: form.hire_date || null,
      });
      toast.success(t("employeeCreated"));
      setAddOpen(false);
      setForm(EMPTY_EMP);
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSaving(false);
    }
  };

  const openPerms = (m) => {
    setPermFor(m);
    setPermDraft({ ...m.permissions });
  };

  const savePerms = async () => {
    setSavingPerms(true);
    try {
      await api.put(`/team/${permFor.user_id}/permissions`, { overrides: permDraft });
      toast.success(t("permissionsUpdated"));
      setPermFor(null);
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSavingPerms(false);
    }
  };

  const roleKey = (r) => `role${r.charAt(0)}${r.slice(1).toLowerCase()}`;

  const toggleStatus = async (m) => {
    try {
      await api.put(`/team/${m.user_id}`, { status: m.status === "active" ? "inactive" : "active" });
      toast.success(t("employeeStatusUpdated"));
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    }
  };

  return (
    <div className="space-y-6 fade-up" data-testid="employees-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("employeesTitle")}</h1>
        {manage && (
          <button onClick={() => setAddOpen(true)} data-testid="add-employee-btn"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors">
            <UserPlus className="w-4 h-4" /> {t("addEmployee")}
          </button>
        )}
      </div>

      {!members ? (
        <div className="flex items-center justify-center py-20"><div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" /></div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto" data-testid="employees-table">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="text-start font-medium px-5 py-3.5">{t("name")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("email")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("roleLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("statusLabel")}</th>
                {seeSalary && <th className="text-start font-medium px-5 py-3.5">{t("salaryLabel")}</th>}
                {(manage || canPerms) && <th className="px-5 py-3.5" />}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id} className="border-b border-slate-50" data-testid={`employee-row-${m.user_id}`}>
                  <td className="px-5 py-3.5 font-semibold text-slate-800">
                    {m.name}
                    {m.username && <p className="text-xs text-slate-400 font-normal tabular" dir="ltr">{m.username}</p>}
                  </td>
                  <td className="px-5 py-3.5 text-slate-500" dir="ltr">{m.email?.endsWith("@noemail.profitlens.local") ? "—" : m.email}</td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${roleBadge[m.role] || roleBadge.EMPLOYEE}`}>{t(roleKey(m.role))}</span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">{m.status === "active" ? t("statusActive") : t("statusInactive")}</td>
                  {seeSalary && (
                    <td className="px-5 py-3.5 tabular text-slate-700">{m.salary != null ? fmtMoney(m.salary) : "—"}</td>
                  )}
                  {(manage || canPerms) && (
                    <td className="px-5 py-3.5 text-end">
                      <div className="flex items-center gap-1.5 justify-end">
                        {m.role !== "OWNER" && m.user_id !== me?.user_id && canPerms && (
                          <button data-testid={`perms-${m.user_id}`} onClick={() => openPerms(m)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors">
                            <ShieldCheck className="w-3.5 h-3.5" /> {t("editPermissions")}
                          </button>
                        )}
                        {m.role !== "OWNER" && m.user_id !== me?.user_id && manage && (
                          <button data-testid={`toggle-status-${m.user_id}`} onClick={() => toggleStatus(m)}
                            className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                              m.status === "active"
                                ? "text-red-600 border-red-200 hover:bg-red-50"
                                : "text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                            }`}>
                            {t("statusToggle")}
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

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="employee-dialog">
          <DialogHeader>
            <DialogTitle>{t("addEmployee")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitAdd} className="space-y-4" data-testid="employee-form">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("name")} *</label>
                <input data-testid="employee-name-input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("roleLabel")}</label>
                <select data-testid="employee-role-select" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className={inputCls}>
                  <option value="EMPLOYEE">{t("roleEmployee")}</option>
                  <option value="MANAGER">{t("roleManager")}</option>
                  <option value="ACCOUNTANT">{t("roleAccountant")}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("email")}</label>
              <input data-testid="employee-email-input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputCls} dir="ltr" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("usernameLabel")}</label>
              <input data-testid="employee-username-input" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} className={inputCls} dir="ltr" />
              <p className="text-xs text-slate-400 mt-1">{t("usernameHint")}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("passwordLabel")}</label>
              <input data-testid="employee-password-input" type="password" minLength={6} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className={inputCls} dir="ltr" />
              <p className="text-xs text-slate-400 mt-1">{t("passwordOptionalHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("phoneLabel")}</label>
                <input data-testid="employee-phone-input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={inputCls} dir="ltr" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("hireDateLabel")}</label>
                <input data-testid="employee-hiredate-input" type="date" value={form.hire_date} onChange={(e) => setForm((f) => ({ ...f, hire_date: e.target.value }))} className={`${inputCls} tabular`} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("salaryLabel")}</label>
                <input data-testid="employee-salary-input" type="number" min="0" step="0.01" value={form.salary} onChange={(e) => setForm((f) => ({ ...f, salary: e.target.value }))} className={`${inputCls} tabular`} />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("commissionLabel")}</label>
                <input data-testid="employee-commission-input" type="number" min="0" step="0.01" value={form.commission} onChange={(e) => setForm((f) => ({ ...f, commission: e.target.value }))} className={`${inputCls} tabular`} />
              </div>
            </div>
            <button data-testid="employee-save-btn" type="submit" disabled={saving || !form.name}
              className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("addEmployee")}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!permFor} onOpenChange={(o) => !o && setPermFor(null)}>
        <DialogContent className="max-w-lg" data-testid="permissions-dialog">
          <DialogHeader>
            <DialogTitle>{t("permissionsTitle")} — {permFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto py-2" data-testid="permissions-grid">
            {PERM_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors" data-testid={`perm-${k.replace(".", "-")}`}>
                <input
                  type="checkbox"
                  checked={!!permDraft[k]}
                  onChange={(e) => setPermDraft((d) => ({ ...d, [k]: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                />
                <span className="text-sm text-slate-700">{t(`perm_${k.replace(".", "_")}`)}</span>
              </label>
            ))}
          </div>
          <button data-testid="permissions-save-btn" onClick={savePerms} disabled={savingPerms}
            className="w-full mt-2 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {savingPerms && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("permissionsUpdated")}
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
