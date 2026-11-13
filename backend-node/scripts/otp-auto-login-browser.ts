import {chromium} from 'playwright';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pino} from 'pino';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/app.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {policyKey} from '../src/auth/policy.js';
const url=process.env.TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('_test'))throw Error('Dedicated test database required');
const db=createDatabase(url),settings=readAuthSettings({NODE_ENV:'test',AUTH_EMAIL_REQUIRED:'true',AUTH_MOCK_OTP:'true',AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3200'}),auth=new AuthService(db,settings),app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const previous=await db.systemMetadata.findUnique({where:{key:policyKey}}),ids:string[]=[],bids:string[]=[],errors:string[]=[];
const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const s=app.listen(4318,'localhost',()=>resolve(s));});
const browser=await chromium.launch({channel:'chrome',headless:true});
const artifacts='../tmp/otp-auto-login';await mkdir(artifacts,{recursive:true});
try{
 await db.systemMetadata.deleteMany({where:{key:policyKey}});
 const ctx=await browser.newContext();await ctx.route('http://localhost:4200/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:`http://localhost:4318${u.pathname}${u.search}`});await route.fulfill({response});});
 let loginRequests=0;const page=await ctx.newPage();page.on('request',r=>{if(new URL(r.url()).pathname==='/api/auth/login')loginRequests++;});page.on('pageerror',e=>errors.push(e.message));
 const email=`policy-ui-${randomUUID()}@example.test`,password='Browser onboarding password 840!';
 await page.addInitScript(()=>localStorage.setItem('profitlens_lang','en'));
 await page.goto(settings.appOrigin+'/auth?mode=register');await page.locator('#v2-name').waitFor();
 for(const lang of ['en','ar']){
  if(await page.evaluate(()=>document.documentElement.lang)!==lang)await page.getByRole('button',{name:lang==='ar'?'العربية':'English',exact:true}).click();
  for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`${artifacts}/${lang}-${width}-register.png`,fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 }
 await page.locator('#v2-name').fill('Onboarding Owner');await page.locator('#v2-businessName').fill('Policy UI Shop');await page.locator('#v2-email').fill(email);await page.locator('#v2-register-phone').fill('+971501234567');await page.locator('#v2-password').fill(password);await page.locator('#v2-confirmPassword').fill(password);await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();
 await page.locator('#v2-code').waitFor(); const registered=await db.authUser.findUniqueOrThrow({where:{email}});ids.push(registered.id);bids.push((await db.membership.findFirstOrThrow({where:{userId:registered.id}})).businessId);
await page.screenshot({path:`${artifacts}/otp.png`,fullPage:true});await page.locator('#v2-code').fill('123456');await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();
 await page.getByTestId('business-dashboard').waitFor({timeout:20000});assert.equal(loginRequests,0);
 const user=await db.authUser.findUniqueOrThrow({where:{email}});
 assert(user.emailVerifiedAt);assert.equal(user.phoneVerifiedAt,null);assert.equal(user.welcomeQueuedAt,null);assert.equal(await db.verificationChallenge.count({where:{userId:user.id}}),0);assert.equal(await db.authToken.count({where:{userId:user.id,usedAt:null}}),0);
 await page.screenshot({path:`${artifacts}/registered-dashboard.png`,fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: register → OTP → authenticated dashboard without any login/password request.');
}finally{
 for(const context of browser.contexts())await context.unrouteAll({behavior:'ignoreErrors'});await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));
 if(previous)await db.systemMetadata.upsert({where:{key:policyKey},create:previous,update:{value:previous.value}});else await db.systemMetadata.deleteMany({where:{key:policyKey}});
 await db.platformAudit.deleteMany({where:{actorId:{in:ids}}});await db.authAudit.deleteMany({where:{userId:{in:ids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.$disconnect();
}
