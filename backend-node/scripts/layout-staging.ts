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
 for(const lang of ['en','ar']){await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await page.goto(origin+'/business-v2?tab=dashboard');await page.getByTestId('business-dashboard').locator('dd').first().waitFor();
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`../tmp/tab-order-design/layout-${lang}-${width}.png`});}
 }
 assert.equal(errors.length,0);console.log('PASS: dashboard AR/EN at mobile/tablet/desktop with no page overflow or errors.');
}finally{await browser.close();}
