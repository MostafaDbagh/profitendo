import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();const phase=process.env.CAPTURE_PHASE??'after';
try{for(const lang of ['ar','en']){
 await page.goto('http://localhost:3200/auth-v2');await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await page.reload();
 const input=page.locator('#v2-password');await input.waitFor();
 for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`../tmp/password-toggle/${phase}-${lang}-${width}.png`,fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 if(phase==='after'){
  await input.fill('Example-password-only');const show=page.getByRole('button',{name:lang==='ar'?'إظهار كلمة المرور':'Show password',exact:true});await show.click();assert.equal(await input.getAttribute('type'),'text');assert.equal(await input.inputValue(),'Example-password-only');
  const hide=page.getByRole('button',{name:lang==='ar'?'إخفاء كلمة المرور':'Hide password',exact:true});await hide.focus();await page.keyboard.press('Enter');assert.equal(await input.getAttribute('type'),'password');assert(page.url().endsWith('/auth-v2'));
 }
}console.log(`PASS: ${phase} AR/EN desktop/mobile and password toggle checks`);}finally{await browser.close();}
