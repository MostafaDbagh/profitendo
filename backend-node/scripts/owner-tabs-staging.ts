import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {stagingTarget} from '../src/staging/guard.js';
stagingTarget(process.env);
if(process.env.APP_ORIGIN!=='http://localhost:3200'||process.env.AUTH_MOCK_OTP!=='true')throw new Error('Local staging preview only');
const tabs=['dashboard','security','reports','returns','counts','payments','migration','sales','transfers','inventory','suppliers','purchases','catalogue','locations','settings','billing','team','roles','invitations','audit'];
const artifacts=new URL('../../tmp/owner-tabs-audit/',import.meta.url).pathname;await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),results:object[]=[],errors:string[]=[],httpErrors:object[]=[];
let current='login';
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
 page.on('pageerror',e=>errors.push(`${current}: ${e.message}`));page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400&&!(current==='login'&&r.status()===401))httpErrors.push({tab:current,path:new URL(r.url()).pathname,status:r.status()});});
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});
 await page.goto(process.env.APP_ORIGIN+'/auth-v2');await page.locator('#v2-email').fill('owner-trial@demo.example.test');await page.locator('#v2-password').fill(process.env.SEED_PASSWORD!);await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();await page.locator('#v2-code').fill('123456');await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();await page.getByTestId('business-dashboard').waitFor();
 for(const lang of ['en','ar']){
  await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await page.goto(process.env.APP_ORIGIN+'/business-v2');await page.getByTestId('business-dashboard').waitFor();
  for(let index=0;index<tabs.length;index++){
   current=tabs[index]!;const before=httpErrors.length;
   try{
    const navButton=page.getByRole('navigation').getByRole('button').nth(index);const previousHeading=await page.locator('main h2').first().innerText();await navButton.click();await page.waitForURL(`**/business-v2?tab=${current}`);await page.waitForFunction(i=>document.querySelectorAll('nav button')[i]?.getAttribute('aria-current')==='page',index);if(index>0)await page.waitForFunction(previous=>document.querySelector('main h2')?.textContent!==previous,previousHeading);await page.waitForLoadState('networkidle');
    const main=page.locator('main');await main.waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('main p,main div')).some(el=>el.children.length===0&&/^(Loading[.…]*|جار[ٍي] التحميل[.…]*)$/.test(el.textContent?.trim()||'')));await page.waitForTimeout(250);const heading=await main.locator('h2').first().innerText();const alerts=await main.getByRole('alert').allTextContents();
    const buttons=await main.getByRole('button').allTextContents();
    assert.equal(alerts.length,0,`${current}: ${alerts.join('; ')}`);assert.equal(httpErrors.length,before,`${current}: API failure`);
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${current}: overflow at ${width}`);await page.screenshot({path:`${artifacts}/${lang}-${width}-${current}.png`,fullPage:true,animations:'disabled'});}
    const actions:Record<string,string[]>={returns:['New record'],counts:['New record'],payments:['Record payment','Daily cash closing'],sales:['New sale'],transfers:['New transfer'],suppliers:['Add supplier'],purchases:['New receiving','New purchase order'],catalogue:['Add product','Categories & units'],locations:['Add location'],team:['Edit access']};
    const forms=[];
    if(lang==='en')for(const action of actions[current]||[]){
     await page.setViewportSize({width:390,height:1000});
     const trigger=main.getByRole('button',{name:action,exact:true}).first();await trigger.click();
     await page.waitForTimeout(350);await page.waitForLoadState('networkidle');
     const dialog=page.getByRole('dialog');const surface=await dialog.count()?dialog.last():main;
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${action}: mobile overflow`);
     if(await dialog.count())assert(await surface.evaluate(el=>el.scrollWidth<=el.clientWidth),`${action}: dialog overflow`);
     const fields=await surface.locator('input:not([type="hidden"]),textarea,select').evaluateAll(els=>els.map(el=>({id:el.id,type:el.getAttribute('type'),required:el.hasAttribute('required'),placeholder:el.getAttribute('placeholder'),valid:(el as HTMLInputElement).checkValidity()})));
     forms.push({action,fields});await page.screenshot({path:`${artifacts}/form-${current}-${action.replaceAll(' ','-')}.png`,fullPage:true});
     await page.goto(process.env.APP_ORIGIN+'/business-v2?tab='+current);await page.getByRole('navigation').getByRole('button').nth(index).waitFor();await page.waitForLoadState('networkidle');
    }
    results.push({tab:current,lang,heading,buttons,forms,status:'PASS'});
   }catch(e){results.push({tab:current,lang,status:'FAIL',error:e instanceof Error?e.message:String(e)});await page.screenshot({path:`${artifacts}/FAIL-${lang}-${current}.png`,fullPage:true});}
  }
 }
 await page.goto(process.env.APP_ORIGIN+'/business-v2?tab=security');await page.getByTestId('account-security').waitFor();await page.getByRole('button',{name:'تسجيل الخروج',exact:true}).click();
}finally{await browser.close();await writeFile(artifacts+'results.json',JSON.stringify({results,errors,httpErrors},null,2));}
console.log(JSON.stringify({passed:results.filter((r:any)=>r.status==='PASS').length,failed:results.filter((r:any)=>r.status==='FAIL'),errors,httpErrors},null,2));
if(results.some((r:any)=>r.status==='FAIL')||errors.length||httpErrors.length)process.exitCode=1;
