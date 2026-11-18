import {chromium, type Page} from 'playwright';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pino} from 'pino';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/app.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {passwordHash,encrypt,decrypt} from '../src/auth/crypto.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw Error('Dedicated test database required');
const db=createDatabase(url),run=randomUUID().slice(0,8),ids:string[]=[],bids:string[]=[],planIds:string[]=[];
const settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3200'});
const auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const server=app.listen(4301,'127.0.0.1');
const browser=await chromium.launch({channel:'chrome',headless:true});
const artifacts='../tmp/service-requests-qa';await mkdir(artifacts,{recursive:true});
const errors:string[]=[],checks:string[]=[];
async function actor(name:string,bid?:string,role:'OWNER'|'VIEWER'='VIEWER',grants?:Record<string,boolean>,admin=false){
 const id=randomUUID();ids.push(id);
 const user=await db.authUser.create({data:{id,name,email:`qa-${run}-${id}@example.test`,emailVerifiedAt:new Date(),passwordHash:await passwordHash('QA isolated passphrase 2026!'),platformRole:admin?'SUPER_ADMIN':'USER',mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}});
 if(bid){
  const custom=grants?await db.businessRole.create({data:{businessId:bid,name:'QA Finance fixture',nameKey:'qa finance fixture',permissions:grants}}):null;
  await db.membership.create({data:{businessId:bid,userId:id,role,permissionOverrides:grants,customRoleId:custom?.id}});
 }
 const session=await auth.transaction(tx=>auth.makeSession(tx,user,true));
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addCookies([{name:'pl_session',value:session.token,url:settings.appOrigin,httpOnly:true,sameSite:'Lax'}]);
 await context.route('http://localhost:4200/**',async route=>{
  const response=await route.fetch({url:route.request().url().replace('http://localhost:4200','http://127.0.0.1:4301')});
  await route.fulfill({response});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});
 page.setDefaultTimeout(15000);
 return {page,id};
}
async function open(page:Page,tab:string){await page.goto(`${settings.appOrigin}/business-v2?tab=${tab}`);await page.getByRole('navigation').waitFor();}
async function shot(page:Page,name:string){
 await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Page overflow: ${name}`);
 await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true});
}
async function api(page:Page,path:string,method='GET',body?:object){
 return page.evaluate(async({path,method,body})=>{
  const me=await fetch('http://localhost:4200/api/auth/me',{credentials:'include'}).then(r=>r.json());
  const r=await fetch('http://localhost:4200/api'+path,{method,credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrfToken},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,body:await r.json()};
 },{path,method,body});
}
try{
 const business=await db.business.create({data:{name:'QA Four Tabs '+run}});bids.push(business.id);
 const plan=await db.billingPlan.create({data:{code:'qa-'+run,name:'QA Trial',nameAr:'تجربة اختبار',trialDays:14,maxMembers:10,maxWarehouses:2,maxShops:3,published:true}});planIds.push(plan.id);
 await db.businessSubscription.create({data:{businessId:business.id,planId:plan.id,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const owner=await actor('QA Administrator',business.id,'OWNER');
 const accountant=await actor('QA Accountant',business.id,'VIEWER',{'business.view':true,'reports.view':true,'payments.view':true,'catalogue.cost':true,'purchasing.view':true,'locations.all':true,'team.view':false,'roles.view':false,'team.manage':false});
 const platform=await actor('QA Platform Admin',undefined,'VIEWER',undefined,true);
 const page=owner.page;

 await open(page,'settings');await page.locator('#service-request-subject').waitFor();
 await shot(page,'request-settings-before-en');
 const form=page.locator('form').filter({has:page.locator('#service-request-subject')});
 assert(await form.getByRole('button',{name:'Send request',exact:true}).isDisabled());
 await page.locator('#service-request-type').click();await page.getByRole('option',{name:'Service request',exact:true}).click();
 await page.locator('#service-request-subject').fill('QA service '+run);
 await page.locator('#service-request-description').fill('Please help us import our existing product catalogue.');
 await form.getByRole('button',{name:'Send request',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Request sent.'}).waitFor();
 const ticket=await db.supportTicket.findFirstOrThrow({where:{businessId:business.id,subject:'QA service '+run}});
 assert.equal(ticket.category,'SERVICE');
 await platform.page.goto(settings.appOrigin+'/platform-v2');
 assert.equal((await api(platform.page,'/support/admin/tickets/'+ticket.id)).status,200);
 assert.equal((await api(platform.page,'/support/admin/tickets/'+ticket.id+'/messages','POST',{body:'We received your service request and will review it.'})).status,200);
 const row=page.getByRole('row').filter({hasText:'QA service '+run});
 await row.getByRole('button',{name:'View conversation',exact:true}).click();
 await page.getByText('We received your service request and will review it.',{exact:true}).waitFor();
 await open(accountant.page,'settings');
 assert.equal((await api(accountant.page,'/support/tickets/'+ticket.id)).status,404);
 checks.push('Service request saved with business, visible to platform, reply visible to requester, private from other users');
 for(const lang of ['en','ar']){
  await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);
  await open(page,'settings');await page.locator('#service-request-subject').waitFor();
  await page.locator('#service-request-type').click();await page.getByRole('option',{name:lang==='ar'?'ميزة جديدة':'New feature',exact:true}).click();
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:1000});
   await page.locator('#service-request-heading').scrollIntoViewIfNeeded();
   await shot(page,`requests-${lang}-${width}`);
  }
 }
 await page.locator('#service-request-subject').fill('QA feature '+run);
 await page.locator('#service-request-description').fill('Monthly report with sales and profit by category.');
 await page.locator('form').filter({has:page.locator('#service-request-subject')}).getByRole('button',{name:'إرسال الطلب',exact:true}).click();
 await page.getByRole('status').filter({hasText:'تم إرسال طلبك'}).waitFor();
 assert.equal(await db.supportTicket.count({where:{businessId:business.id,category:'FEATURE'}}),1);
 checks.push('Feature request submission and AR/EN desktop/mobile layouts pass');
 assert.equal(errors.length,0,errors.join('\n'));
 await writeFile(`${artifacts}/results.json`,JSON.stringify({checks,errors},null,2));
 console.log(JSON.stringify({passed:checks},null,2));
}finally{
 await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));
 for(const mail of await db.authMail.findMany()){try{if(JSON.parse(decrypt(settings.key,mail.payload,`mail:${mail.id}`)).to.includes(run))await db.authMail.delete({where:{id:mail.id}});}catch{}}
 await db.billingAudit.deleteMany({where:{actorId:{in:ids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});
 await db.supportTicket.deleteMany({where:{businessId:{in:bids}}});
 await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.deleteMany({where:{id:{in:planIds}}});await db.$disconnect();
}
