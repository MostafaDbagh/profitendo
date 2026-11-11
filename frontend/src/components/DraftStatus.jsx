import { CheckCircle2, CloudOff, Loader2 } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";

const CONF = {
  saving: { Icon: Loader2, key: "draftSaving", cls: "text-slate-400", spin: true },
  saved: { Icon: CheckCircle2, key: "draftSaved", cls: "text-emerald-500", spin: false },
  error: { Icon: CloudOff, key: "draftSaveFailed", cls: "text-amber-500", spin: false },
};

export function DraftStatus({ status }) {
  const { t } = useLanguage();
  const c = CONF[status];
  if (!c) return null;
  return (
    <span data-testid="draft-status" data-status={status}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${c.cls}`}>
      <c.Icon className={`w-3.5 h-3.5 ${c.spin ? "animate-spin" : ""}`} />
      {t(c.key)}
    </span>
  );
}
