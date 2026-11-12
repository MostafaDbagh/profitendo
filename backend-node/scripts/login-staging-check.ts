import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {stagingTarget} from '../src/staging/guard.js';
stagingTarget(process.env);
if(!process.env.SEED_PASSWORD)throw new Error('Staging password is missing');
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});
try{
 await page.goto('http://localhost:3200/auth-v2');await page.locator('#v2-email').fill('owner-trial@demo.example.test');await page.locator('#v2-password').fill(process.env.SEED_PASSWORD);
 await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();
 await Promise.race([page.locator('#v2-code').waitFor(),page.getByTestId('business-dashboard').waitFor()]);
 if(await page.locator('#v2-code').isVisible()){await page.locator('#v2-code').fill('123456');await page.locator('[data-testid="auth-v2-form"] button[type="submit"]').click();}
 await page.getByTestId('business-dashboard').waitFor();await mkdir('../tmp/login-check',{recursive:true});await page.screenshot({path:'../tmp/login-check/dashboard.png'});
 console.log('PASS: owner-trial staging login, MFA, and business dashboard.');
}finally{await browser.close();}
