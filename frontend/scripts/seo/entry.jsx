import {renderToString} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {StaticLanguage} from './language';
import Landing from '../../src/pages/Landing';
import Features from '../../src/pages/FeaturesPage';
import Pricing from '../../src/pages/PricingPage';
import About from '../../src/pages/AboutPage';
import {translations} from '../../src/i18n';
import {SITE_URL,SITE_NAME,SOCIAL_IMAGE,DEFAULT_METADATA,PUBLIC_PATHS,canonicalUrl,publicPagePath} from '../../src/lib/siteMetadata';
import {buildStructuredData,serializeStructuredData} from '../../src/lib/structuredData';
export {SITE_URL,SITE_NAME,SOCIAL_IMAGE,DEFAULT_METADATA,PUBLIC_PATHS,canonicalUrl,publicPagePath,buildStructuredData,serializeStructuredData};
export function renderPage(path,lang){
 const [Page,key]=({'/':[Landing,'Home'],'/features':[Features,'Features'],'/pricing':[Pricing,'Pricing'],'/about':[About,'About']})[path];
 const title=translations[lang][`seo${key}Title`],description=translations[lang][`seo${key}Desc`];
 return {title,description,markup:renderToString(<MemoryRouter initialEntries={[publicPagePath(path,lang)]}><StaticLanguage lang={lang}><Page/></StaticLanguage></MemoryRouter>)};
}
