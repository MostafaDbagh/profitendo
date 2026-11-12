import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createDatabase} from '../src/database.js';
import {passwordHash} from '../src/auth/crypto.js';
import {stagingTarget} from '../src/staging/guard.js';
stagingTarget(process.env);assert.equal(process.env.APP_ORIGIN,'http://localhost:3200');
const db=createDatabase(process.env.DATABASE_URL!),id=randomUUID(),bid=randomUUID(),email=`mfa-check-${id}@example.test`,password='Test only '+randomUUID();
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await mkdir('../tmp/mfa-settings-design',{recursive:true});
try{
 await db.authUser.create({data:{id,email,name:'MFA test',passwordHash:await passwordHash(password),emailVerifiedAt:new Date()}});
 await db.business.create({data:{id:bid,name:'MFA temporary test'}});await db.membership.create({data:{userId:id,businessId:bid,role:'OWNER'}});
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});
 await page.goto('http://localhost:3200/auth-v2',{waitUntil:'domcontentloaded'});await page.locator('#v2-email').fill(email);await page.locator('#v2-password').fill(password);await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();await page.getByTestId('business-dashboard').waitFor();
 await page.goto('http://localhost:3200/business-v2?tab=security');let panel=page.getByTestId('mfa-settings');await panel.getByRole('button',{name:'Enable MFA',exact:true}).click();await panel.locator('#mfa-password').fill(password);await panel.getByRole('button',{name:'Confirm',exact:true}).click();await panel.getByRole('img').waitFor();
 await panel.locator('#mfa-code').fill('12ab345678');assert.equal(await panel.locator('#mfa-code').inputValue(),'1234');await panel.locator('#mfa-code').fill('123456');
 await panel.screenshot({path:'../tmp/mfa-settings-design/qr-en.png'});await panel.getByRole('button',{name:'Confirm',exact:true}).click();await panel.getByRole('button',{name:'I saved my recovery codes'}).waitFor();assert.equal(await panel.locator('li').count(),10);await panel.getByRole('button',{name:'I saved my recovery codes'}).click();
 for(const lang of ['en','ar']){await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await page.goto('http://localhost:3200/business-v2?tab=security');await panel.waitFor();for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await panel.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`../tmp/mfa-settings-design/${lang}-${width}.png`});}}
 await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));await page.goto('http://localhost:3200/business-v2?tab=security');await panel.getByRole('button',{name:'Disable MFA',exact:true}).click();await panel.locator('#mfa-password').fill(password);await panel.locator('#mfa-code').fill('123456');await panel.getByRole('button',{name:'Confirm',exact:true}).click();await panel.getByRole('button',{name:'Enable MFA',exact:true}).waitFor();assert.equal((await db.authUser.findUniqueOrThrow({where:{id}})).mfaSecret,null);
 console.log('PASS: optional login, QR, OTP normalization, recovery acknowledgement, disable, AR/EN layouts.');
}finally{await browser.close();await db.authAudit.deleteMany({where:{userId:id}});await db.business.deleteMany({where:{id:bid}});await db.authUser.deleteMany({where:{id}});await db.$disconnect();}
