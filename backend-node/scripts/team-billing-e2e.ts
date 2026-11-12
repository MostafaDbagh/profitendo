import {chromium, type BrowserContext, type Page} from 'playwright';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pino} from 'pino';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/app.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {encrypt,passwordHash,passwordMatches} from '../src/auth/crypto.js';
const url=process.env.DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const db=createDatabase(url),settings=readAuthSettings({...process.env,APP_ORIGIN:'http://localhost:3200',AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex')});
const auth=new AuthService(db,settings),mail=new Map<string,string>();
auth.queueMail=async(_tx,email,_subject,action,token)=>{if(action==='invite')mail.set(email,token);};
const server=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth).listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const port=(server.address() as {port:number}).port;
const browser=await chromium.launch({channel:'chrome',headless:true}),id=randomUUID(),bid=randomUUID(),planId=randomUUID(),paidId=randomUUID(),ids:string[]=[id],errors:string[]=[];
const email=`invite-${randomUUID()}@example.test`,password='Browser test '+randomUUID(),artifacts='../tmp/team-billing-e2e';
await mkdir(artifacts,{recursive:true});
async function context(){const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 await ctx.route('http://localhost:4200/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:`http://127.0.0.1:${port}${u.pathname}${u.search}`});await route.fulfill({response});});
 await ctx.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return ctx;}
async function page(ctx:BrowserContext){const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));return p;}
async function go(p:Page,tab:string){
 await p.goto('http://localhost:3200/business');
 await p.locator('nav').waitFor();
 const ar=await p.evaluate(()=>document.documentElement.lang==='ar');
 const names:Record<string,string> = ar?{billing:'الاشتراك',team:'الفريق',invitations:'الدعوات'}:{billing:'Subscription',team:'Team',invitations:'Invitations'};
 await p.locator('nav').getByRole('button',{name:names[tab],exact:true}).click();
 await p.locator('main').waitFor();
}
try{
 const owner=await db.authUser.create({data:{id,email:`owner-${id}@example.test`,name:'Browser owner',passwordHash:await passwordHash(password),emailVerifiedAt:new Date()}});
 await db.business.create({data:{id:bid,name:'Browser integration business'}});await db.membership.create({data:{businessId:bid,userId:id,role:'OWNER'}});
 await db.billingPlan.createMany({data:[{id:planId,code:`e2e-${planId}`,name:'Browser trial',nameAr:'تجربة الاختبار',published:true,trialDays:14,maxMembers:2,maxWarehouses:1,maxShops:1},{id:paidId,code:`e2e-${paidId}`,name:'Browser paid',nameAr:'اشتراك الاختبار',published:true,priceMinor:2000,currency:'USD',interval:'MONTH',trialDays:0,maxMembers:10,maxWarehouses:2,maxShops:2}]});
 const ownerContext=await context(),session=await auth.transaction(tx=>auth.makeSession(tx,owner,true));
 await ownerContext.addCookies([{name:settings.cookieName,value:session.token,url:settings.appOrigin,httpOnly:true,sameSite:'Lax'}]);const p=await page(ownerContext);
 await go(p,'billing');await p.getByRole('alert').filter({hasText:'Set up two-factor authentication'}).waitFor();
 await p.getByRole('link',{name:'Account security',exact:true}).waitFor();
 assert((new URL(p.url())).searchParams.get('tab')==='billing');
 await p.screenshot({path:`${artifacts}/subscription-mfa-required.png`,fullPage:true});
 await db.authUser.update({where:{id},data:{mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}});
 await go(p,'billing');await p.getByText('Trial not started',{exact:true}).waitFor();
 console.log('PASS: missing MFA shows setup guidance without redirect loop');
 const offer=p.locator('div').filter({has:p.getByRole('heading',{name:'Browser trial',exact:true})}).filter({has:p.getByRole('button',{name:'Start free trial',exact:true})}).last();
 await offer.getByRole('button',{name:'Start free trial',exact:true}).click();await p.getByRole('dialog').getByRole('button',{name:'Start free trial',exact:true}).click();await p.getByText('Trial active',{exact:true}).waitFor();
 assert.equal((await db.businessSubscription.findUniqueOrThrow({where:{businessId:bid}})).planId,planId);
 console.log('PASS: trial activation through browser and real API');
 await go(p,'invitations');await p.locator('#invite-member-name').fill('Invited colleague');await p.locator('#team-email').fill(email);await p.locator('#invite-password').fill(password);await p.getByRole('button',{name:'Send invitation',exact:true}).click();await p.getByRole('cell',{name:email,exact:true}).waitFor();
 const invitation=await db.invitation.findFirstOrThrow({where:{businessId:bid,email}});assert.equal(invitation.name,'Invited colleague');assert(await passwordMatches(invitation.initialPasswordHash!,password));assert.equal(await db.membership.count({where:{businessId:bid}}),1);assert(mail.has(email));
 await p.locator('#invite-member-name').fill('Over capacity');await p.locator('#team-email').fill(`full-${email}`);await p.getByRole('button',{name:'Send invitation',exact:true}).click();await p.getByRole('alert').waitFor();assert.equal(await db.invitation.count({where:{businessId:bid}}),1);
 console.log('PASS: invitation name/password, persisted pending record, seat-limit rejection');
 const recipient=await context(),r=await page(recipient);await r.goto(`http://localhost:3200/auth-v2#action=invite&token=${mail.get(email)}`);await r.locator('#v2-name').waitFor();assert.equal(await r.locator('#v2-name').getAttribute('required'),null);assert.equal(await r.locator('#v2-password').getAttribute('required'),null);
 await r.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();await r.locator('#v2-email').waitFor();
 const user=await db.authUser.findUniqueOrThrow({where:{email}});ids.push(user.id);assert.equal(user.name,'Invited colleague');assert(await passwordMatches(user.passwordHash,password));assert.equal((await db.invitation.findUniqueOrThrow({where:{id:invitation.id}})).initialPasswordHash,null);
 await r.locator('#v2-email').fill(email);await r.locator('#v2-password').fill(password);await r.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();await r.getByTestId('business-dashboard').waitFor();assert.equal(await r.getByRole('button',{name:'Subscription',exact:true}).count(),0);
 await go(p,'team');await p.getByRole('cell',{name:'Invited colleague',exact:true}).waitFor();
 console.log('PASS: accept invite with supplied credentials, login, Team membership, billing hidden for staff');
 await go(p,'billing');const paid=p.locator('article').filter({has:p.getByRole('heading',{name:'Browser paid',exact:true})}).filter({has:p.getByRole('button',{name:'Request paid approval',exact:true})}).last();await paid.getByRole('button',{name:'Request paid approval',exact:true}).click();await paid.getByText('Pending approval',{exact:true}).waitFor();assert.equal((await db.paidApproval.findUniqueOrThrow({where:{businessId_planId:{businessId:bid,planId:paidId}}})).status,'PENDING');
 for(const state of ['active','expired']){
  if(state==='expired')await db.businessSubscription.update({where:{businessId:bid},data:{trialStartedAt:new Date(Date.now()-86400000),trialEndsAt:new Date(Date.now()-1000)}});
  for(const lang of ['en','ar']){await p.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await go(p,'billing');await p.getByText(state==='active'?(lang==='en'?'Trial active':'التجربة نشطة'):(lang==='en'?'Trial expired':'انتهت التجربة'),{exact:true}).waitFor();
   for(const width of [390,1440]){await p.setViewportSize({width,height:1000});await p.locator('main').scrollIntoViewIfNeeded();assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:`${artifacts}/subscription-${state}-${lang}-${width}.png`,fullPage:true,animations:'disabled'});}
  }
 }
 assert.deepEqual(errors,[]);console.log('PASS: paid approval, expired trial, AR/EN mobile/desktop, no browser runtime errors; no mail or provider calls');
}catch(error){
 for(const ctx of browser.contexts())for(const [index,p] of ctx.pages().entries()){console.log('Browser failure URL:',p.url().split('#')[0]);console.log((await p.locator('body').innerText()).slice(0,1800));await p.screenshot({path:`${artifacts}/failure-${index}.png`});}
 throw error;
}finally{
 await browser.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 const created=await db.authUser.findUnique({where:{email}});if(created&&!ids.includes(created.id))ids.push(created.id);
 await db.paidApproval.deleteMany({where:{businessId:bid}});await db.billingAudit.deleteMany({where:{actorId:{in:ids}}});await db.authAudit.deleteMany({where:{businessId:bid}});await db.business.deleteMany({where:{id:bid}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.billingPlan.deleteMany({where:{id:{in:[planId,paidId]}}});await db.$disconnect();
}
