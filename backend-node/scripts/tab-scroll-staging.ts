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
 await page.route('**/api/businesses/*/suppliers?*',async route=>{await new Promise(resolve=>setTimeout(resolve,450));await route.continue();});
 for(const language of ['en','ar']){
 await page.evaluate(lang=>localStorage.setItem('profitlens_lang',lang),language);await page.goto(origin+'/business-v2?tab=sales');
 for(const width of [1440,390]){
 await page.setViewportSize({width,height:900});
 for(const name of ['Suppliers','Business settings','Suppliers','Suppliers']){
 const label=language==='ar'?({'Suppliers':'الموردون','Business settings':'إعدادات النشاط'}[name]||name):name;const button=page.getByRole('navigation').getByRole('button',{name:label,exact:true});await button.scrollIntoViewIfNeeded();await button.click();await page.waitForTimeout(1200);console.log(name,width,await page.evaluate(()=>({y:scrollY,body:document.body.scrollTop,html:document.documentElement.scrollTop,active:document.activeElement?.textContent?.slice(0,50)})));assert.equal(await page.evaluate(()=>window.scrollY),0);assert(await page.evaluate(()=>document.activeElement?.tagName==='MAIN'));
 }
 }
 }
 await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));await page.goto(origin+'/business-v2?tab=suppliers');
 await page.evaluate(()=>{const root=document.getElementById('root')!;root.style.height='600px';root.style.overflow='auto';});
 await page.getByRole('navigation').getByRole('button',{name:'Invitations',exact:true}).click();await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>document.getElementById('root')!.scrollTop),0);
 await page.evaluate(()=>{document.getElementById('root')!.removeAttribute('style');});
 await page.goto(origin+'/business-v2?tab=security');await page.getByTestId('account-security').getByRole('button',{name:'Sign out',exact:true}).click();console.log('PASS: tab selection scrolls to top.');
}finally{await browser.close();}
