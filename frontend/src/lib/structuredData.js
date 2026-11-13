// Describe only the public pages and facts presented by the current B2B app.
// A 14-day trial is not a permanently free Offer. Do not invent ratings, prices,
// legal/company identifiers, social profiles, or SearchAction endpoints.
const PUBLIC_PATHS = new Set(['/', '/features', '/pricing', '/about']);

export function buildStructuredData({siteUrl, title, description, path = '/', lang = 'ar'}) {
  const englishPath = path === '/en' || path.startsWith('/en/');
  const contentPath = path === '/en' ? '/' : englishPath ? path.slice(3) : path;
  if (!PUBLIC_PATHS.has(contentPath)) return null;
  const site = new URL('/', siteUrl).href;
  const pageUrl = new URL(path, site).href;
  const organizationId = `${site}#organization`;
  const websiteId = `${site}#website`;
  const applicationId = `${site}#application`;
  const language = englishPath || lang === 'en' ? 'en' : 'ar';
  const organization = {
    '@type': 'Organization',
    '@id': organizationId,
    name: 'ProfitLens',
    url: site,
    logo: new URL('/icons/icon-512.png', site).href,
    email: 'profitlens.team@gmail.com',
  };
  const website = {
    '@type': 'WebSite',
    '@id': websiteId,
    name: 'ProfitLens',
    url: site,
    inLanguage: ['ar', 'en'],
    publisher: {'@id': organizationId},
  };
  const page = {
    '@type': contentPath === '/about' ? 'AboutPage' : 'WebPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: title,
    ...(description ? {description} : {}),
    inLanguage: language,
    isPartOf: {'@id': websiteId},
    about: {'@id': contentPath === '/about' ? organizationId : applicationId},
  };
  const graph = [organization, website, page];
  if (contentPath !== '/about') graph.push({
    '@type': 'WebApplication',
    '@id': applicationId,
    name: 'ProfitLens',
    url: site,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web browser',
    browserRequirements: 'Requires JavaScript and an internet connection.',
    inLanguage: ['ar', 'en'],
    publisher: {'@id': organizationId},
  });
  return {'@context': 'https://schema.org', '@graph': graph};
}

// Safe both when inserted with textContent and when embedded by a static renderer.
export function serializeStructuredData(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
