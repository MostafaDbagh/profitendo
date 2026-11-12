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
 await page.getByRole('navigation').getByRole('button',{name:'Business settings',exact:true}).click();const form=page.getByTestId('tab-preferences');await form.waitFor();
 assert.deepEqual((await page.getByRole('navigation').getByRole('button').allTextContents()).slice(-2),['Account security','Business settings']);
 const originalOrder=await form.locator('[data-tab-key]').evaluateAll(els=>els.map(el=>el.getAttribute('data-tab-key')!));
 const original=await form.getByRole('checkbox').evaluateAll(els=>els.map(el=>(el as HTMLInputElement).checked));
 async function save(){const response=page.waitForResponse(r=>r.url().endsWith('/preferences')&&r.request().method()==='PATCH');await form.getByRole('button',{name:'Save changes',exact:true}).click();assert.equal((await response).status(),200);}
 try{
  assert.deepEqual(await form.locator('[data-tab-key] > span').allTextContents(),originalOrder.map((_,i)=>String(i+1)));
  await form.getByRole('button',{name:'Move up: Dashboard & reports',exact:true}).click();
  assert.equal(await form.locator('[data-tab-key="reports"] > span').innerText(),'1');
  await form.getByRole('checkbox',{name:'Sales',exact:true}).uncheck();await form.getByRole('checkbox',{name:'Warehouses & shops',exact:true}).uncheck();await save();
  await page.reload();await form.waitFor();assert.equal(await page.getByRole('navigation').getByRole('button').first().innerText(),'Dashboard & reports');assert.equal(await form.getByRole('checkbox',{name:'Sales',exact:true}).isChecked(),false);assert.equal(await page.getByRole('navigation').getByRole('button',{name:'Sales',exact:true}).count(),0);
  for(const label of ['Dashboard Always available','Account security Pinned to bottom','Business settings Pinned to bottom'])assert(await form.getByRole('checkbox',{name:label,exact:true}).isDisabled());
  await page.goto(origin+'/business-v2?tab=sales');await page.getByTestId('business-dashboard').waitFor();assert.equal(await page.locator('main').getByRole('button',{name:'Sales',exact:true}).count(),0);
  for(const lang of ['en','ar']){
   await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await page.goto(origin+'/business-v2?tab=settings');await form.waitFor();
   for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:1000});await form.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${folder}/${lang}-${width}.png`,animations:'disabled'});}
  }
 }finally{
  await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));await page.goto(origin+'/business-v2?tab=settings');await form.waitFor();
  for(const key of [...originalOrder].reverse()){
   const row=form.locator(`[data-tab-key="${key}"]`);const up=row.getByRole('button').first();while(await up.isEnabled())await up.click();
  }
  for(let i=0;i<original.length;i++){const input=form.getByRole('checkbox').nth(i);if(!await input.isDisabled())await input.setChecked(original[i]!);}
  await save();
 }
 assert.deepEqual(errors,[]);
 await page.goto(origin+'/business-v2?tab=security');await page.getByTestId('account-security').getByRole('button',{name:'Sign out',exact:true}).click();
 console.log('PASS: save, refresh, hidden links, protected tabs, AR/EN at five widths; original choices restored.');
}finally{await browser.close();}
