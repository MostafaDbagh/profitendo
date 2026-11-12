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
 await page.evaluate(()=>localStorage.setItem('profitlens_lang','ar'));await page.goto(origin+'/business-v2');await page.getByTestId('business-dashboard').waitFor();
 const labels=await page.getByRole('navigation').getByRole('button').allTextContents();const start=labels.indexOf('لوحة المتابعة والتقارير');assert.deepEqual(labels.slice(start+1,start+8),['المنتجات','المبيعات','المشتريات','المخزون','المرتجعات','المصروفات','الخزينة']);
 await page.getByRole('navigation').getByRole('button',{name:'المصروفات',exact:true}).click();await page.locator('main h2').filter({hasText:'المصروفات'}).waitFor();
 for(const width of [390,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${folder}/simple-nav-${width}.png`,fullPage:true});}
 await page.getByRole('button',{name:'تسجيل دفعة',exact:true}).click();assert.deepEqual(await page.locator('#money-kind option').evaluateAll(els=>els.map(el=>(el as HTMLOptionElement).value)),['EXPENSE']);
 await page.goto(origin+'/business-v2?tab=security');await page.getByTestId('account-security').getByRole('button',{name:'تسجيل الخروج',exact:true}).click();assert.deepEqual(errors,[]);console.log('PASS: requested labels/order, expenses-only form, mobile and desktop.');
}finally{await browser.close();}
