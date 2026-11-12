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
 const staffId=randomUUID();await db.authUser.create({data:{id:staffId,email:`permission-${staffId}@example.test`,name:'Permission test cashier',passwordHash:await passwordHash(password),emailVerifiedAt:new Date()}});await db.membership.create({data:{businessId:bid,userId:staffId,role:'CASHIER'}});
 try{
 await page.goto('http://localhost:3200/business-v2?tab=team');await page.getByRole('button',{name:'Edit access',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('[id="permission-catalogue.create"]').selectOption('true');await dialog.locator('[id="permission-catalogue.edit"]').selectOption('false');await dialog.locator('[id="permission-returns.approve"]').selectOption('true');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await dialog.waitFor({state:'hidden'});const m=await db.membership.findFirstOrThrow({where:{businessId:bid,userId:staffId}});assert.deepEqual(m.permissionOverrides,{'catalogue.create':true,'catalogue.edit':false,'returns.approve':true});
 for(const lang of ['en','ar']){await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await page.goto('http://localhost:3200/business-v2?tab=team');await page.getByRole('button',{name:lang==='ar'?'تعديل الصلاحيات':'Edit access',exact:true}).click();await dialog.locator('[id="permission-catalogue.create"]').waitFor();assert.equal(await dialog.locator('[id="permission-catalogue.create"]').inputValue(),'true');for(const width of [390,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:`../tmp/mfa-settings-design/permissions-${lang}-${width}.png`});}await page.keyboard.press('Escape');}
 console.log('PASS: full permission options, independent add/edit grants, persisted saves and AR/EN layouts.');
 }finally{await db.membership.deleteMany({where:{businessId:bid,userId:staffId}});await db.authUser.deleteMany({where:{id:staffId}});}
}finally{await browser.close();await db.authAudit.deleteMany({where:{userId:id}});await db.business.deleteMany({where:{id:bid}});await db.authUser.deleteMany({where:{id}});await db.$disconnect();}
