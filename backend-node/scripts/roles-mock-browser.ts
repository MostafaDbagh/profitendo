import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import {createApp} from '../src/app.js';
import {pino} from 'pino';
if(!process.env.DATABASE_URL||!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
process.env.APP_ORIGIN='http://localhost:3200';
assert.equal(process.env.APP_ORIGIN, 'http://localhost:3200');
const db = createDatabase(process.env.DATABASE_URL!), auth = new AuthService(db, readAuthSettings(process.env));
const server=createApp({CORS_ORIGINS:['http://localhost:3200']},pino({level:'silent'}),async()=>{},auth).listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const port=(server.address() as {port:number}).port;
const staffId = randomUUID(), id = randomUUID(), bid = randomUUID(), baseline = process.argv.includes('--baseline');
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage();
await page.route('http://localhost:4200/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:`http://127.0.0.1:${port}${u.pathname}${u.search}`});await route.fulfill({response});});
await mkdir('../tmp/roles-design', {recursive:true});
try {
  const user = await db.authUser.create({data:{id,email:`roles-${id}@example.test`,name:'Role verification',passwordHash:'unusable',emailVerifiedAt:new Date()}});
  await db.business.create({data:{id:bid,name:'Role verification'}});
  await db.membership.create({data:{userId:id,businessId:bid,role:'OWNER'}});
  const session = await auth.transaction(tx=>auth.makeSession(tx,user,true));
  await page.context().addCookies([{name:'pl_session',value:session.token,url:'http://localhost:3200',httpOnly:true,sameSite:'Lax'}]);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  if (!baseline) {
    await db.authUser.create({data:{id:staffId,email:`staff-${staffId}@example.test`,name:'Role test staff',passwordHash:'unusable',emailVerifiedAt:new Date()}});
    await db.membership.create({data:{userId:staffId,businessId:bid,role:'CASHIER'}});
    await page.goto('http://localhost:3200');
    await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));
    await page.goto('http://localhost:3200/business?tab=roles');
    await page.getByRole('button',{name:'Add role',exact:true}).click();
    assert.equal(await page.getByRole('dialog').getByRole('checkbox').filter({visible:true}).count() > 0, true);
    await page.getByLabel('Role name',{exact:true}).fill('Inventory supervisor');
    await page.getByLabel('Delete / cancel draft returns',{exact:true}).check();
    await page.getByLabel('Delete / cancel draft returns',{exact:true}).uncheck();
    await page.getByLabel('View stock and movements',{exact:true}).check();
    await page.getByRole('dialog').getByRole('button',{name:'Add role',exact:true}).click();
    await page.getByRole('cell',{name:'Inventory supervisor Custom role',exact:true}).waitFor();
    await page.reload();
    await page.getByRole('cell',{name:'Inventory supervisor Custom role',exact:true}).waitFor();
    await page.getByRole('button',{name:'Add role',exact:true}).click();
    await page.getByLabel('Role name',{exact:true}).fill('Inventory supervisor');
    await page.getByRole('dialog').getByRole('button',{name:'Add role',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'already exists'}).waitFor();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert(await page.getByRole('button',{name:'Add role',exact:true}).evaluate(el=>el===document.activeElement));
    await page.goto('http://localhost:3200/business?tab=team');
    await page.getByRole('row').filter({hasText:'Role test staff'}).getByRole('button',{name:'Edit access',exact:true}).click();
    const roleId=(await db.businessRole.findFirstOrThrow({where:{businessId:bid}})).id;
    await page.locator('#member-role').selectOption(roleId);
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.getByRole('row').filter({hasText:'Role test staff'}).getByText('Inventory supervisor',{exact:true}).waitFor();
    const member=await db.membership.findUniqueOrThrow({where:{businessId_userId:{businessId:bid,userId:staffId}}});
    assert.equal(member.customRoleId,roleId);
    await page.goto('http://localhost:3200/business?tab=invitations');
    await page.locator('#invite-role option').filter({hasText:'Inventory supervisor'}).waitFor({state:'attached'});
    await page.locator('#invite-role').selectOption(roleId);
  }
  for (const lang of ['en','ar']) {
    await page.goto('http://localhost:3200');
    await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);
    await page.goto('http://localhost:3200/business?tab=roles');
    await page.locator('tbody tr').first().waitFor();
    for (const width of (baseline ? [390,1440] : [320,390,768,1024,1440])) {
      await page.setViewportSize({width,height:1000});
      await page.locator('main').scrollIntoViewIfNeeded();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:`../tmp/roles-design/${baseline?'before':'after'}-${lang}-${width}.png`});
      if (!baseline) {
        await page.getByRole('button',{name:lang==='ar'?'إضافة دور':'Add role',exact:true}).click();
        await page.locator('#role-name').fill(lang==='ar'?'مشرف المخزون':'Inventory supervisor');
        await page.getByRole('dialog').evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)); });
        await page.screenshot({path:`../tmp/roles-design/form-${lang}-${width}.png`});
        await page.keyboard.press('Escape');
        await page.waitForFunction(label => document.activeElement?.textContent?.trim() === label, lang==='ar'?'إضافة دور':'Add role');
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: role screen screenshots AR/EN desktop/mobile');
} catch (error) {
  await page.screenshot({path:'../tmp/roles-design/failure.png'});
  throw error;
} finally {
  await browser.close();
  await db.authAudit.deleteMany({where:{businessId:bid}});
  await db.business.deleteMany({where:{id:bid}});
  await db.authUser.deleteMany({where:{id:{in:[id,staffId]}}});
  await db.$disconnect();
await new Promise<void>(resolve=>server.close(()=>resolve()));
}
