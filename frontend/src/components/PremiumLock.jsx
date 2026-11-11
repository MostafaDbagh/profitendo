import { Crown } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

export const PremiumLock = ({ title, testid }) => {
  const { t } = useLanguage();
  const { user } = useAuth();
  return (
    <div className="bg-gradient-to-l from-amber-50/70 to-white rounded-xl border border-amber-200 p-8 text-center" data-testid={testid || "premium-lock"}>
      <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center mx-auto mb-3">
        <Crown className="w-6 h-6 text-amber-600" />
      </div>
      <h3 className="font-bold text-slate-900 mb-1">{title || t("premiumLockedTitle")}</h3>
      <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">{t("premiumLockedDesc")}</p>
      {user?.role === "OWNER" ? (
        <Link
          to="/subscription"
          data-testid="premium-upgrade-link"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold transition-colors"
        >
          <Crown className="w-4 h-4" /> {t("upgradeNow")}
        </Link>
      ) : (
        <p className="text-xs font-semibold text-slate-400" data-testid="premium-contact-owner">{t("aiContactOwner")}</p>
      )}
    </div>
  );
};

export const PremiumBadge = () => {
  const { t } = useLanguage();
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold" data-testid="premium-badge">
      <Crown className="w-3 h-3" /> {t("premiumBadge")}
    </span>
  );
};
