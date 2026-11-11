import { LandingNav, Footer } from "../components/landing/chrome";
import { Audience, HowItWorks } from "../components/landing/marketing";
import { Support, Security, FinalCta } from "../components/landing/conversion";
import { Seo } from "../components/Seo";
import { useLanguage } from "../context/LanguageContext";

export default function AboutPage() {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" data-testid="about-page">
      <Seo title={t("seoAboutTitle")} description={t("seoAboutDesc")} path="/about" />
      <LandingNav />
      <main>
        <section className="max-w-3xl mx-auto px-5 py-16 sm:py-24 text-center" data-testid="about-hero">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-50 leading-tight">{t("aboutHeroTitle")}</h1>
          <p className="text-slate-300 mt-6 leading-relaxed">{t("aboutP1")}</p>
          <p className="text-slate-400 mt-4 leading-relaxed">{t("aboutP2")}</p>
        </section>
        <Audience />
        <HowItWorks />
        <Security />
        <Support />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
