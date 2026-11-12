import {chromium} from 'playwright';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pino} from 'pino';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/app.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {encrypt,passwordHash,totp} from '../src/auth/crypto.js';
if(!process.env.DATABASE_URL||!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const db=createDatabase(process.env.DATABASE_URL),settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3300'}),auth=new AuthService(db,settings);
const server=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const port=(server.address() as {port:number}).port,id=randomUUID(),bid=randomUUID(),email=`grocery-login-${id}@example.test`,password=`Grocery test ${randomUUID()}`,secret='JBSWY3DPEHPK3PXP';
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
await page.route('http://localhost:4300/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:`http://127.0.0.1:${port}${u.pathname}${u.search}`});await route.fulfill({response});});
await page.addInitScript(()=>localStorage.setItem('profitlens_lang','en'));
try{
 await db.authUser.create({data:{id,email,name:'Mock Grocery Admin',passwordHash:await passwordHash(password),emailVerifiedAt:new Date(),mfaSecret:encrypt(settings.key,secret,`mfa:${id}`)}});await db.business.create({data:{id:bid,name:'Grocery sign-in test'}});await db.membership.create({data:{businessId:bid,userId:id,role:'OWNER'}});
 await page.goto(settings.appOrigin+'/auth-v2');await page.locator('#v2-email').fill(email);await page.locator('#v2-password').fill('Incorrect password 123!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('alert').waitFor();
 await page.locator('#v2-password').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Verify it is you'}).waitFor();await page.locator('#v2-code').fill(totp(secret,email).generate());await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByTestId('business-dashboard').waitFor();
 for(const name of ['Team','Roles & access','Warehouses & shops','Purchases','Sales'])assert(await page.getByRole('navigation').getByRole('button',{name,exact:true}).isVisible());
 await mkdir('../tmp/grocery-human-test',{recursive:true});await page.screenshot({path:'../tmp/grocery-human-test/00-admin-login.png',fullPage:true});
 await page.getByRole('navigation').getByRole('button',{name:'Account security',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#v2-email').waitFor();assert.deepEqual(errors,[]);console.log('PASS: wrong-password rejection, real owner password + authenticator login, admin navigation, sign-out');
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await db.authAudit.deleteMany({where:{OR:[{businessId:bid},{userId:id}]}});await db.business.deleteMany({where:{id:bid}});await db.authUser.deleteMany({where:{id}});await db.$disconnect();}
