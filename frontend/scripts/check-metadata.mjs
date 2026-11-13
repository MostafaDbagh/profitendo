import assert from 'node:assert/strict';
import {chromium} from '../../backend-node/node_modules/playwright/index.mjs';

const origin=process.env.SEO_TEST_ORIGIN || 'http://localhost:3200';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 for(const lang of ['ar','en'])for(const base of ['/','/features','/pricing','/about']){
  const path=lang==='en'?`/en${base==='/'?'':base}`:base;
  await page.goto(`${origin}${path}?utm_source=metadata-check`);
  await page.waitForFunction(expected=>document.documentElement.lang===expected&&document.head.querySelector('link[rel="canonical"]')?.href===`https://profitendo.com${location.pathname}`,lang);
  const metadata=await page.evaluate(()=>({
   title:document.title,description:document.querySelector('meta[name="description"]')?.content,
   properties:Object.fromEntries([...document.querySelectorAll('meta[property]')].map(el=>[el.getAttribute('property'),el.content])),
   names:Object.fromEntries([...document.querySelectorAll('meta[name]')].map(el=>[el.name,el.content])),
   alternates:Object.fromEntries([...document.querySelectorAll('link[hreflang]')].map(el=>[el.hreflang,el.href])),
   canonicals:document.querySelectorAll('link[rel="canonical"]').length,
   descriptions:document.querySelectorAll('meta[name="description"]').length,
   schemas:document.querySelectorAll('#profitlens-structured-data').length,
   graph:JSON.parse(document.querySelector('#profitlens-structured-data').textContent)
  }));
  assert.equal(metadata.canonicals,1);assert.equal(metadata.descriptions,1);assert.equal(metadata.schemas,1);
  const webpage=metadata.graph['@graph'].find(node=>['WebPage','AboutPage'].includes(node['@type']));
  assert.equal(webpage.url,`https://profitendo.com${path}`);assert.equal(webpage.inLanguage,lang);
  assert(metadata.title&&metadata.description&&!metadata.description.includes('undefined'));
  assert.equal(metadata.properties['og:title'],metadata.title);assert.equal(metadata.names['twitter:title'],metadata.title);
  assert.equal(metadata.properties['og:description'],metadata.description);assert.equal(metadata.names['twitter:description'],metadata.description);
  assert.equal(metadata.properties['og:url'],`https://profitendo.com${path}`);
  assert.equal(metadata.properties['og:image'],'https://profitendo.com/social/profitlens-og.png');
  assert.equal(metadata.properties['og:image:width'],'1200');assert.equal(metadata.properties['og:image:height'],'630');
  assert(metadata.properties['og:image:alt']);assert.equal(metadata.names['twitter:image:alt'],metadata.properties['og:image:alt']);
  assert.equal(metadata.alternates.ar,`https://profitendo.com${base}`);
  assert.equal(metadata.alternates.en,`https://profitendo.com/en${base==='/'?'':base}`);
  assert.equal(metadata.alternates['x-default'],metadata.alternates.ar);
  assert(!metadata.names.robots.includes('noindex'));
 }
 await page.goto(`${origin}/en/features`);await page.getByTestId('lp-lang-toggle').click();await page.waitForURL('**/features');
 await page.waitForFunction(()=>document.documentElement.lang==='ar'&&document.querySelector('link[rel="canonical"]')?.href==='https://profitendo.com/features');
 await page.goto(`${origin}/auth-v2`);await page.waitForFunction(()=>document.querySelector('meta[name="robots"]')?.content.includes('noindex'));
 assert.equal(await page.locator('link[rel="canonical"],link[hreflang],#profitlens-structured-data').count(),0);
 assert.notEqual(await page.locator('meta[name="description"]').getAttribute('content'),'undefined');
 const image=await page.evaluate(async()=>{const img=new Image();img.src='/social/profitlens-og.png';await img.decode();return {width:img.naturalWidth,height:img.naturalHeight};});
 assert.deepEqual(image,{width:1200,height:630});
 assert.deepEqual(errors,[]);
 console.log('PASS: 8 localized public routes, canonical/alternate URLs, OG/Twitter metadata, deduplication, language navigation and private noindex cleanup.');
}finally{await browser.close();}
