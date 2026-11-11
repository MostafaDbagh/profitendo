import { Link } from "react-router-dom";
import { TrendingUp, Languages, MessageCircle, Mail } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";

export const REGISTER_URL = "/auth?mode=register";
export const LOGIN_URL = "/auth";

export function LandingNav() {
  const { t, lang, setLang } = useLanguage();
  return (
    <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/60" data-testid="lp-nav">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 px-5 h-16">
        <Link to="/" className="flex items-center gap-2.5" data-testid="lp-nav-brand">
          <span className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/25">
            <TrendingUp className="w-5 h-5 text-white" />
          </span>
          <span className="font-extrabold text-lg text-slate-100">{t("appName")}</span>
        </Link>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1 me-2">
            <Link to="/features" data-testid="lp-nav-features" className="px-3 py-2 rounded-lg text-sm font-bold text-slate-300 hover:text-white transition-colors">{t("lpNavFeatures")}</Link>
            <Link to="/pricing" data-testid="lp-nav-pricing" className="px-3 py-2 rounded-lg text-sm font-bold text-slate-300 hover:text-white transition-colors">{t("lpNavPricing")}</Link>
            <Link to="/about" data-testid="lp-nav-about" className="px-3 py-2 rounded-lg text-sm font-bold text-slate-300 hover:text-white transition-colors">{t("lpNavAbout")}</Link>
          </div>
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} data-testid="lp-lang-toggle"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors">
            <Languages className="w-4 h-4" />
            {lang === "ar" ? "EN" : "عربي"}
          </button>
          <Link to={LOGIN_URL} data-testid="lp-nav-login"
            className="hidden sm:inline-flex px-4 py-2 rounded-lg text-sm font-bold text-slate-300 hover:text-white transition-colors">
            {t("lpLogin")}
          </Link>
          <Link to={REGISTER_URL} data-testid="lp-nav-start"
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold transition-colors">
            {t("lpHeroCta")}
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="border-t border-slate-800/60 py-10" data-testid="lp-footer">
      <div className="max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-white" />
          </span>
          <span className="font-bold text-slate-200">{t("appName")}</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="https://wa.me/963985566918" target="_blank" rel="noreferrer" data-testid="lp-footer-whatsapp"
            className="text-slate-400 hover:text-emerald-400 transition-colors"><MessageCircle className="w-5 h-5" /></a>
          <a href="mailto:profitlens.team@gmail.com" data-testid="lp-footer-email"
            className="text-slate-400 hover:text-emerald-400 transition-colors"><Mail className="w-5 h-5" /></a>
        </div>
        <p className="text-xs text-slate-500">{t("lpFooterRights")}</p>
      </div>
    </footer>
  );
}
