import { LandingNav, Footer } from "../components/landing/chrome";
import { Pricing, Faq, FinalCta } from "../components/landing/conversion";
import { Seo } from "../components/Seo";
import { useLanguage } from "../context/LanguageContext";

export default function PricingPage() {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" data-testid="pricing-page">
      <Seo title={t("seoPricingTitle")} description={t("seoPricingDesc")} path="/pricing" />
      <LandingNav />
      <main>
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
