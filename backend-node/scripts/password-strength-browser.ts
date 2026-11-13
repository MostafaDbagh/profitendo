import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),dir=new URL('../../tmp/password-strength/',import.meta.url).pathname,errors:string[]=[];
await mkdir(dir,{recursive:true});page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});
 await page.goto('http://localhost:3200/auth?mode=register');const password=page.locator('#v2-password'),strength=page.getByTestId('password-strength');await password.waitFor();
 assert.equal(await password.getAttribute('minlength'),'8');assert.equal(await password.getAttribute('maxlength'),'128');assert.equal(await strength.count(),1);
 for(const [value,label] of [['abc','Weak'],['12345678','Weak'],['A7!bcD9x','Good'],['River!Cloud94','Strong']]){await password.fill(value!);assert.equal(await strength.locator('strong').innerText(),label);}
 await password.fill('A7!bcD9x');assert(await password.evaluate((el:HTMLInputElement)=>el.checkValidity()));
 await page.getByRole('button',{name:'Show password',exact:true}).first().click();assert.equal(await password.getAttribute('type'),'text');await page.getByRole('button',{name:'Hide password',exact:true}).click();assert.equal(await password.getAttribute('type'),'password');
 for(const lang of ['en','ar']){
  await page.evaluate(value=>localStorage.setItem('profitlens_lang',value),lang);await page.reload();await password.fill('River!Cloud94');
  for(const width of [320,768,1440]){await page.setViewportSize({width,height:1100});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${dir}/${lang}-${width}.png`,fullPage:true});}
 }
 await page.goto('http://localhost:3200/auth');await page.locator('#v2-password').waitFor();assert.equal(await strength.count(),0);assert.deepEqual(errors,[]);console.log('PASS: 8–128 characters, live weak/good/strong guidance, show/hide password, AR/EN 320/768/1440, no strength meter on login, no page errors.');
}finally{await browser.close();}
