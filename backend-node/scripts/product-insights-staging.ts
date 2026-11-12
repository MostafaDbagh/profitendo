import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createDatabase} from '../src/database.js';
import {passwordHash} from '../src/auth/crypto.js';
import {stagingTarget} from '../src/staging/guard.js';
stagingTarget(process.env);assert.equal(process.env.APP_ORIGIN,'http://localhost:3200');
const db=createDatabase(process.env.DATABASE_URL!),id=randomUUID(),bid=randomUUID(),email=`mfa-check-${id}@example.test`,password='Test only '+randomUUID();
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await mkdir('../tmp/mfa-settings-design',{recursive:true});
try{
 await db.authUser.create({data:{id,email,name:'MFA test',passwordHash:await passwordHash(password),emailVerifiedAt:new Date()}});
 await db.business.create({data:{id:bid,name:'MFA temporary test'}});await db.membership.create({data:{userId:id,businessId:bid,role:'OWNER'}});
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});
 await page.goto('http://localhost:3200/auth-v2',{waitUntil:'domcontentloaded'});await page.locator('#v2-email').fill(email);await page.locator('#v2-password').fill(password);await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();await page.getByTestId('business-dashboard').waitFor();
 const location=await db.location.create({data:{businessId:bid,name:'Test warehouse',code:'TEST',kind:'WAREHOUSE'}});
 const product=await db.product.create({data:{businessId:bid,name:'Stock alert test',sku:'ALERT-TEST',unit:'PIECE',purchasePrice:'2',sellingPrice:'4',minimumStock:'5'}});
 await db.stockBalance.create({data:{businessId:bid,locationId:location.id,productId:product.id,onHand:'3',reserved:'1'}});
 await page.goto('http://localhost:3200/business-v2?tab=catalogue');await page.getByRole('cell',{name:'Stock alert test',exact:true}).waitFor();const row=page.getByRole('row').filter({hasText:'Stock alert test'});assert(await row.locator('.bg-red-50').count());assert.equal(await row.locator('td').nth(1).innerText(),'0');assert((await row.locator('td').nth(2).innerText()).startsWith('3'));assert((await row.innerText()).includes('Available stock: 2'));
 await page.locator('#catalogue-filter').selectOption('low');await page.getByRole('cell',{name:'Stock alert test',exact:true}).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export all results CSV',exact:true}).click();assert.equal((await download).suggestedFilename(),'products.csv');
 await page.locator('#catalogue-filter').selectOption('top');await page.getByRole('cell',{name:'Nothing here yet.',exact:true}).waitFor();
 for(const lang of ['en','ar']){await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await page.goto('http://localhost:3200/business-v2?tab=catalogue');await page.getByRole('cell',{name:'Stock alert test',exact:true}).waitFor();for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.locator('main').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`../tmp/mfa-settings-design/products-${lang}-${width}.png`});}}
 await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));await page.goto('http://localhost:3200/business-v2?tab=locations');await page.getByRole('cell',{name:'Test warehouse',exact:true}).waitFor();await page.getByLabel('Search current page',{exact:true}).fill('missing');await page.getByRole('cell',{name:'Nothing here yet.',exact:true}).waitFor();await page.getByLabel('Search current page',{exact:true}).fill('Test');await page.getByLabel('Filter by',{exact:true}).selectOption('0');await page.getByLabel('Value',{exact:true}).selectOption('Test warehouse');const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Export this page’s results CSV',exact:true}).click();assert.equal((await exported).suggestedFilename(),'visible-results.csv');
 console.log('PASS: low-stock row, product filters/export, shared table search/filter/export, AR/EN desktop/mobile.');
}finally{await browser.close();await db.stockBalance.deleteMany({where:{businessId:bid}});await db.product.deleteMany({where:{businessId:bid}});await db.location.deleteMany({where:{businessId:bid}});await db.authAudit.deleteMany({where:{userId:id}});await db.business.deleteMany({where:{id:bid}});await db.authUser.deleteMany({where:{id}});await db.$disconnect();}
