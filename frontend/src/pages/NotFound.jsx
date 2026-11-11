import { Link } from "react-router-dom";
import { TrendingUp } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { Seo } from "../components/Seo";

export default function NotFound() {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center px-4 text-center" data-testid="not-found-page">
      <Seo title={`404 — ${t("appName")}`} description={t("notFoundDesc")} noindex />
      <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/25 mb-8">
        <TrendingUp className="w-7 h-7 text-white" />
      </div>
      <p className="text-7xl font-extrabold text-emerald-500/90 mb-4">404</p>
      <h1 className="text-2xl font-bold text-slate-100 mb-3" data-testid="not-found-title">{t("notFoundTitle")}</h1>
      <p className="text-slate-400 mb-8 max-w-sm">{t("notFoundDesc")}</p>
      <Link to="/" data-testid="not-found-home-btn"
        className="px-8 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm transition-colors">
        {t("notFoundHome")}
      </Link>
    </div>
  );
}
