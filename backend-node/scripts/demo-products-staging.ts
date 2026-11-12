import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { stagingTarget } from '../src/staging/guard.js';
stagingTarget(process.env);
assert.equal(process.env.APP_ORIGIN,'http://localhost:3200');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
const origin=process.env.APP_ORIGIN!;
const folder='../tmp/tab-order-design';await mkdir(folder,{recursive:true});
try {
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});
 await page.goto(origin+'/auth-v2',{waitUntil:'domcontentloaded',timeout:60000});await page.locator('#v2-email').fill('owner-trial@demo.example.test');await page.locator('#v2-password').fill(process.env.SEED_PASSWORD!);await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();await page.locator('#v2-code').fill('123456');await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();await page.getByTestId('business-dashboard').waitFor();
 await page.goto(origin+'/business-v2?tab=catalogue');await page.getByRole('cell',{name:'تجريبي · أرز بسمتي 1 كغ',exact:true}).waitFor();assert.equal(await page.locator('main tbody tr').count(),15);const rice=page.getByRole('row').filter({hasText:'DEMO-P001'});assert.equal(await rice.locator('td').nth(1).innerText(),'12');assert((await rice.locator('td').nth(2).innerText()).startsWith('0'));
 await page.locator('#catalogue-filter').selectOption('top');await page.waitForFunction(()=>document.querySelectorAll('main tbody tr').length===10);
 await page.locator('#catalogue-filter').selectOption('low');await page.waitForFunction(()=>document.querySelectorAll('main tbody tr').length===4);assert.equal(await page.locator('main tbody .bg-red-50').count(),4);
 await page.goto(origin+'/business-v2?tab=security');await page.getByTestId('account-security').getByRole('button',{name:'Sign out',exact:true}).click();console.log('PASS: 15 products, top 10 populated, 4 red low-stock alerts.');
}finally{await browser.close();}
