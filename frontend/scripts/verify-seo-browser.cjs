// Uses the repository's existing browser test dependency; no browser needed by build.
const {chromium}=require('../../backend-node/node_modules/playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../build');
const publicRoutes=['/','/features','/pricing','/about','/en','/en/features','/en/pricing','/en/about'];
(async()=>{
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=publicRoutes.includes(pathname)?pathname==='/'?'/index.html':`${pathname}/index.html`:/^\/(auth|business|billing-v2|platform-v2|contact)$/.test(pathname)?'/app.html':pathname;
  if(file.includes('..')){res.writeHead(400).end();return;}
  try{const body=await fs.readFile(path.join(root,file));res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'text/plain');if(file==='/app.html')res.setHeader('X-Robots-Tag','noindex, nofollow');res.end(body);}catch{res.writeHead(404,{'Content-Type':'text/html'});res.end(await fs.readFile(path.join(root,'404.html')));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:1440,height:1000}}),page=await context.newPage();
  await fs.mkdir(path.resolve(__dirname,'../../tmp/seo-static'),{recursive:true});
  for(const route of publicRoutes){
   const response=await page.goto(origin+route);assert.equal(response.status(),200);assert.equal(await page.locator('h1').count(),1);assert((await page.locator('h1').innerText()).trim());assert.equal(await page.locator('meta[property="og:title"]').count(),1);
   if(route==='/'||route==='/en'){const question=page.getByTestId('lp-faq-q-5');await question.click();await page.getByTestId('lp-faq-a-5').waitFor({state:'visible'});await page.screenshot({path:path.resolve(__dirname,`../../tmp/seo-static/${route==='/'?'ar':'en'}-no-javascript.png`),fullPage:true});}
  }
  const response=await page.goto(origin+'/unknown');assert.equal(response.status(),404);assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex, nofollow');
  const privatePage=await page.goto(origin+'/business');assert.equal(privatePage.headers()['x-robots-tag'],'noindex, nofollow');assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex, nofollow');
  await context.close();
  const live=await browser.newPage();const errors=[];live.on('pageerror',e=>errors.push(e.message));await live.goto(origin+'/en/features');await live.getByTestId('lp-lang-toggle').click();await live.waitForURL(origin+'/features');await live.waitForFunction(()=>document.documentElement.lang==='ar');assert.deepEqual(errors,[]);
  console.log('PASS: raw HTTP 8 public routes, no-JavaScript visible content/native FAQ, private/404 noindex fixture, live locale navigation.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
