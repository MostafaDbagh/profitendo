import { chromium, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { encrypt, passwordHash, decrypt } from '../src/auth/crypto.js';
const settings = readAuthSettings(process.env), url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated TEST_DATABASE_URL required');
const db = createDatabase(url), auth = new AuthService(db, settings);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const users: string[] = [], businesses: string[] = [], errors: string[] = [];
const run = randomUUID().slice(0,8), invitationEmail = `invite-${run}@example.test`;
const artifacts = process.env.BUSINESS_SCREENSHOTS || '../tmp/business-design';
await mkdir(artifacts, { recursive: true });
async function user(name: string, owner = false) {
  const id = randomUUID(); users.push(id);
  return db.authUser.create({ data: { id, name, email: `${id}@example.test`, emailVerifiedAt: new Date(), passwordHash: await passwordHash('Browser test password 184!'), ...(owner ? { mfaSecret: encrypt(settings.key, 'JBSWY3DPEHPK3PXP', `mfa:${id}`) } : {}) } });
}
async function pageFor(userId?: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (userId) {
    const account = await db.authUser.findUniqueOrThrow({ where: { id: userId } });
    const session = await auth.transaction(tx => auth.makeSession(tx, account, true));
    await context.addCookies([{ name: settings.cookieName, value: session.token, url: 'http://localhost:4000', httpOnly: true, sameSite: 'Lax' }]);
  }
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.route('http://127.0.0.1:8001/**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Not authenticated"}' }));
  await page.addInitScript(() => { if (!localStorage.getItem('profitlens_lang')) localStorage.setItem('profitlens_lang', 'en'); });
  return page;
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow: ${name}`);
  await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true, animations: 'disabled' });
}
try {
  const owner = await user('Business Owner', true), staff = await user('Sample Team Member');
  const a = await db.business.create({ data: { name: 'Alpha Market' } }); businesses.push(a.id);
  const b = await db.business.create({ data: { name: 'Beta Stores' } }); businesses.push(b.id);
  await db.businessSubscription.create({ data: { businessId: a.id, planId: '8ac8ae27-f871-47f2-8d70-e38b0aed295c', trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 86400000) } });
  await db.membership.createMany({ data: [{ userId: owner.id, businessId: a.id, role: 'OWNER' }, { userId: owner.id, businessId: b.id, role: 'OWNER' }, { userId: staff.id, businessId: a.id, role: 'CASHIER' }] });
  const page = await pageFor(owner.id);
  await page.goto(`${settings.appOrigin}/business-v2`);
  await page.locator('#business-name').waitFor();
  assert.equal(await page.locator('#business-name').getAttribute('placeholder'), 'e.g. Green Market');
  await screenshot(page, 'new-en-1440-settings');
  await page.locator('#business-name').fill('Alpha Market Updated');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Changes saved' }).waitFor();
  assert.equal((await db.business.findUniqueOrThrow({ where: { id: a.id } })).name, 'Alpha Market Updated');
  // A stale editor must never overwrite a newer saved version.
  await db.business.update({ where: { id: a.id }, data: { revision: { increment: 1 }, name: 'Alpha Latest' } });
  await page.locator('#business-name').fill('Stale name');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Someone changed' }).waitFor();
  assert(await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('#business-name') as HTMLInputElement)?.value === 'Alpha Latest');
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await page.getByRole('cell', { name: 'Sample Team Member', exact: true }).waitFor();
  await screenshot(page, 'new-en-1440-team');
  await page.getByRole('button', { name: 'Edit access', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.locator('#member-role').selectOption('OPERATIONS_MANAGER');
  await page.locator('[id="permission-audit.view"]').selectOption('false');
  await screenshot(page, 'new-en-1440-access');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  let member = await db.membership.findUniqueOrThrow({ where: { businessId_userId: { businessId: a.id, userId: staff.id } } });
  assert.equal(member.role, 'OPERATIONS_MANAGER'); assert.equal((member.permissionOverrides as Record<string,boolean>)['audit.view'], false);
  await page.getByRole('button', { name: 'Edit access', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Active', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('cell', { name: 'Inactive', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit access', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Active', exact: true }).check();
  await page.locator('#member-role').selectOption('CASHIER');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Invitations', exact: true }).click();
  await page.locator('#team-email').fill(invitationEmail);
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await page.getByRole('cell', { name: invitationEmail, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Revoke invitation', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke invitation', exact: true }).click();
  await page.getByRole('cell', { name: 'Revoked', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Roles & access', exact: true }).click();
  await page.getByRole('cell', { name: 'Operations manager', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Activity history', exact: true }).click();
  await page.getByRole('cell', { name: 'Business settings changed', exact: true }).first().waitFor();
  // Switching businesses unmounts prior records immediately.
  await page.locator('#active-business').selectOption(b.id);
  await page.locator('#business-name').waitFor(); assert.equal(await page.locator('#business-name').inputValue(), 'Beta Stores');
  assert.equal(await page.getByText(invitationEmail, { exact: true }).count(), 0);
  await page.locator('#active-business').selectOption(a.id); await page.locator('#business-name').waitFor();
  const viewer = await pageFor(staff.id); await viewer.goto(`${settings.appOrigin}/business-v2`); await viewer.locator('#business-name').waitFor();
  assert(await viewer.locator('#business-name').isDisabled());
  assert.equal(await viewer.getByRole('button', { name: 'Team', exact: true }).count(), 0);
  assert.equal(await viewer.getByRole('button', { name: 'Save changes', exact: true }).count(), 0);
  for (const lang of ['en','ar']) for (const width of [320,390,768,1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.evaluate(l => localStorage.setItem('profitlens_lang', l), lang);
    await page.goto(`${settings.appOrigin}/business-v2`); await page.locator('#business-name').waitFor();
    assert.equal(await page.locator('html').getAttribute('dir'), lang === 'ar' ? 'rtl' : 'ltr');
    await screenshot(page, `new-${lang}-${width}-settings`);
    await page.getByRole('button', { name: lang === 'ar' ? 'الفريق' : 'Team', exact: true }).click();
    await page.getByRole('cell', { name: 'Sample Team Member', exact: true }).waitFor();
    await screenshot(page, `new-${lang}-${width}-team`);
    if (width === 390) {
      await page.getByRole('button', { name: lang === 'ar' ? 'تعديل الصلاحيات' : 'Edit access', exact: true }).click();
      await screenshot(page, `new-${lang}-${width}-access`);
      await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.waitForFunction(text => document.activeElement?.textContent === text, lang === 'ar' ? 'تعديل الصلاحيات' : 'Edit access');
    }
  }
  const signedOut = await pageFor(); await signedOut.goto(`${settings.appOrigin}/business-v2`); await signedOut.locator('#v2-email').waitFor();
  assert(signedOut.url().includes('/auth-v2'));
  await screenshot(signedOut, 'placeholders-en-1440-login');
  assert.equal(errors.length, 0, errors.join('; '));
  console.log('PASS: settings/stale edits, roles/overrides, disable/reactivate, invitations/revocation, audit, business switching, read-only staff, auth redirect, AR/EN responsive layouts and dialog focus.');
} finally {
  await browser.close();
  const mails = await db.authMail.findMany();
  for (const mail of mails) { try { if (JSON.parse(decrypt(settings.key, mail.payload, `mail:${mail.id}`)).to === invitationEmail) await db.authMail.delete({ where: { id: mail.id } }); } catch { /* Unrelated encrypted mail is left untouched. */ } }
  await db.authAudit.deleteMany({ where: { OR: [{ businessId: { in: businesses } }, { userId: { in: users } }] } });
  await db.business.deleteMany({ where: { id: { in: businesses } } });
  await db.authUser.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
}
