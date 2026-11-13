import { Link } from 'react-router-dom';
import { TrendingUp, ChartNoAxesColumnIncreasing, ShoppingCart, Package, ReceiptText, ArrowLeft, ArrowRight } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { REGISTER_URL } from './chrome';

export default function HomeHero() {
  const { t, lang } = useLanguage();
  const ar = lang === 'ar';
  const Arrow = ar ? ArrowLeft : ArrowRight;
  const rows = [
    [ShoppingCart, t('lpKpiSales'), '120,000'],
    [Package, t('lpKpiCogs'), '72,000'],
    [ReceiptText, ar ? 'المصروفات' : 'Expenses', '18,000'],
    [ChartNoAxesColumnIncreasing, t('lpKpiNet'), '30,000'],
  ];
  return <section className="home-hero" data-testid="lp-hero">
    <div className="home-hero-copy">
      <h1 data-testid="lp-hero-title">{t('lpHeroTitle')}</h1>
      <p className="home-hero-description" data-testid="lp-hero-sub">{t('lpHeroSub')}</p>
      <div className="home-hero-actions">
        <Link className="home-primary" to={REGISTER_URL} data-testid="lp-hero-cta-start">{t('lpHeroCta')}</Link>
        <a className="home-text-link" href="#features" data-testid="lp-hero-cta-demo">{t('lpHeroCta2')}<Arrow size={21}/></a>
      </div>
      <p className="home-hero-note" data-testid="lp-hero-trust">{t('lpHeroTrust')}</p>
    </div>
    <div className="home-hero-visual">
      <TrendingUp className="home-brand-motif" aria-hidden="true" strokeWidth={1.5}/>
      <ChartNoAxesColumnIncreasing className="home-chart-motif" aria-hidden="true" strokeWidth={1.5}/>
      <div className="home-report" aria-label={ar ? 'مثال توضيحي لتقرير مالي' : 'Illustrative financial report'}>
        <div className="home-report-heading">
          <div><h2>{ar ? 'التقرير المالي' : 'Financial report'}</h2><p>{ar ? 'الفترة: نوفمبر 2026' : 'Period: November 2026'}</p></div>
          <span className="home-report-sample">{ar ? 'بيانات تجريبية' : 'Sample data'}</span>
        </div>
        <dl>{rows.map(([Icon, label, amount], i) => <div className={`home-report-row ${i === 3 ? 'home-report-total' : ''}`} key={label}>
          <dt><Icon size={20} aria-hidden="true"/>{label}</dt><dd><bdi>{amount}</bdi><small>{ar ? 'ل.س' : 'SYP'}</small></dd>
        </div>)}</dl>
      </div>
    </div>
  </section>;
}
