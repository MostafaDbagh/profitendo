import { Link } from "react-router-dom";
import { TrendingUp } from "lucide-react";

export function AuthBranding({ t }) {
  return (
    <>
      <div className="hidden lg:flex w-[45%] bg-emerald-600 text-white flex-col justify-between p-12">
        <Link to="/" className="cursor-pointer flex items-center gap-3 self-start rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-emerald-600">
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center">
            <TrendingUp className="w-6 h-6" />
          </div>
          <span className="font-bold text-2xl">{t("appName")}</span>
        </Link>
        <div className="space-y-5 max-w-xl">
          <h2 className="text-3xl xl:text-4xl 2xl:text-5xl font-extrabold leading-relaxed" style={{ textWrap: 'balance' }}>{t("authOverviewTitle")}</h2>
          <p className="text-emerald-100 text-lg leading-loose max-w-md">{t("authOverviewDescription")}</p>
        </div>
        <p className="text-emerald-200 text-sm">ProfitLens © 2026</p>
      </div>
    </>
  );
}

export function MobileLogo({ t }) {
  return (
    <Link to="/" className="cursor-pointer lg:hidden flex items-center gap-3 mb-8 justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
      <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center">
        <TrendingUp className="w-5 h-5 text-white" />
      </div>
      <span className="font-bold text-xl text-slate-900">{t("appName")}</span>
    </Link>
  );
}
