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
const db=createDatabase(url),settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3200'}),auth=new AuthService(db,settings),app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const previous=await db.systemMetadata.findUnique({where:{key:policyKey}}),ids:string[]=[],bids:string[]=[],errors:string[]=[];
const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const s=app.listen(4318,'localhost',()=>resolve(s));});
const browser=await chromium.launch({channel:'chrome',headless:true});
const artifacts='../tmp/onboarding-policy';await mkdir(artifacts,{recursive:true});
try{
 await db.systemMetadata.deleteMany({where:{key:policyKey}});
 const ctx=await browser.newContext();await ctx.route('http://localhost:4200/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:`http://localhost:4318${u.pathname}${u.search}`});await route.fulfill({response});});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 const email=`policy-ui-${randomUUID()}@example.test`,password='Browser onboarding password 840!';
 await page.addInitScript(()=>localStorage.setItem('profitlens_lang','en'));
 await page.goto(settings.appOrigin+'/auth?mode=register');await page.locator('#v2-name').waitFor();
 for(const lang of ['en','ar']){
  if(await page.evaluate(()=>document.documentElement.lang)!==lang)await page.getByRole('button',{name:lang==='ar'?'العربية':'English',exact:true}).click();
  for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`${artifacts}/${lang}-${width}-register.png`,fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 }
 await page.locator('#v2-name').fill('Onboarding Owner');await page.locator('#v2-businessName').fill('Policy UI Shop');await page.locator('#v2-email').fill(email);await page.locator('#v2-register-phone').fill('+971501234567');await page.locator('#v2-password').fill(password);await page.locator('#v2-confirmPassword').fill(password);await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();
 await page.getByTestId('business-dashboard').waitFor({timeout:20000});
 const user=await db.authUser.findUniqueOrThrow({where:{email}});ids.push(user.id);bids.push((await db.membership.findFirstOrThrow({where:{userId:user.id}})).businessId);
 assert.equal(user.emailVerifiedAt,null);assert.equal(user.phoneVerifiedAt,null);assert.equal(user.welcomeQueuedAt,null);assert.equal(await db.verificationChallenge.count({where:{userId:user.id}}),0);assert.equal(await db.authToken.count({where:{userId:user.id}}),0);
 await page.screenshot({path:`${artifacts}/registered-dashboard.png`,fullPage:true});
 // Dedicated platform operator fixture; no customer business privileges are granted.
 const admin=await db.authUser.create({data:{email:`admin-${randomUUID()}@example.test`,name:'Policy admin',passwordHash:user.passwordHash,platformRole:'SUPER_ADMIN',emailVerifiedAt:new Date()}});ids.push(admin.id);
 const session=await auth.login(admin.email,password);await ctx.clearCookies();await ctx.addCookies([{name:'pl_session',value:session.token,url:settings.appOrigin,httpOnly:true,sameSite:'Lax'}]);
 await page.goto(settings.appOrigin+'/platform-v2?tab=onboarding');await page.locator('#policy-emailRequired').waitFor();
 for(const lang of ['en','ar']){
  if(await page.evaluate(()=>document.documentElement.lang)!==lang)await page.getByRole('button',{name:lang==='ar'?'العربية':'English',exact:true}).click();
  for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`${artifacts}/${lang}-${width}-admin.png`,fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 }
 await page.locator('#policy-welcomeEnabled').click();await page.locator('main button[type="submit"]').click();await page.getByRole('status').waitFor();assert.equal((await auth.policy()).welcomeEnabled,true);
 await page.reload();await page.locator('#policy-welcomeEnabled[aria-checked="true"]').waitFor();await page.locator('#policy-welcomeEnabled').click();await page.locator('main button[type="submit"]').click();await page.getByRole('status').waitFor();assert.equal((await auth.policy()).welcomeEnabled,false);
 assert.deepEqual(errors,[]);console.log('PASS: registration reaches dashboard without verification or welcome; AR/EN mobile/desktop; admin switch persists on reload.');
}finally{
 await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));
 if(previous)await db.systemMetadata.upsert({where:{key:policyKey},create:previous,update:{value:previous.value}});else await db.systemMetadata.deleteMany({where:{key:policyKey}});
 await db.platformAudit.deleteMany({where:{actorId:{in:ids}}});await db.authAudit.deleteMany({where:{userId:{in:ids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.$disconnect();
}
