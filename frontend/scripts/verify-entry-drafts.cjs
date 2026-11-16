const {chromium}=require('../../backend-node/node_modules/playwright');
const assert=require('node:assert/strict');
const {mkdir}=require('node:fs/promises');
// Run from repository root with backend-node/.env.staging loaded. Uses only the demo account.
let browser;
(async()=>{
if(!process.env.SEED_PASSWORD)throw new Error('Local staging SEED_PASSWORD is required');
await mkdir('tmp/draft-recovery',{recursive:true});
browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});
await page.goto('http://localhost:3200/auth-v2');
await page.locator('#v2-email').fill('owner-trial@demo.example.test');
await page.locator('#v2-password').fill(process.env.SEED_PASSWORD);
await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();
await page.getByTestId('business-dashboard').waitFor();
async function section(name){await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();}
async function purchase(){await section('Purchases');await page.getByRole('button',{name:'New receiving',exact:true}).click();await page.getByTestId('local-draft-notice').waitFor();}
await purchase();await page.locator('#supplier-reference').fill('RECOVER-10');await page.locator('#document-notes').fill('Do not lose these ten products');
const products=Array.from({length:10},(_,i)=>({id:`draft-test-${i}`,name:`Recovery product ${i}`,sku:`REC-${i}`,unit:'PIECE',purchasePrice:'2.5000',sellingPrice:'4.0000'}));
await page.route('**/products?state=active*',r=>r.fulfill({json:{items:products,total:10,page:1,pageSize:25}}));
for(let i=0;i<10;i++){await page.getByRole('button',{name:'Select product',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:new RegExp(`Recovery product ${i}`)}).click();await page.locator(`#line-quantity-${i}`).fill(String(i+1));}
await context.setOffline(true);await page.locator('#line-quantity-9').fill('123.45');await page.locator('#document-notes').fill('آخر تعديل بدون إنترنت');
await page.getByText('You are offline; submitting requires internet.',{exact:false}).waitFor();
await context.setOffline(false);await page.reload();await purchase();
assert.equal(await page.locator('[id^="line-quantity-"]').count(),10);assert.equal(await page.locator('#line-quantity-9').inputValue(),'123.45');assert.equal(await page.locator('#document-notes').inputValue(),'آخر تعديل بدون إنترنت');
await page.getByText('Your unfinished work was restored.',{exact:false}).waitFor();
for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({animations:'disabled',path:`tmp/draft-recovery/after-receipt-en-${width}.png`,fullPage:true});}
await page.evaluate(()=>localStorage.setItem('profitlens_lang','ar'));await page.reload();
await page.getByRole('navigation').getByRole('button',{name:'المشتريات',exact:true}).click();

await page.getByRole('button',{name:'استلام جديد',exact:true}).click();assert.equal(await page.locator('#line-quantity-9').inputValue(),'123.45');
for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});await page.getByTestId('local-draft-notice').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({animations:'disabled',path:`tmp/draft-recovery/after-receipt-ar-${width}.png`});}
await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));await page.reload();
async function product(){await section('Products');await page.getByRole('button',{name:'Add product',exact:true}).click();await page.locator('#product-name').waitFor();}
await product();await page.locator('#product-name').fill('Unfinished product');await page.locator('#product-sku').fill('RECOVER-SKU');await page.locator('#product-sellingPrice').fill('12.50');await page.locator('#product-purchasePrice').fill('8.75');
await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();await product();assert.equal(await page.locator('#product-name').inputValue(),'Unfinished product');
// Failed requests retain drafts; a successful server response clears them.
await page.route('**/api/businesses/*/products',r=>r.request().method()==='POST'?r.abort():r.continue());
await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor();await page.reload();await product();assert.equal(await page.locator('#product-sku').inputValue(),'RECOVER-SKU');
for(const lang of ['en','ar']){if(lang==='ar'){await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();await page.evaluate(()=>localStorage.setItem('profitlens_lang','ar'));await page.reload();await section('المنتجات');await page.getByRole('button',{name:'إضافة منتج',exact:true}).click();}for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({animations:'disabled',path:`tmp/draft-recovery/after-product-${lang}-${width}.png`});}}
await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));await page.reload();await product();
// A separate account or business never restores the current account's draft.
const original=await page.evaluate(()=>Object.entries(localStorage).find(([k])=>k.startsWith('profitendo:entry:v1:')&&JSON.parse(k.slice('profitendo:entry:v1:'.length))[3]==='product:new:0'));
assert(original);const parsed=JSON.parse(original[0].slice('profitendo:entry:v1:'.length));parsed[1]='another-member';
await page.evaluate(({original,other})=>{localStorage.setItem(other,original[1]);localStorage.removeItem(original[0]);},{original,other:'profitendo:entry:v1:'+JSON.stringify(parsed)});await page.reload();await product();assert.equal(await page.locator('#product-name').inputValue(),'');
await page.evaluate(original=>localStorage.setItem(...original),original);await page.reload();await product();
// A second tab cannot silently overwrite a newer saved draft.
const second=await context.newPage();await second.goto('http://localhost:3200/business-v2');await second.getByRole('navigation').getByRole('button',{name:'Products',exact:true}).click();await second.getByRole('button',{name:'Add product',exact:true}).click();await page.locator('#product-name').fill('First tab latest');await second.locator('#product-name').fill('Second tab conflict');await second.getByTestId('local-draft-notice').getByRole('alert').waitFor();assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).values.form.name,original[0]),'First tab latest');await second.close();
// Quota failure must be visible, with no false saved status.
await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('profitendo:entry:v1:'))throw new DOMException('Full','QuotaExceededError');return window.originalSetItem.call(this,k,v);};});await page.locator('#product-name').fill('Storage full');await page.getByTestId('local-draft-notice').getByRole('alert').waitFor();await page.evaluate(()=>Storage.prototype.setItem=window.originalSetItem);await page.locator('#product-name').fill('Storage recovered');await page.getByTestId('local-draft-notice').getByRole('status').waitFor();
await page.unroute('**/api/businesses/*/products');await page.route('**/api/businesses/*/products',r=>r.request().method()==='POST'?r.fulfill({json:{id:'fixture-only'}}):r.continue());await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await product();assert.equal(await page.locator('#product-name').inputValue(),'');
await page.locator('#product-name').fill('Discard me');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Discard draft',exact:true}).click();assert.equal(await page.locator('#product-name').inputValue(),'');await page.reload();await product();assert.equal(await page.locator('#product-name').inputValue(),'');
await browser.close();assert.deepEqual(errors,[]);console.log('PASS: ten-line offline recovery, modal close/reopen, failed/successful saves, account isolation, cross-tab conflict, quota failure/recovery, discard, AR/EN 320/768/1024/1440.');
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1;});
