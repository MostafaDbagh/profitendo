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
const artifacts='../tmp/four-tabs-qa';await mkdir(artifacts,{recursive:true});
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
 await open(page,'team');await page.getByRole('cell',{name:'QA Accountant',exact:true}).waitFor();
 const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:'QA Accountant',exact:true})});
 await row.getByRole('button',{name:'Edit access',exact:true}).click();
 await page.locator('#member-role').waitFor();await shot(page,'owner-edit-member-en');
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 checks.push('Administrator can inspect staff access and dismiss edit without mutation');
 await open(page,'roles');await page.getByRole('button',{name:'Add role',exact:true}).click();
 await page.locator('#role-name').fill('QA Accountant '+run);
 await page.getByRole('dialog').getByLabel('View scoped reports',{exact:true}).check();
 await page.getByRole('dialog').getByRole('button',{name:'Add role',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByRole('cell',{name:'QA Accountant '+run,exact:false}).waitFor();
 checks.push('Administrator creates a custom role through the UI');
 await open(page,'invitations');await page.locator('#team-email').waitFor();
 await page.getByRole('button',{name:'Send invitation',exact:true}).click();
 assert(await page.locator('#invite-member-name').evaluate((el:HTMLInputElement)=>!el.validity.valid));
 await page.locator('#invite-member-name').fill('QA Invited Accountant');
 await page.locator('#team-email').fill(`invite-${run}@example.test`);
 const role=await db.businessRole.findFirstOrThrow({where:{businessId:business.id,name:'QA Accountant '+run}});
 await page.locator('#invite-role').selectOption(role.id);
 await page.getByRole('button',{name:'Send invitation',exact:true}).click();
 const inviteRow=page.getByRole('row').filter({hasText:`invite-${run}@example.test`});
 await inviteRow.waitFor();
 await inviteRow.getByRole('button',{name:'Revoke invitation',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Revoke invitation',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});await inviteRow.getByRole('cell',{name:'Revoked',exact:true}).waitFor();
 checks.push('Invitation required fields, custom role selection, queued test invitation, and revocation pass (no external delivery)');
 for(const lang of ['en','ar']){
  await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);
  for(const tab of ['billing','team','roles','invitations']){
   await open(page,tab);
   if(tab==='billing')await page.getByText(lang==='ar'?'التجربة نشطة':'Trial active',{exact:true}).waitFor();
   else if(tab==='invitations')await page.locator('#team-email').waitFor();
   else await page.getByRole('table').waitFor();
   for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await shot(page,`owner-${tab}-${lang}-${width}`);}
  }
 }
 checks.push('All four tabs render in Arabic/English at 390px and 1440px without page overflow');
 await open(accountant.page,'dashboard');await accountant.page.getByTestId('business-dashboard').waitFor();
 for(const label of ['Subscription','Team','Roles & access','Invitations'])assert.equal(await accountant.page.getByRole('navigation').getByRole('button',{name:label,exact:true}).count(),0);
 for(const path of [`/billing/businesses/${business.id}`,`/businesses/${business.id}/members`,`/businesses/${business.id}/roles`,`/businesses/${business.id}/invitations`]){
  assert.equal((await api(accountant.page,path)).status,403,`Accountant restricted ${path}`);
 }
 assert.equal((await api(accountant.page,`/businesses/${business.id}/roles`,'POST',{name:'Unauthorized',permissions:{'team.manage':true}})).status,403);
 checks.push('Financial-only accountant cannot view administrative tabs or bypass restrictions via direct API requests');
 assert.equal((await api(accountant.page,`/businesses/${business.id}/workflows/reports?view=summary&from=2026-11-01&to=2026-11-18`)).status,200);
 await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));await open(page,'team');
 const staffRow=page.getByRole('row').filter({has:page.getByRole('cell',{name:'QA Accountant',exact:true})});
 await staffRow.getByRole('button',{name:'Remove from team',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Remove from team',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 await staffRow.getByRole('cell',{name:'Inactive',exact:true}).waitFor();
 assert.equal((await api(accountant.page,`/businesses/${business.id}`)).status,401);
 checks.push('Accountant can read financial reports; administrator removal revokes the existing session immediately');
 await db.businessSubscription.update({where:{businessId:business.id},data:{trialStartedAt:new Date(Date.now()-172800000),trialEndsAt:new Date(Date.now()-86400000)}});
 await open(page,'billing');await page.getByText('Trial expired',{exact:true}).waitFor();
 await shot(page,'owner-billing-expired');
 checks.push('Expired trial remains visible with recovery messaging');
 await platform.page.goto(settings.appOrigin+'/platform-v2');

 assert.equal((await api(platform.page,`/billing/businesses/${business.id}`)).status,403);
 assert.equal((await api(platform.page,`/businesses/${business.id}/members`)).status,403);
 checks.push('Platform administrator cannot bypass tenant access');
 assert.equal(errors.length,0,errors.join('\n'));
 await writeFile(`${artifacts}/results.json`,JSON.stringify({checks,errors},null,2));
 console.log(JSON.stringify({passed:checks},null,2));
}finally{
 await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));
 for(const mail of await db.authMail.findMany()){try{if(JSON.parse(decrypt(settings.key,mail.payload,`mail:${mail.id}`)).to.includes(run))await db.authMail.delete({where:{id:mail.id}});}catch{}}
 await db.billingAudit.deleteMany({where:{actorId:{in:ids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});
 await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.deleteMany({where:{id:{in:planIds}}});await db.$disconnect();
}
