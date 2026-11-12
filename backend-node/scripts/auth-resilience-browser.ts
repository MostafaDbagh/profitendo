import {chromium,type Route} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const folder='../tmp/auth-resilience';await mkdir(folder,{recursive:true});
try{for(const lang of ['en','ar']){
 const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 let config='offline',login='offline',loginRequests=0,pending:Route|undefined;
 const headers={'access-control-allow-origin':'http://localhost:3100','access-control-allow-credentials':'true'};
 const json=(route:Route,status:number,body:unknown)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
 await page.route('**/api/auth/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{...headers,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,x-csrf-token'}});
  if(path.endsWith('/config')){if(config==='offline')return route.abort('connectionfailed');if(config==='invalid')return route.fulfill({status:503,headers,contentType:'text/html',body:'Unavailable'});return json(route,200,{mockOtp:false});}
  if(path.endsWith('/login')){loginRequests++;if(login==='offline')return route.abort('connectionfailed');if(login==='pending'){pending=route;return;}return json(route,401,{error:{code:'INVALID_CREDENTIALS'}});}
  return json(route,401,{error:{code:'UNAUTHENTICATED'}});
 });
 await page.addInitScript(l=>localStorage.setItem('profitlens_lang',l),lang);
 await page.goto('http://localhost:3100/auth-v2');
 const retry=page.getByRole('button',{name:lang==='ar'?'إعادة محاولة الاتصال':'Try connecting again',exact:true});await retry.waitFor();assert.equal(await page.locator('#v2-email').count(),0);
 for(const width of [390,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${folder}/${lang}-${width}-offline.png`,fullPage:true});}
 config='invalid';await retry.click();await page.getByRole('alert').filter({hasText:lang==='ar'?'استجابة غير متوقعة':'unexpected response'}).waitFor();
 config='okay';await retry.click();await page.locator('#v2-email').waitFor();
 await page.locator('#v2-email').fill('test@example.test');await page.locator('#v2-password').fill('Browser example password');
 await page.getByRole('button',{name:lang==='ar'?'إظهار كلمة المرور':'Show password',exact:true}).click();assert.equal(await page.locator('#v2-password').getAttribute('type'),'text');
 await page.getByRole('button',{name:lang==='ar'?'إنشاء حساب نشاط تجاري':'Create a business account',exact:true}).click();assert.equal(await page.locator('#v2-password').getAttribute('type'),'password');assert.equal(await page.locator('#v2-password').inputValue(),'');
 await page.getByRole('button',{name:lang==='ar'?'العودة لتسجيل الدخول':'Back to sign in',exact:true}).click();
 await page.locator('#v2-email').fill('test@example.test');await page.locator('#v2-password').fill('Browser example password');const submit=page.locator('[data-testid="auth-v2-form"] button[type="submit"]');
 await submit.click();await page.getByRole('alert').filter({hasText:lang==='ar'?'تعذّر الاتصال':'Cannot connect'}).waitFor();assert.equal(await submit.isEnabled(),true);
 login='pending';const before=loginRequests;await submit.click();assert.equal(await submit.isDisabled(),true);assert.equal(await page.locator('#v2-password').isDisabled(),true);
 await page.waitForFunction(()=>document.querySelector('form button[type="submit"]')?.hasAttribute('disabled'));
 assert.equal(loginRequests,before+1);assert(pending);await json(pending,401,{error:{code:'INVALID_CREDENTIALS'}});await page.getByRole('alert').filter({hasText:lang==='ar'?'تحقّق من البريد':'Check your email'}).waitFor();assert.equal(await submit.isEnabled(),true);
 if(lang==='en'){await submit.click();await page.getByRole('alert').filter({hasText:'too long to respond'}).waitFor({timeout:35000});assert.equal(await submit.isEnabled(),true);await pending?.abort().catch(()=>{});}
 assert.deepEqual(errors,[]);await page.close();console.log(`PASS: ${lang} connection retry, malformed response, masked mode changes, submission lock and recovery${lang==='en'?', 30-second timeout':''}.`);
}}finally{await browser.close();}
