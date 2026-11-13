const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
(async()=>{
 const routes=['/','/features','/pricing','/about','/en','/en/features','/en/pricing','/en/about'];
 const titles=new Set();
 for(const route of routes){
  const html=await fs.readFile(path.join(root,'build',route==='/'?'index.html':`${route.slice(1)}/index.html`),'utf8');
  const en=route==='/en'||route.startsWith('/en/');
  assert(html.includes(`<html lang="${en?'en':'ar'}" dir="${en?'ltr':'rtl'}">`),route);
  for(const attribute of ['name="description"','name="robots"','property="og:title"','property="og:description"','property="og:url"','property="og:image"','name="twitter:card"','rel="canonical"'])assert.equal(html.split(attribute).length-1,1,`${route} ${attribute}`);
  const canonical=`https://profitendo.com${route}`;
  assert(html.includes(`rel="canonical" href="${canonical}"`),route);
  assert(html.includes('name="twitter:card" content="summary_large_image"'));
  assert(html.includes('content="https://profitendo.com/social/profitlens-og.png"'));
  assert.equal((html.match(/<h1\b/g)||[]).length,1,`${route} h1`);
  assert(html.includes('index, follow, max-image-preview:large'));
  assert(!html.includes('content="undefined"'));
  assert((html.match(/hreflang="/g)||[]).length>=3);
  const title=html.match(/<title>(.*?)<\/title>/)[1];assert(title.length>10);titles.add(title);
  const graph=JSON.parse(html.match(/<script id="profitlens-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert(graph['@graph'].some(node=>node.url===canonical&&['WebPage','AboutPage'].includes(node['@type'])));
  assert(html.includes('data-testid="lp-nav"'));assert(html.includes('data-testid="lp-footer"'));
  if(route==='/'||route==='/en'||route.endsWith('/pricing'))assert.equal((html.match(/data-testid="lp-faq-a-\d"/g)||[]).length,6);
 }
 assert.equal(titles.size,8,'Distinct localized page titles');
 for(const file of ['app.html','404.html']){const html=await fs.readFile(path.join(root,'build',file),'utf8');assert(html.includes('noindex, nofollow'));assert(!html.includes('rel="canonical"'));assert(!html.includes('application/ld+json'));}
 const sitemap=await fs.readFile(path.join(root,'build/sitemap.xml'),'utf8');assert.equal((sitemap.match(/<loc>/g)||[]).length,8);assert(!sitemap.includes('<lastmod>'));assert(!sitemap.includes('/auth'));
 const handlers={},store=new Map(),cache={put:async(key,response)=>store.set(typeof key==='string'?key:key.url,response.clone()),addAll:async()=>{}};
 let online=true,status=200;
 const sandbox={URL,Response,Set,self:{location:{origin:'https://profitendo.com'},clients:{claim:async()=>{}},skipWaiting(){},addEventListener:(type,fn)=>handlers[type]=fn},caches:{open:async()=>cache,match:async key=>store.get(typeof key==='string'?key:key.url)?.clone(),keys:async()=>[],delete:async()=>true},fetch:async request=>{if(!online)throw Error('offline');return new Response(request.url,{status,headers:{'content-type':'text/html'}});}};
 vm.runInNewContext(await fs.readFile(path.join(root,'public/service-worker.js'),'utf8'),sandbox);
 async function navigate(route){let response;handlers.fetch({request:{method:'GET',mode:'navigate',url:`https://profitendo.com${route}`},respondWith:p=>response=p});return response&&await response;}
 await navigate('/en');assert(store.has('/en'));assert(!store.has('/index.html'));
 await navigate('/auth?token=secret');await navigate('/?token=secret');assert.equal(store.size,1);
 status=404;await navigate('/about');assert(!store.has('/about'));status=200;
 let touched=false;handlers.fetch({request:{method:'GET',mode:'navigate',url:'https://profitendo.com/api/auth/me'},respondWith:()=>touched=true});assert(!touched);
 store.set('/app.html',new Response('generic private shell'));online=false;
 assert.equal(await(await navigate('/en')).text(),'https://profitendo.com/en');
 assert.equal((await navigate('/about')).status,503);
 assert.equal(await(await navigate('/business')).text(),'generic private shell');
 assert.equal((await navigate('/unknown')).status,503);
 console.log('PASS: 8 raw HTML pages, metadata/hreflang/JSON-LD, noindex shells, sitemap, and service-worker cache isolation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
