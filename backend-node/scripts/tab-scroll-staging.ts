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
 await page.getByRole('navigation').getByRole('button',{name:'Business settings',exact:true}).click();await page.getByTestId('tab-preferences').waitFor();
 await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));assert(await page.evaluate(()=>window.scrollY>0));
 await page.getByRole('navigation').getByRole('button',{name:'Inventory',exact:true}).click();await page.waitForFunction(()=>window.scrollY===0);assert.equal(await page.evaluate(()=>window.scrollY),0);
 await page.goto(origin+'/business-v2?tab=security');await page.getByTestId('account-security').getByRole('button',{name:'Sign out',exact:true}).click();console.log('PASS: tab selection scrolls to top.');
}finally{await browser.close();}
