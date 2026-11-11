import { Loader2, X } from "lucide-react";

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";
const GROUPS = ["assets", "liabilities", "equity", "revenue", "cost_of_sales", "expenses"];

export function AccountFormModal({ modal, form, setForm, parentOptions, subgroupOptions, acctName, t, saving, onClose, onSubmit }) {
  const sysEdit = modal.mode === "edit" && modal.account.is_system;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="account-modal">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl border border-slate-200 shadow-xl p-6 w-full max-w-md fade-up max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 end-4 text-slate-400 hover:text-slate-700 transition-colors">
          <X className="w-4 h-4" />
        </button>
        <h2 className="text-lg font-bold text-slate-900 mb-5">
          {modal.mode === "create" ? t("addAccount") : t("editAccount")}
        </h2>
        {sysEdit && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-4">{t("systemAccountNote")}</p>
        )}
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("accountCode")} *</label>
              <input data-testid="account-code-input" value={form.code} disabled={sysEdit}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className={`${inputCls} tabular`} dir="ltr" required maxLength={20} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("accountType")} *</label>
              <select data-testid="account-group-select" value={form.group} disabled={sysEdit || modal.mode === "edit"}
                onChange={(e) => setForm({ ...form, group: e.target.value, parent_id: "", subgroup: "" })}
                className={inputCls}>
                {GROUPS.map((g) => <option key={g} value={g}>{t(`acctGroup_${g}`)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("accountName")} *</label>
            {sysEdit ? (
              <input value={acctName(modal.account)} disabled className={`${inputCls} bg-slate-50`} />
            ) : (
              <input data-testid="account-name-input" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputCls} required maxLength={120} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("parentAccount")}</label>
              <select data-testid="account-parent-select" value={form.parent_id} disabled={sysEdit}
                onChange={(e) => setForm({ ...form, parent_id: e.target.value })} className={inputCls}>
                <option value="">{t("noParent")}</option>
                {parentOptions.map((p) => (
                  <option key={p.account_id} value={p.account_id}>{p.code} — {acctName(p)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("accountSubgroup")}</label>
              <select data-testid="account-subgroup-select" value={form.subgroup} disabled={sysEdit}
                onChange={(e) => setForm({ ...form, subgroup: e.target.value })} className={inputCls}>
                <option value="">{t("noSubgroup")}</option>
                {subgroupOptions.map((s) => (
                  <option key={s.subgroup} value={s.subgroup}>{acctName(s)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("accountNature")}</label>
              <select data-testid="account-nature-select" value={form.normal_balance} disabled={sysEdit}
                onChange={(e) => setForm({ ...form, normal_balance: e.target.value })} className={inputCls}>
                <option value="debit">{t("natureDebit")}</option>
                <option value="credit">{t("natureCredit")}</option>
              </select>
            </div>
            {modal.mode === "edit" && (
              <label className="flex items-center gap-2 pb-2.5 cursor-pointer">
                <input data-testid="account-active-checkbox" type="checkbox" checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500" />
                <span className="text-sm font-medium text-slate-700">{t("statusActive")}</span>
              </label>
            )}
          </div>
          <button data-testid="account-save-btn" type="submit" disabled={saving}
            className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {modal.mode === "create" ? t("addAccount") : t("saveChanges")}
          </button>
        </form>
      </div>
    </div>
  );
}
