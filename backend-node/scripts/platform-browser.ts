import { chromium, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { encrypt, passwordHash } from '../src/auth/crypto.js';
const settings = readAuthSettings(process.env), url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated TEST_DATABASE_URL required');
const db = createDatabase(url), auth = new AuthService(db, settings), browser = await chromium.launch({ channel: 'chrome', headless: true });
const ids: string[] = [], bids: string[] = [], errors: string[] = [], run = randomUUID().slice(0,8), businessName = `Platform Market ${run}`;
const artifacts = process.env.PLATFORM_SCREENSHOTS || '../tmp/platform-design'; await mkdir(artifacts, { recursive: true });
async function actor(admin: boolean) {
  const id = randomUUID(); ids.push(id);
  return db.authUser.create({ data: { id, name: admin ? 'Platform Operator' : `Customer ${run}`, email: `${id}@example.test`, passwordHash: await passwordHash('Platform browser password 152!'), platformRole: admin ? 'SUPER_ADMIN' : 'USER', emailVerifiedAt: new Date(), ...(admin ? { mfaSecret: encrypt(settings.key, 'JBSWY3DPEHPK3PXP', `mfa:${id}`) } : {}) } });
}
async function pageFor(id: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const user = await db.authUser.findUniqueOrThrow({ where: { id } }), session = await auth.transaction(tx => auth.makeSession(tx, user, true));
  await context.addCookies([{ name: settings.cookieName, value: session.token, url: 'http://localhost:4000', httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.route('http://127.0.0.1:8001/**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Not authenticated"}' }));
  await page.addInitScript(() => { if (!localStorage.getItem('profitlens_lang')) localStorage.setItem('profitlens_lang','en'); }); return page;
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name);
  await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true, animations: 'disabled' });
}
try {
  const admin = await actor(true), customer = await actor(false);
  const business = await db.business.create({ data: { name: businessName } }); bids.push(business.id);
  await db.membership.create({ data: { userId: customer.id, businessId: business.id, role: 'OWNER' } });
  const page = await pageFor(admin.id), ownerPage = await pageFor(customer.id);
  await ownerPage.goto(`${settings.appOrigin}/platform-v2`); await ownerPage.getByRole('alert').filter({ hasText: 'only to platform administrators' }).waitFor();
  assert.equal(await ownerPage.getByRole('button', { name: 'Customer businesses', exact: true }).count(), 0);
  await page.goto(`${settings.appOrigin}/auth-v2`); await page.getByRole('link', { name: 'Platform administration', exact: true }).click();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor(); await shot(page, 'new-en-1440-overview');
  await page.getByRole('button', { name: 'Customer businesses', exact: true }).click();
  await page.locator('#platform-search').fill(businessName); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('cell', { name: businessName, exact: true }).waitFor(); await shot(page, 'new-en-1440-businesses');
  await page.getByRole('button', { name: 'Suspend business', exact: true }).click();
  assert(await page.getByRole('button', { name: 'Confirm change', exact: true }).isDisabled());
  await page.locator('#platform-reason').fill('Requested by customer support');
  await shot(page, 'new-en-1440-confirm');
  await page.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.getByRole('cell', { name: 'Suspended', exact: true }).waitFor();
  assert((await db.business.findUniqueOrThrow({ where: { id: business.id } })).suspendedAt);
  await ownerPage.goto(`${settings.appOrigin}/business-v2`); await ownerPage.getByText('No active business access. Contact your business owner.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reactivate', exact: true }).click();
  // Another administrator changed the revision after this dialog opened.
  await db.business.update({ where: { id: business.id }, data: { revision: { increment: 1 } } });
  await page.locator('#platform-reason').fill('Customer request verified'); await page.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Someone changed' }).waitFor();
  await page.getByRole('button', { name: 'Reload latest', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Reactivate', exact: true }).click(); await page.locator('#platform-reason').fill('Customer request verified');
  await page.getByRole('button', { name: 'Confirm change', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.getByRole('cell', { name: 'Active', exact: true }).waitFor();
  await page.getByRole('button', { name: 'User accounts', exact: true }).click();
  await page.locator('#platform-search').fill(customer.email); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('cell', { name: customer.email, exact: true }).waitFor(); await page.getByRole('button', { name: 'Disable account', exact: true }).click();
  await page.locator('#platform-reason').fill('Customer requested account lock'); await page.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.getByRole('cell', { name: 'Disabled', exact: true }).waitFor();
  assert.equal(await db.authSession.count({ where: { userId: customer.id } }), 0);
  await page.getByRole('button', { name: 'Reactivate', exact: true }).click(); await page.locator('#platform-reason').fill('Customer identity verified'); await page.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.getByRole('cell', { name: 'Active', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Platform activity', exact: true }).click(); await page.getByRole('cell', { name: 'Customer identity verified', exact: true }).waitFor(); await shot(page, 'new-en-1440-audit');
  for (const lang of ['en','ar']) for (const width of [320,390,768,1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 }); await page.evaluate(l => localStorage.setItem('profitlens_lang',l),lang);
    await page.goto(`${settings.appOrigin}/platform-v2`); await page.getByRole('heading', { name: lang === 'ar' ? 'نظرة عامة' : 'Overview', exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('dir'),lang === 'ar' ? 'rtl' : 'ltr');
    await page.getByRole('button', { name: lang === 'ar' ? 'أنشطة العملاء' : 'Customer businesses', exact: true }).click();
    await page.locator('#platform-search').fill(businessName); await page.getByRole('button', { name: lang === 'ar' ? 'بحث' : 'Search', exact: true }).click();
    await page.getByRole('cell', { name: businessName, exact: true }).waitFor(); await shot(page, `new-${lang}-${width}-businesses`);
    if (width === 390) {
      const text = lang === 'ar' ? 'تعليق النشاط' : 'Suspend business'; await page.getByRole('button', { name: text, exact: true }).click();
      await shot(page, `new-${lang}-${width}-confirm`); await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.waitForFunction(t => document.activeElement?.textContent === t,text);
    }
  }
  assert.equal(errors.length,0,errors.join('; '));
  console.log('PASS: admin entry, customer denial, business suspend/reactivate, stale edits, user disable/reactivate, session revocation, audit, AR/EN responsive layouts and confirmation focus.');
} finally {
  await browser.close(); await db.platformAudit.deleteMany({ where: { actorId: { in: ids } } });
  await db.authAudit.deleteMany({ where: { userId: { in: ids } } }); await db.business.deleteMany({ where: { id: { in: bids } } }); await db.authUser.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect();
}
