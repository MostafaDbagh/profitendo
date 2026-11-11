import { Link } from "react-router-dom";
import { Crown, Lock, RotateCcw, Sparkles } from "lucide-react";

export function AssistantHeader({ sub, t, onNewChat }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4 border-b border-slate-100 bg-gradient-to-l from-emerald-50/60 to-white">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base md:text-lg font-bold text-slate-900 flex items-center gap-1.5">
              {t("aiAssistant")}
              <Crown className="w-4 h-4 text-amber-500" data-testid="ai-crown" />
            </h2>
            {sub && (
              <span
                data-testid="ai-subscription-badge"
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap ${
                  sub.assistant_access && sub.status !== "trial"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : sub.status === "trial"
                    ? "bg-amber-50 text-amber-700 border border-amber-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}
              >
                {sub.assistant_access && sub.status !== "trial"
                  ? t("subPillActive")
                  : sub.status === "trial"
                  ? t("subPillTrial", { days: sub.trial_days_remaining })
                  : t("subBadgeExpired")}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{t("aiSubtitle")}</p>
        </div>
      </div>
      <button
        data-testid="ai-new-chat-btn"
        onClick={onNewChat}
        title={t("aiNewChat")}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-emerald-700 transition-colors px-3 py-2 rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 shrink-0 ms-auto"
      >
        <RotateCcw className="w-3.5 h-3.5" /> {t("aiNewChat")}
      </button>
    </div>
  );
}

export function AssistantLocked({ isOwner, t }) {
  return (
    <div className="px-5 py-10 text-center" data-testid="ai-locked">
      <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
        <Lock className="w-6 h-6 text-red-500" />
      </div>
      <h3 className="text-base font-bold text-slate-900 mb-1">{t("aiLockedTitle")}</h3>
      <p className="text-sm text-slate-500 mb-5 max-w-sm mx-auto">{t("aiLockedDesc")}</p>
      {isOwner ? (
        <Link
          to="/subscription"
          data-testid="ai-upgrade-link"
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold transition-colors"
        >
          <Sparkles className="w-4 h-4" /> {t("subUpgrade")}
        </Link>
      ) : (
        <p className="text-xs font-semibold text-slate-400" data-testid="ai-contact-owner">{t("aiContactOwner")}</p>
      )}
    </div>
  );
}
