import { useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { buildStructuredData, serializeStructuredData } from '../lib/structuredData';
import { SITE_URL, SITE_NAME, DEFAULT_METADATA, SOCIAL_IMAGE, PUBLIC_PATHS, basePublicPath, publicPagePath, canonicalUrl } from '../lib/siteMetadata';

function upsert(attr, key, content) {
  const matches = [...document.head.querySelectorAll(`meta[${attr}="${key}"]`)];
  let el = matches.shift();
  matches.forEach(node => node.remove());
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}
function setLink(rel, href, attributes = {}) {
  const selector = `link[rel="${rel}"]${attributes.hreflang ? `[hreflang="${attributes.hreflang}"]` : ''}`;
  const matches = [...document.head.querySelectorAll(selector)];
  let el = matches.shift();
  matches.forEach(node => node.remove());
  if (!el) {el = document.createElement('link'); document.head.appendChild(el);}
  Object.entries({rel, href, ...attributes}).forEach(([key,value]) => el.setAttribute(key,value));
}
function clearPageLinks() {
  document.head.querySelectorAll('link[rel="canonical"],link[rel="alternate"][hreflang],link[rel="describedby"][data-seo]').forEach(node => node.remove());
}

export function Seo({ title, description, path = '/', noindex = false }) {
  const {lang} = useLanguage();
  useEffect(() => {
    const language = lang === 'en' ? 'en' : 'ar';
    const defaults = DEFAULT_METADATA[language];
    const pageTitle = title?.trim() || defaults.title;
    const pageDescription = description?.trim() || (noindex ? defaults.privateDescription : defaults.description);
    const indexable = !noindex && PUBLIC_PATHS.includes(basePublicPath(path));
    const url = canonicalUrl(path,language);
    const image = new URL(SOCIAL_IMAGE.path,SITE_URL).href;
    document.title = pageTitle;
    upsert('name','description',pageDescription);
    upsert('name','robots',indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow');
    for (const [key,value] of Object.entries({
      'og:type':'website','og:site_name':SITE_NAME,'og:title':pageTitle,
      'og:description':pageDescription,'og:url':url,'og:image':image,
      'og:image:secure_url':image,'og:image:type':SOCIAL_IMAGE.type,
      'og:image:width':String(SOCIAL_IMAGE.width),'og:image:height':String(SOCIAL_IMAGE.height),
      'og:image:alt':defaults.imageAlt
    })) upsert('property',key,value);
    // Locale is omitted: the site has language variants, not country-specific editions.
    document.head.querySelectorAll('meta[property="og:locale"],meta[property="og:locale:alternate"]').forEach(node=>node.remove());
    for (const [key,value] of Object.entries({
      'twitter:card':'summary_large_image','twitter:title':pageTitle,'twitter:description':pageDescription,
      'twitter:image':image,'twitter:image:alt':defaults.imageAlt
    })) upsert('name',key,value);
    clearPageLinks();
    if (indexable) {
      setLink('canonical',url);
      for (const languageCode of ['ar','en']) setLink('alternate',canonicalUrl(path,languageCode),{hreflang:languageCode});
      setLink('alternate',canonicalUrl(path,'ar'),{hreflang:'x-default'});
      setLink('describedby',`${SITE_URL}/llms.txt`,{type:'text/plain','data-seo':'true'});
    }
    document.getElementById('profitlens-structured-data')?.remove();
    if (indexable) {
      const graph = buildStructuredData({siteUrl:SITE_URL,title:pageTitle,description:pageDescription,path:publicPagePath(path,language),lang:language});
      if (graph) {
        const script = document.createElement('script');
        script.id='profitlens-structured-data';script.type='application/ld+json';
        script.textContent=serializeStructuredData(graph);
        document.head.appendChild(script);
      }
    }
    return () => {
      document.title=DEFAULT_METADATA.ar.title;
      clearPageLinks();
      document.getElementById('profitlens-structured-data')?.remove();
    };
  }, [title,description,path,noindex,lang]);
  return null;
}
