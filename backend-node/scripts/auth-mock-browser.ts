import { chromium } from 'playwright';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:process.env.BROWSER_APP_ORIGIN||'http://localhost:3100',NODE_ENV:'test',AUTH_MOCK_OTP:'true',DATABASE_URL:url}),db=createDatabase(url);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},new AuthService(db,settings));
app.set('trust proxy','loopback');
const server=await new Promise<ReturnType<typeof app.listen>>((resolve,reject)=>{const s=app.listen(4100,'localhost',()=>resolve(s));s.on('error',reject);});
const browser=await chromium.launch({channel:'chrome',headless:true}),email=`browser-mock-${randomUUID()}@example.test`,pass='Local browser password 149!',artifacts='../tmp/auth-mock-design',errors:string[]=[];
await mkdir(artifacts,{recursive:true});
const plan=await db.billingPlan.create({data:{code:randomUUID(),name:'Onboarding trial',nameAr:'تجربة البدء',published:true,trialDays:14,maxMembers:3,maxWarehouses:1,maxShops:1}});
try{
 const page=await browser.newPage({extraHTTPHeaders:{'X-Forwarded-For':`10.252.${randomBytes(1)[0]}.${randomBytes(1)[0]}`},viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});
 await page.goto(settings.appOrigin+'/auth-v2');await page.locator('#v2-email').waitFor();
 const button=(name:string)=>page.getByRole('button',{name,exact:true});
 const shot=async(name:string)=>{await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});};
 await shot('en-login');await button('Create a business account').click();
 await page.locator('#v2-name').fill('Local Mock Owner');await page.locator('#v2-businessName').fill('Local Mock Shop');await page.locator('#v2-email').fill(email);await page.locator('#v2-password').fill(pass);await page.locator('#v2-confirmPassword').fill(pass+' mismatch');await button('Create business account').click();await page.getByRole('alert').filter({hasText:'passwords do not match'}).waitFor();
 await page.locator('#v2-confirmPassword').fill(pass);await button('Create business account').click();await page.locator('#v2-code').waitFor();
 async function checkOtp(selector='#v2-code'){const input=page.locator(selector);assert.equal(await input.evaluate((el:HTMLInputElement)=>el.type),'text');assert.equal(await input.getAttribute('inputmode'),'numeric');assert.equal(await input.getAttribute('minlength'),'6');assert.equal(await input.getAttribute('maxlength'),'6');assert.equal(await input.getAttribute('pattern'),'[0-9]{6}');await input.fill('letters');assert.equal(await input.inputValue(),'');await input.fill('١٢٣٤٥٦');assert.equal(await input.inputValue(),'');await input.fill('12345');assert.equal(await input.evaluate((el:HTMLInputElement)=>el.checkValidity()),false);await input.fill('001234');assert.equal(await input.inputValue(),'001234');await input.fill('123456');assert.equal(await input.evaluate((el:HTMLInputElement)=>el.checkValidity()),true);}
 await checkOtp();await page.locator('#v2-code').fill('654321');await button('Verify code').click();await page.getByRole('alert').waitFor();await page.locator('#v2-code').fill('123456');await shot('en-email-code');await button('Verify code').click();await page.getByRole('status').filter({hasText:'Email verified'}).waitFor();
 async function login(password:string){await page.locator('#v2-email').fill(email);await page.locator('#v2-password').fill(password);await button('Sign in').click();}
 await login(pass);await page.getByTestId('business-dashboard').waitFor();
 await page.getByRole('navigation').getByRole('button',{name:'Subscription',exact:true}).click();await page.getByRole('alert').filter({hasText:'Set up two-factor authentication'}).waitFor();
 await page.getByRole('navigation').getByRole('button',{name:'Account security',exact:true}).click();
 const mfa=page.getByTestId('mfa-settings');await mfa.getByRole('button',{name:'Enable MFA',exact:true}).click();
 await page.locator('#mfa-password').fill(pass);await mfa.getByRole('button',{name:'Confirm',exact:true}).click();await mfa.getByRole('img').waitFor();
 assert((await mfa.getByRole('img').getAttribute('src'))?.startsWith('data:image/png;base64,'));
 await checkOtp('#mfa-code');
 for(const lang of ['en','ar'])for(const width of [320,390,768,1024,1440]){
  await page.setViewportSize({width,height:1000});const current=await page.evaluate(()=>document.documentElement.dir);if(current!==(lang==='ar'?'rtl':'ltr'))await button(lang==='ar'?'العربية':'English').click();
  assert.equal(await page.evaluate(()=>document.documentElement.dir),lang==='ar'?'rtl':'ltr');await shot(`${lang}-${width}-mfa-qr`);
 }
 await button('English').click();await mfa.getByRole('button',{name:'Confirm',exact:true}).click();await mfa.getByRole('button',{name:'I saved my recovery codes',exact:true}).waitFor();const recovery=await mfa.locator('li').first().innerText();await mfa.getByRole('button',{name:'I saved my recovery codes',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'Subscription',exact:true}).click();
 await page.getByRole('heading',{name:'Onboarding trial',exact:true}).locator('..').getByRole('button',{name:'Start free trial',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Start free trial',exact:true}).click();await page.getByText('Your business trial has started.',{exact:true}).waitFor();
 await page.getByRole('navigation').getByRole('button',{name:'Warehouses & shops',exact:true}).click();
 for(const [kind,name,code] of [['WAREHOUSE','Onboarding warehouse','WH-01'],['SHOP','Onboarding shop','SH-01']]){
  await button('Add location').click();await page.locator('#location-name').fill(name!);await page.locator('#location-code').fill(code!);await page.locator('#location-kind').selectOption(kind!);await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('cell',{name:name!,exact:true}).waitFor();
 }
 console.log('PASS: new owner signup → verification → login → trial activation → first warehouse and shop.');
  await page.getByRole('navigation').getByRole('button',{name:'Account security',exact:true}).click();
  await page.getByTestId('account-security').waitFor();await button('Sign out').click();
 await login(pass);await page.getByRole('heading',{name:'Verify it is you'}).waitFor();await checkOtp();await button('Continue').click();await page.getByTestId('business-dashboard').waitFor();
  await page.getByRole('navigation').getByRole('button',{name:'Account security',exact:true}).click();
  await page.getByTestId('account-security').waitFor();await button('Sign out').click();
 await login(pass);await button('Use a recovery code').click();await page.locator('#v2-code').fill(recovery);await button('Continue').click();await page.getByTestId('business-dashboard').waitFor();
  await page.getByRole('navigation').getByRole('button',{name:'Account security',exact:true}).click();
  await page.getByTestId('account-security').waitFor();await button('Sign out').click();
 await button('Forgot your password?').click();await page.locator('#v2-email').fill(email);await button('Send verification code').click();await page.locator('#v2-code').fill('123456');await button('Verify code').click();await page.getByRole('heading',{name:'Choose a new password'}).waitFor();await page.locator('#v2-password').fill(pass+' new');await page.locator('#v2-confirmPassword').fill(pass+' new');await shot('en-reset');await button('Continue').click();await page.getByRole('status').filter({hasText:'Password updated'}).waitFor();await login(pass);await page.getByRole('alert').waitFor();await login(pass+' new');await page.getByRole('heading',{name:'Verify it is you'}).waitFor();await page.locator('#v2-code').fill('123456');await button('Continue').click();await page.getByTestId('business-dashboard').waitFor();
  await page.getByRole('navigation').getByRole('button',{name:'Account security',exact:true}).click();
  await page.getByTestId('account-security').waitFor();
 await page.locator('#security-current').fill(pass+' new');await page.locator('#security-new').fill(pass+' final');await page.locator('#security-confirm').fill(pass+' mismatch');await button('Change password').click();await page.getByRole('alert').filter({hasText:'passwords do not match'}).waitFor();await page.locator('#security-confirm').fill(pass+' final');await button('Change password').click();await page.locator('#v2-email').waitFor();await login(pass+' final');await page.locator('#v2-code').fill('123456');await button('Continue').click();await page.getByTestId('business-dashboard').waitFor();
 for(const lang of ['en','ar'])for(const width of [320,390,768,1024,1440]){
  // Screenshot reloads deliberately use a separate test client identity from the auth journey.
  await page.setExtraHTTPHeaders({'X-Forwarded-For':`10.251.${randomBytes(1)[0]}.${randomBytes(1)[0]}`});
  await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await page.goto(settings.appOrigin+'/business-v2');await page.getByTestId('business-dashboard').waitFor();await page.setViewportSize({width,height:1000});await shot(`${lang}-${width}-dashboard`);await page.getByRole('navigation').getByRole('button',{name:lang==='ar'?'أمان الحساب':'Account security',exact:true}).click();await page.getByTestId('account-security').waitFor();assert.equal(await page.getByRole('dialog').count(),0);await shot(`${lang}-${width}-security`);
 }
 assert.deepEqual(errors,[]);console.log('PASS: signup confirmation, email OTP, input type/length, QR, MFA, recovery code, logout, forgot/reset, old-password rejection, new signin, AR/EN and five widths.');
}finally{
 await browser.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 const user=await db.authUser.findUnique({where:{email}});if(user){const ms=await db.membership.findMany({where:{userId:user.id}});await db.authAudit.deleteMany({where:{userId:user.id}});await db.location.deleteMany({where:{businessId:{in:ms.map(m=>m.businessId)}}});await db.billingAudit.deleteMany({where:{actorId:user.id}});await db.business.deleteMany({where:{id:{in:ms.map(m=>m.businessId)}}});await db.authUser.delete({where:{id:user.id}});}await db.billingPlan.delete({where:{id:plan.id}});await db.$disconnect();
}
