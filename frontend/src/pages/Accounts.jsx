import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { AccountGroupCard } from "../components/accounts/AccountGroupCard";
import { AccountFormModal } from "../components/accounts/AccountFormModal";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";

const GROUPS = ["assets", "liabilities", "equity", "revenue", "cost_of_sales", "expenses"];
const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";

const ACCT_ERRORS = {
  "Account number already exists": "errAcctCodeExists",
  "Default accounts cannot be deleted; deactivate instead": "errAcctSystemDelete",
  "Account has child accounts; deactivate instead": "errAcctHasChildren",
  "Account has linked journal entries; deactivate instead": "errAcctLinked",
  "Default accounts can only be activated or deactivated": "errAcctSystemEdit",
  "Parent must be in the same account group": "errAcctParentGroup",
  "Parent account is inactive": "errAcctParentInactive",
  "Maximum account depth reached": "errAcctDepth",
  "Invalid subgroup for this account group": "errAcctBadSubgroup",
};

const EMPTY_FORM = { code: "", name: "", group: "assets", parent_id: "", subgroup: "", normal_balance: "debit", is_active: true };

export default function Accounts() {
  const { t } = useLanguage();
  const { can } = useAuth();
  const manage = can("accounts.manage");
  const [accounts, setAccounts] = useState(null);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(
    () => api.get("/accounts").then(({ data }) => setAccounts(data)).catch(() => toast.error(t("somethingWrong"))),
    [t],
  );
  useEffect(() => { load(); }, [load]);

  const acctName = useCallback((a) => (a.is_system ? t(`acct_${a.code}`) : a.name), [t]);

  const errToast = (err) => {
    const detail = err?.response?.data?.detail;
    const key = typeof detail === "string" && ACCT_ERRORS[detail];
    toast.error(key ? t(key) : formatApiError(err, t("somethingWrong")));
  };

  const depthOf = useMemo(() => {
    const map = {};
    if (!accounts) return map;
    const byId = Object.fromEntries(accounts.map((a) => [a.account_id, a]));
    const depth = (a) => {
      let d = 0, cur = a;
      while (cur && cur.parent_id && byId[cur.parent_id] && d < 4) { d += 1; cur = byId[cur.parent_id]; }
      return d;
    };
    accounts.forEach((a) => { map[a.account_id] = depth(a); });
    return map;
  }, [accounts]);

  const filtered = useMemo(() => {
    if (!accounts) return {};
    const q = query.trim().toLowerCase();
    const out = {};
    GROUPS.forEach((g) => {
      const all = accounts.filter((a) => a.group === g);
      let list = all;
      if (q) {
        const byId = Object.fromEntries(all.map((a) => [a.account_id, a]));
        const keep = new Set();
        all.forEach((a) => {
          if (a.code.toLowerCase().includes(q) || acctName(a).toLowerCase().includes(q)) {
            let cur = a;
            while (cur && !keep.has(cur.account_id)) {
              keep.add(cur.account_id);
              cur = cur.parent_id ? byId[cur.parent_id] : null;
            }
          }
        });
        list = all.filter((a) => keep.has(a.account_id));
      }
      const rows = [];
      const childrenOf = (pid) => list.filter((a) => a.parent_id === pid).sort((x, y) => x.code.localeCompare(y.code));
      childrenOf(null).forEach((r) => {
        rows.push(r);
        childrenOf(r.account_id).forEach((c) => {
          rows.push(c);
          childrenOf(c.account_id).forEach((gc) => rows.push(gc));
        });
      });
      out[g] = rows;
    });
    return out;
  }, [accounts, query, acctName]);

  const openCreate = () => { setForm(EMPTY_FORM); setModal({ mode: "create" }); };
  const openEdit = (a) => {
    setForm({
      code: a.code, name: a.is_system ? "" : a.name, group: a.group,
      parent_id: a.parent_id || "", subgroup: a.subgroup || "",
      normal_balance: a.normal_balance, is_active: a.is_active,
    });
    setModal({ mode: "edit", account: a });
  };

  const parentOptions = (accounts || []).filter(
    (a) => a.group === form.group && a.is_active && a.account_id !== modal?.account?.account_id && (depthOf[a.account_id] ?? 0) < 2
  ).sort((x, y) => x.code.localeCompare(y.code));

  const subgroupOptions = (accounts || []).filter((a) => a.is_system && a.group === form.group && a.subgroup);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (modal.mode === "create") {
        await api.post("/accounts", {
          code: form.code.trim(),
          name: form.name.trim(),
          group: form.group,
          parent_id: form.parent_id || null,
          subgroup: form.subgroup || null,
          normal_balance: form.normal_balance,
        });
        toast.success(t("accountCreated"));
      } else {
        const a = modal.account;
        const body = { is_active: form.is_active };
        if (!a.is_system) {
          body.code = form.code.trim();
          body.name = form.name.trim();
          body.subgroup = form.subgroup || null;
          body.normal_balance = form.normal_balance;
          if (form.parent_id) body.parent_id = form.parent_id;
        }
        await api.put(`/accounts/${a.account_id}`, body);
        toast.success(t("accountUpdated"));
      }
      setModal(null);
      load();
    } catch (err) {
      errToast(err);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (a) => {
    try {
      await api.put(`/accounts/${a.account_id}`, { is_active: !a.is_active });
      toast.success(t("accountUpdated"));
      load();
    } catch (err) {
      errToast(err);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.delete(`/accounts/${toDelete.account_id}`);
      toast.success(t("accountDeleted"));
      setToDelete(null);
      load();
    } catch (err) {
      errToast(err);
      setToDelete(null);
    }
  };

  if (!accounts) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div data-testid="accounts-page">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("navAccounts")}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("accountsSubtitle")}</p>
        </div>
        {manage && (
          <button data-testid="account-add-btn" onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors">
            <Plus className="w-4 h-4" /> {t("addAccount")}
          </button>
        )}
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
        <input
          data-testid="accounts-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchAccounts")}
          className={`${inputCls} ps-9`}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {GROUPS.map((g) => (
          <AccountGroupCard
            key={g}
            group={g}
            rows={filtered[g] || []}
            depthOf={depthOf}
            acctName={acctName}
            manage={manage}
            t={t}
            onEdit={openEdit}
            onToggle={toggleActive}
            onDelete={setToDelete}
          />
        ))}
      </div>

      {modal && (
        <AccountFormModal
          modal={modal}
          form={form}
          setForm={setForm}
          parentOptions={parentOptions}
          subgroupOptions={subgroupOptions}
          acctName={acctName}
          t={t}
          saving={saving}
          onClose={() => setModal(null)}
          onSubmit={submit}
        />
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && `${toDelete.code} — ${acctName(toDelete)}. `}{t("deleteAccountConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="account-delete-confirm" onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700">{t("delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
