import { TrendingUp } from "lucide-react";

export function AuthBranding({ t }) {
  return (
    <>
      <div className="hidden lg:flex w-[45%] bg-emerald-600 text-white flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center">
            <TrendingUp className="w-6 h-6" />
          </div>
          <span className="font-bold text-2xl">{t("appName")}</span>
        </div>
        <div className="space-y-6">
          <h1 className="text-4xl xl:text-5xl font-extrabold leading-tight">{t("tagline")}</h1>
          <p className="text-emerald-100 text-lg max-w-md">{t("dashboardSubtitle")}</p>
          <div className="flex gap-8 pt-4">
            <div>
              <p className="text-3xl font-bold tabular">100%</p>
              <p className="text-emerald-100 text-sm">{t("netProfit")}</p>
            </div>
            <div>
              <p className="text-3xl font-bold tabular">AR / EN</p>
              <p className="text-emerald-100 text-sm">{t("languageLabel")}</p>
            </div>
          </div>
        </div>
        <p className="text-emerald-200 text-sm">ProfitLens © 2026</p>
      </div>
    </>
  );
}

export function MobileLogo({ t }) {
  return (
    <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
      <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center">
        <TrendingUp className="w-5 h-5 text-white" />
      </div>
      <span className="font-bold text-xl text-slate-900">{t("appName")}</span>
    </div>
  );
}
