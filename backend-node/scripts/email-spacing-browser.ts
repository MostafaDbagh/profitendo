import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
await mkdir('../tmp/email-spacing',{recursive:true});
try{for(const lang of ['ar','en']){
 await page.goto('http://localhost:3200/auth-v2');await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await page.reload();
 const input=page.locator('#v2-email');await input.waitFor();
 for(const width of [390,1440]){await page.setViewportSize({width,height:1000});for(const filled of [false,true]){
 await input.fill(filled?'owner-trial@demo.example.test':'');
 const padding=await input.evaluate((el,lang)=>{const css=getComputedStyle(el);return parseFloat(lang==='ar'?css.paddingRight:css.paddingLeft);},lang);assert(padding>=40,`Icon padding ${padding}`);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await input.locator('..').screenshot({path:`../tmp/email-spacing/${lang}-${width}-${filled?'value':'placeholder'}.png`});
 }}
}console.log('PASS: AR/EN placeholder and entered email have 40px icon clearance, desktop/mobile.');}finally{await browser.close();}
