import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createDatabase} from '../src/database.js';
import {checkSeedEnvironment,stagingTarget} from '../src/staging/guard.js';
stagingTarget(process.env);
if(process.env.APP_ORIGIN!=='http://localhost:3200'||process.env.AUTH_MOCK_OTP!=='true')throw new Error('This smoke check targets the local staging preview only');
const db=createDatabase(process.env.DATABASE_URL!),browser=await chromium.launch({channel:'chrome',headless:true});
try{
 assert.equal(await db.authUser.count(),14);assert.equal(await db.business.count(),8);assert.equal(await db.location.count(),16);assert.equal(await db.billingReceipt.count(),12);assert.equal(await db.supportTicket.count(),9);
 await assert.rejects(()=>checkSeedEnvironment(db,{APP_ENV:'production'}));
 const page=await browser.newPage();await page.addInitScript(()=>localStorage.setItem('profitlens_lang','en'));
 await page.goto(process.env.APP_ORIGIN+'/auth-v2');await page.locator('#v2-email').fill('admin@demo.example.test');await page.locator('#v2-password').fill(process.env.SEED_PASSWORD!);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Protect your account',exact:true}).waitFor();
 await page.locator('#v2-password').fill(process.env.SEED_PASSWORD!);await page.getByRole('button',{name:'Set up authenticator',exact:true}).click();await page.getByTestId('mfa-qr').waitFor();assert((await page.getByTestId('mfa-qr').getAttribute('src'))?.startsWith('data:image/png;base64,'));
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
 assert.equal((await db.authUser.findUniqueOrThrow({where:{email:'admin@demo.example.test'}})).mfaSecret,null);
 console.log('PASS: staging fixtures, production DB-marker refusal, real admin password login, QR setup and logout; MFA remains ready for your own enrollment.');
}finally{await browser.close();await db.$disconnect();}
