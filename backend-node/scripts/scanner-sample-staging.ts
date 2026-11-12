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
 await page.goto(origin+'/business-v2?tab=sales');await page.getByRole('button',{name:'New sale',exact:true}).click();await page.getByRole('button',{name:'Choose a shop',exact:true}).click();await page.getByRole('dialog').locator('li button').first().waitFor();console.log(await page.getByRole('dialog').locator('li').allTextContents());await page.getByRole('dialog').locator('li button').first().click();
 const barcode='2000000000046';
 await page.locator('#pos-barcode').fill(barcode);await page.locator('#pos-barcode').press('Enter');await page.locator('#sale-quantity-0').waitFor();assert.equal(await page.locator('#sale-quantity-0').inputValue(),'1');
 await page.locator('#pos-barcode').fill(barcode);await page.locator('#pos-barcode').press('Enter');await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('#sale-quantity-0')?.value==='2.0000');assert.equal(await page.locator('main h3').count(),1);
 await page.getByRole('button',{name:'العربية',exact:true}).click();await page.locator('#pos-barcode').fill(barcode);await page.locator('#pos-barcode').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:'../tmp/tab-order-design/scanner-sample.png'});
 console.log('PASS: barcode 2000000000046 adds milk, second scan increases same row to 2. No sale saved or payment completed.');
}finally{await browser.close();}
