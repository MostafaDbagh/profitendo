// Keep public URLs aligned with robots.txt, sitemap.xml and static-page generation.
export const SITE_URL = 'https://profitendo.com';
export const SITE_NAME = 'ProfitLens';
export const PUBLIC_PATHS = ['/', '/features', '/pricing', '/about'];
export const SOCIAL_IMAGE = {path:'/social/profitlens-og.png', width:1200, height:630, type:'image/png'};
export const DEFAULT_METADATA = {
  ar: {
    title:'ProfitLens — صورة أوضح لأداء أعمالك',
    description:'أدر المبيعات والمشتريات والمخزون والمصروفات، وتابع أرباح نشاطك وتقارير الإغلاق مع ProfitLens. ابدأ بتجربة مجانية لمدة 14 يومًا.',
    imageAlt:'ProfitLens — صورة أوضح لأداء أعمالك',
    privateDescription:'مساحة خاصة لإدارة حسابك ونشاطك في ProfitLens.'
  },
  en: {
    title:'ProfitLens — A clearer view of your business',
    description:'Manage sales, purchases, inventory and expenses with ProfitLens. Track business profits and closing reports. Start a 14-day free trial.',
    imageAlt:'ProfitLens — a clearer view of your business',
    privateDescription:'Private account and business management in ProfitLens.'
  }
};

export function basePublicPath(path = '/') {
  const clean = String(path).split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return clean === '/en' ? '/' : clean.startsWith('/en/') ? clean.slice(3) : clean;
}
export function publicPagePath(path = '/', lang = 'ar') {
  const base = basePublicPath(path);
  if (!PUBLIC_PATHS.includes(base)) return path;
  return lang === 'en' ? `/en${base === '/' ? '' : base}` : base;
}
export function canonicalUrl(path = '/', lang = 'ar') {
  return new URL(publicPagePath(path, lang), `${SITE_URL}/`).href;
}
