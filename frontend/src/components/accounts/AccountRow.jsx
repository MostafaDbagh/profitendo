import { Pencil, Trash2, Power } from "lucide-react";

export function AccountRow({ account: a, depth, name, manage, t, onEdit, onToggle, onDelete }) {
  return (
    <div
      data-testid={`account-row-${a.account_id}`}
      className={`flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50/60 transition-colors ${a.is_active ? "" : "opacity-50"}`}
      style={{ paddingInlineStart: `${20 + depth * 24}px` }}
    >
      <span className="text-xs text-slate-400 tabular w-12 shrink-0">{a.code}</span>
      <span className="text-sm font-medium text-slate-800 flex-1 truncate">{name}</span>
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${a.normal_balance === "debit" ? "bg-sky-50 text-sky-600" : "bg-violet-50 text-violet-600"}`}>
        {a.normal_balance === "debit" ? t("natureDebit") : t("natureCredit")}
      </span>
      <span
        data-testid={`account-status-${a.account_id}`}
        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.is_active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}
      >
        {a.is_active ? t("statusActive") : t("statusInactive")}
      </span>
      {manage && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button data-testid={`account-edit-${a.account_id}`} onClick={() => onEdit(a)} title={t("editAccount")}
            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button data-testid={`account-toggle-${a.account_id}`} onClick={() => onToggle(a)}
            title={a.is_active ? t("acctDeactivate") : t("acctActivate")}
            className={`p-1.5 rounded-lg transition-colors ${a.is_active ? "text-slate-400 hover:text-amber-600 hover:bg-amber-50" : "text-amber-500 hover:bg-amber-50"}`}>
            <Power className="w-3.5 h-3.5" />
          </button>
          {a.is_system ? (
            <span data-testid={`account-delete-disabled-${a.account_id}`} title={t("systemAccountNote")}
              className="p-1.5 text-slate-200 cursor-not-allowed">
              <Trash2 className="w-3.5 h-3.5" />
            </span>
          ) : (
            <button data-testid={`account-delete-${a.account_id}`} onClick={() => onDelete(a)} title={t("delete")}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
