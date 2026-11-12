import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { stagingTarget } from '../src/staging/guard.js';
stagingTarget(process.env);
assert.equal(process.env.APP_ORIGIN, 'http://localhost:3200');
const db = createDatabase(process.env.DATABASE_URL!), auth = new AuthService(db, readAuthSettings(process.env));
const staffId = randomUUID(), id = randomUUID(), bid = randomUUID(), baseline = process.argv.includes('--baseline');
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage();
await mkdir('../tmp/team-design', {recursive:true});
try {
  const user = await db.authUser.create({data:{id,email:`roles-${id}@example.test`,name:'Team verification',passwordHash:'unusable',emailVerifiedAt:new Date()}});
  await db.business.create({data:{id:bid,name:'Team verification'}});
  await db.membership.create({data:{userId:id,businessId:bid,role:'OWNER'}});
  const session = await auth.transaction(tx=>auth.makeSession(tx,user,true));
  await page.context().addCookies([{name:'pl_session',value:session.token,url:'http://localhost:3200',httpOnly:true,sameSite:'Lax'}]);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  if (!baseline) {
    const custom = await db.businessRole.create({data:{businessId:bid,name:'Stock reader',nameKey:'stock reader',permissions:{'business.view':true,'inventory.view':true}}});
    await page.goto('http://localhost:3200');
    await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));
    await page.goto('http://localhost:3200/business?tab=team');
    await page.getByRole('button',{name:'Add team member',exact:true}).click();
    await page.locator('#add-member-name').fill('Ahmed Ali');
    await page.locator('#add-member-password').fill('Browser-only test password');
    await page.locator('#add-member-email').fill('invitee@example.test');
    await page.locator('#add-member-role').selectOption(custom.id);
    // UI transport checks only: integration tests cover the real invitation service.
    // Do not queue or send mail from this staging browser check.
    await page.route('**/api/businesses/*/invitations', async route => {
      assert.deepEqual(route.request().postDataJSON(),{password:'Browser-only test password',name:'Ahmed Ali',email:'invitee@example.test',customRoleId:custom.id});
      assert(route.request().headers()['x-csrf-token']);
      await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'MEMBER_EXISTS'}})});
    });
    await page.getByRole('dialog').locator('form button').last().click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal(await page.locator('#add-member-email').inputValue(),'invitee@example.test');
    await page.unroute('**/api/businesses/*/invitations');
    await page.route('**/api/businesses/*/invitations', route => route.fulfill({status:202,contentType:'application/json',body:'{"detail":"Invitation queued."}'}));
    await page.getByRole('dialog').locator('form button').last().click();
    await page.getByRole('status').filter({hasText:'Invitation queued'}).waitFor();
    assert.equal(await page.getByRole('dialog').count(),0);
    await page.unroute('**/api/businesses/*/invitations');
  }
  for (const lang of ['en','ar']) {
    await page.goto('http://localhost:3200');
    await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);
    await page.goto('http://localhost:3200/business?tab=team');
    await page.locator('tbody tr').first().waitFor();
    for (const width of (baseline ? [390,1440] : [320,390,768,1024,1440])) {
      await page.setViewportSize({width,height:1000});
      await page.locator('main').scrollIntoViewIfNeeded();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:`../tmp/team-design/${baseline?'before':'after'}-${lang}-${width}.png`});
      if (!baseline) {
        const label=lang==='ar'?'إضافة عضو للفريق':'Add team member';
        await page.getByRole('button',{name:label,exact:true}).click();
        await page.locator('#add-member-name').fill(lang==='ar'?'أحمد علي':'Ahmed Ali');
        await page.locator('#add-member-email').fill('new.colleague@example.test');
        await page.getByRole('dialog').evaluate(async el=>{await Promise.all(el.getAnimations().map(animation=>animation.finished));});
        const actions=page.getByRole('dialog').locator('form button');
        const cancelBox=await actions.first().boundingBox(), submitBox=await actions.last().boundingBox();
        assert(cancelBox && submitBox && submitBox.x > cancelBox.x);
        const dialogBox=await page.getByRole('dialog').boundingBox();
        assert(dialogBox && dialogBox.x+dialogBox.width-submitBox.x-submitBox.width < 40);
        await page.screenshot({path:`../tmp/team-design/form-${lang}-${width}.png`});
        await page.keyboard.press('Escape');
        await page.waitForFunction(text=>document.activeElement?.textContent?.trim()===text,label);
        await page.goto('http://localhost:3200/business?tab=invitations');
        await page.locator('#invite-member-name').fill(lang==='ar'?'أحمد علي':'Ahmed Ali');
        await page.locator('#team-email').fill('colleague@example.test');
        const passwordField = page.locator('#invite-password');
        assert.equal(await passwordField.evaluate(el => getComputedStyle(el).direction),lang==='ar'?'rtl':'ltr');
        await passwordField.fill('Browser-only password');
        assert.equal(await passwordField.evaluate(el => getComputedStyle(el).direction),'ltr');
        await passwordField.fill('');
        assert.equal(await passwordField.evaluate(el => getComputedStyle(el).direction),lang==='ar'?'rtl':'ltr');
        await page.locator('main').scrollIntoViewIfNeeded();
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:`../tmp/team-design/invitations-${lang}-${width}.png`});
        await page.goto('http://localhost:3200/business?tab=team');
        await page.locator('tbody tr').first().waitFor();

      }
    }
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: team screen screenshots AR/EN desktop/mobile');
} catch (error) {
  await page.screenshot({path:'../tmp/team-design/failure.png'});
  throw error;
} finally {
  await browser.close();
  await db.authAudit.deleteMany({where:{businessId:bid}});
  await db.business.deleteMany({where:{id:bid}});
  await db.authUser.deleteMany({where:{id:{in:[id,staffId]}}});
  await db.$disconnect();
}
