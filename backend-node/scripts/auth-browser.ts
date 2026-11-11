import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createDatabase } from '../src/database.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { decrypt, totp } from '../src/auth/crypto.js';
const settings = readAuthSettings(process.env);
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated TEST_DATABASE_URL required');
const base = settings.appOrigin;
const artifacts = process.env.AUTH_SCREENSHOTS ?? '../tmp/auth-design';
await mkdir(artifacts, { recursive: true });
const db = createDatabase(url);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const run = randomUUID().slice(0, 8), email = `browser-${run}@example.test`, pass = 'Browser testing passphrase 149!';
const mailIds: string[] = [];
async function mailToken(action: string) {
  const rows = await db.authMail.findMany({ where: { deliveredAt: null }, orderBy: { createdAt: 'desc' } });
  for (const row of rows) {
    let payload;
    try { payload = JSON.parse(decrypt(settings.key, row.payload, `mail:${row.id}`)); } catch { continue; }
    if (payload.to === email && payload.text.includes(`action=${action}&`)) {
      mailIds.push(row.id);
      return payload.text.match(/token=([A-Za-z0-9_-]{43})/)[1] as string;
    }
  }
  throw new Error('Expected email missing');
}
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  // Isolate the unchanged legacy AuthProvider; new /api/auth traffic is real.
  await page.route('http://127.0.0.1:8001/**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Not authenticated"}' }));
  await page.addInitScript(() => { if (!localStorage.getItem('profitlens_lang')) localStorage.setItem('profitlens_lang', 'en'); });
  await page.goto(`${base}/auth-v2`);
  await page.locator('#v2-email').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${artifacts}/new-en-1440-login.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Create a business account', exact: true }).click();
  await page.locator('#v2-name').fill('Browser Test Owner');
  await page.locator('#v2-businessName').fill('Browser Test Shop');
  await page.locator('#v2-email').fill(email); await page.locator('#v2-password').fill(pass);
  await page.getByRole('button', { name: 'Create business account', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'If eligible' }).waitFor();
  const token = await mailToken('verify');
  await page.goto(`${base}/auth-v2#action=verify&token=${token}`);
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Email verified' }).waitFor();
  if (page.url().includes(token)) throw new Error('Link token remains in URL');
  await page.locator('#v2-email').fill(email); await page.locator('#v2-password').fill(pass);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Protect your account' }).waitFor();
  await page.locator('#v2-password').fill(pass);
  await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
  const secret = await page.locator('#v2-secret').inputValue();
  await page.screenshot({ path: `${artifacts}/new-en-1440-mfa.png`, fullPage: true, animations: 'disabled', mask: [page.locator('#v2-secret')] });
  await page.locator('#v2-code').fill(totp(secret, email).generate());
  await page.getByRole('button', { name: 'Confirm authenticator', exact: true }).click();
  await page.getByRole('heading', { name: 'Save your recovery codes' }).waitFor();
  const recovery = await page.locator('code').first().innerText();
  await page.getByRole('button', { name: 'I have saved my recovery codes' }).click();
  await page.getByRole('heading', { name: 'Account security' }).waitFor();
  const csrfStatus = await page.evaluate(async () => (await fetch('http://localhost:4000/api/auth/logout', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status);
  if (csrfStatus !== 403) throw new Error('CSRF protection did not reject browser request');
  await page.screenshot({ path: `${artifacts}/new-en-1440-account.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Lock this device', exact: true }).click();
  await page.locator('#v2-email').fill(email); await page.locator('#v2-password').fill(pass);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Verify it is you' }).waitFor();
  await page.locator('#v2-code').fill(recovery);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'Account security' }).waitFor();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Forgot your password?', exact: true }).click();
  await page.locator('#v2-email').fill(email);
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'If eligible' }).waitFor();
  const reset = await mailToken('reset');
  await page.goto(`${base}/auth-v2#action=reset&token=${reset}`);
  await page.locator('#v2-password').fill(pass + ' changed');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Password updated' }).waitFor();
  for (const [lang, width, height] of [['ar', 390, 844], ['en', 390, 844], ['ar', 1440, 1000], ['ar', 320, 800]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(l => localStorage.setItem('profitlens_lang', l), lang);
    await page.goto(`${base}/auth-v2`); await page.locator('#v2-email').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, dir: document.documentElement.dir }));
    if (metrics.width > metrics.viewport || metrics.dir !== (lang === 'ar' ? 'rtl' : 'ltr')) throw new Error(`Layout failed: ${lang}/${width} ${JSON.stringify(metrics)}`);
    await page.screenshot({ path: `${artifacts}/new-${lang}-${width}-login.png`, fullPage: true, animations: 'disabled' });
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log('PASS: real signup, verification, MFA setup/recovery, cookie session, CSRF, lock, logout, reset, AR/EN responsive layouts.');
} finally {
  await browser.close();
  const user = await db.authUser.findUnique({ where: { email } });
  if (user) {
    const memberships = await db.membership.findMany({ where: { userId: user.id } });
    await db.authAudit.deleteMany({ where: { userId: user.id } });
    await db.business.deleteMany({ where: { id: { in: memberships.map(m => m.businessId) } } });
    await db.authUser.delete({ where: { id: user.id } });
  }
  await db.authMail.deleteMany({ where: { id: { in: mailIds } } });
  await db.$disconnect();
}
