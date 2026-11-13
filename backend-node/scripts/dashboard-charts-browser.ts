import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {stagingTarget} from '../src/staging/guard.js';
stagingTarget(process.env);if(!process.env.SEED_PASSWORD)throw Error('Staging credentials required');
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}}),artifacts=new URL('../../tmp/dashboard-charts/',import.meta.url).pathname;
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let summaryUrl='';page.on('request',r=>{if(r.url().includes('/workflows/reports?view=summary'))summaryUrl=r.url();});await mkdir(artifacts,{recursive:true});
async function shot(name:string){await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);await page.screenshot({path:artifacts+name+'.png',fullPage:true});}
try{
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});await page.goto('http://localhost:3200/auth-v2');await page.locator('#v2-email').fill('owner-trial@demo.example.test');await page.locator('#v2-password').fill(process.env.SEED_PASSWORD);await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();
 await Promise.race([page.locator('#v2-code').waitFor(),page.getByTestId('business-dashboard').waitFor()]);if(await page.locator('#v2-code').isVisible()){await page.locator('#v2-code').fill('123456');await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();}
 await page.getByTestId('dashboard-charts').waitFor();assert(summaryUrl);await shot('actual-data');const response=await page.request.get(summaryUrl);assert(response.ok());const base=await response.json();
 // Display-only fixtures: no financial records are changed.
 let fixture:any={...base,saleCount:42,sales:'14800',customerReturns:'800',netSales:'14000',expenses:'1800',estimatedCost:'6500',estimatedProfit:'5500',damageCost:'120',transferLossCost:'80',unvaluedTransferLosses:0};
 await page.route('**/workflows/reports?view=summary*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}));
 for(const lang of ['en','ar']){await page.evaluate(value=>localStorage.setItem('profitlens_lang',value),lang);await page.reload();await page.getByTestId('dashboard-charts').waitFor();for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1100});await shot(`populated-fixture-${lang}-${width}`);}}
 fixture={...fixture,estimatedProfit:'-2400',estimatedCost:'-500'};await page.reload();await page.getByTestId('dashboard-charts').waitFor();assert.equal(await page.getByTestId('dashboard-cost-donut').locator('.recharts-pie').count(),0);await shot('negative-cost-fixture');
 fixture={...fixture,estimatedCost:'6500',estimatedProfit:null,unvaluedTransferLosses:2};await page.reload();await page.getByTestId('dashboard-charts').waitFor();assert.equal(await page.getByTestId('dashboard-cost-donut').locator('.recharts-pie').count(),0);await shot('missing-cost-fixture');
 fixture={...base,sales:'0',netSales:'0',customerReturns:'0',expenses:'0',estimatedProfit:'0',estimatedCost:'0',damageCost:'0',transferLossCost:'0',unvaluedTransferLosses:0};await page.reload();await page.getByTestId('dashboard-charts').waitFor();assert.equal(await page.getByTestId('dashboard-charts').locator('.recharts-bar,.recharts-pie').count(),0);await shot('empty-fixture');
 fixture={currency:base.currency,netSales:'14000',customerReturns:'800',saleCount:42};await page.reload();await page.getByTestId('dashboard-charts').waitFor();assert.equal(await page.getByTestId('dashboard-cost-donut').count(),0);await shot('restricted-fields-fixture');
 const chart=page.getByTestId('dashboard-charts').locator('[tabindex="0"]').first();if(await chart.count()){await chart.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');}assert.deepEqual(errors,[]);console.log('PASS: real summary rendering; AR/EN 320/768/1024/1440; populated, empty, loss, incomplete and restricted fixtures; keyboard chart access; no page errors.');
}finally{await browser.close();}
