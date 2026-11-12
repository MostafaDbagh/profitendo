import {fork,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium,type Page} from 'playwright';
import Excel from 'exceljs';
import {pino} from 'pino';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/app.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {encrypt,passwordHash} from '../src/auth/crypto.js';
import {columns} from '../src/catalogue/workbook.js';
import {postStock} from '../src/operations/inventory.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const key=process.env.RECOVERY_KEY||randomBytes(32).toString('hex');
const settings=readAuthSettings({AUTH_ENCRYPTION_KEY:key,APP_ORIGIN:'http://localhost:3300'});
const db=createDatabase(url),auth=new AuthService(db,settings);
if(process.env.RECOVERY_CHILD==='true'){
 const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
 app.listen(4302,'localhost',()=>process.send?.('ready'));
}else{
 let child:ChildProcess|undefined;
 async function start(){
  child=fork(fileURLToPath(import.meta.url),[],{execArgv:['--import','tsx'],env:{...process.env,RECOVERY_KEY:key,RECOVERY_CHILD:'true'},stdio:['ignore','inherit','inherit','ipc']});
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Test API startup timeout')),15000);child!.once('message',message=>{clearTimeout(timer);message==='ready'?resolve():reject(new Error('Unexpected startup message'));});child!.once('error',reject);});
 }
 async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill('SIGKILL');await exited;}child=undefined;}
 const browser=await chromium.launch({channel:'chrome',headless:true}),artifacts='../tmp/recovery-ui';await mkdir(artifacts,{recursive:true});
 let bid='',uid='',planId='',page:Page|undefined;
 const errors:string[]=[];
 async function shot(name:string){await page!.screenshot({path:`${artifacts}/${name}.png`,fullPage:true});}
 try{
  await start();
  const business=await db.business.create({data:{name:'Recovery UI test'}});bid=business.id;
  const plan=await db.billingPlan.create({data:{code:randomUUID(),name:'Recovery test',nameAr:'اختبار',trialDays:14,maxMembers:3,maxWarehouses:1,maxShops:1}});planId=plan.id;
  await db.businessSubscription.create({data:{businessId:bid,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
  uid=randomUUID();const user=await db.authUser.create({data:{id:uid,name:'Recovery tester',email:`${uid}@example.test`,emailVerifiedAt:new Date(),passwordHash:await passwordHash('Recovery browser password 914!'),mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${uid}`)}});
  await db.membership.create({data:{businessId:bid,userId:uid,role:'OWNER'}});
  const session=await auth.transaction(tx=>auth.makeSession(tx,user,true));
  const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4300',httpOnly:true,sameSite:'Lax'}]);
  let failure:'none'|'preview-before'|'commit-after'|'checkout-after'='none';
  let commitId='',checkoutKey='';
  await context.route('http://localhost:4300/api/**',async route=>{
   const u=new URL(route.request().url());
   if(failure==='preview-before'&&u.pathname.endsWith('/preview')){failure='none';await route.abort('connectionfailed');return;}
   let response;try{response=await route.fetch({url:`http://localhost:4302${u.pathname}${u.search}`,maxRetries:0,timeout:5000});}catch{await route.abort('connectionfailed');return;}
   if((failure==='commit-after'&&u.pathname.endsWith('/commit'))||(failure==='checkout-after'&&u.pathname.endsWith('/checkout'))){
    assert.equal(response.status(),200);if(failure==='commit-after')commitId=u.pathname.split('/').at(-2)!;else checkoutKey=route.request().postDataJSON().clientKey;
    failure='none';await stop();await route.abort('connectionfailed');return;
   }
   await route.fulfill({response});
  });
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('profitlens_lang','en'));
  await page.goto(settings.appOrigin+'/business-v2');await page.getByRole('navigation').getByRole('button',{name:'Products',exact:true}).click();await page.getByRole('button',{name:'Import Excel',exact:true}).click();
  const wb=new Excel.Workbook(),sheet=wb.addWorksheet('Products');sheet.addRow([...columns]);sheet.addRow(['RECOVERY-001','Recovery milk','LITRE','1','3','0','','','','','1234567001','true']);
  await page.locator('#product-import-file').setInputFiles({name:'recovery.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await wb.xlsx.writeBuffer())});
  failure='preview-before';await page.getByRole('button',{name:'Preview import',exact:true}).click();await page.getByRole('alert').filter({hasText:'Cannot connect to the server'}).waitFor();assert.equal(await db.product.count({where:{businessId:bid}}),0);await shot('01-interrupted-preview');
  await page.getByRole('button',{name:'Preview import',exact:true}).click();await page.getByRole('button',{name:'Confirm import',exact:true}).waitFor();
  for(const [lang,width] of [['en',390],['en',1440],['ar',390],['ar',1440]] as const){
   // Locale switches are applied between previews, while the dialog is closed.
   await page.setViewportSize({width,height:1000});
   await stop();
   // Exercise keyboard focus containment, Escape, and the visible Cancel control.
   for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert(await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)));}
   if(width===390)await page.getByRole('dialog').getByRole('button',{name:lang==='ar'?'إلغاء':'Cancel',exact:true}).click();else await page.keyboard.press('Escape');
   await page.getByRole('dialog').waitFor({state:'hidden',timeout:4000});
   await page.waitForFunction(()=>document.activeElement?.textContent?.includes('Excel')||document.activeElement?.getAttribute('role')==='alert');
   assert.equal(await db.product.count({where:{businessId:bid}}),0);await shot(`dismiss-${lang}-${width}`);await start();
   const retry=page.getByRole('button',{name:lang==='ar'?'إعادة المحاولة':'Try again',exact:true});if(await retry.count()){await retry.click();await page.getByRole('table').waitFor();}
   const nextLang=lang==='en'&&width===1440?'ar':lang==='ar'&&width===1440?'en':lang;
   if(nextLang!==lang)await page.getByRole('button',{name:nextLang==='ar'?'العربية':'English',exact:true}).click();
   await page.getByRole('button',{name:nextLang==='ar'?'استيراد Excel':'Import Excel',exact:true}).click();await page.locator('#product-import-file').setInputFiles({name:'recovery.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await wb.xlsx.writeBuffer())});await page.getByRole('button',{name:nextLang==='ar'?'معاينة الاستيراد':'Preview import',exact:true}).click();await page.getByRole('button',{name:nextLang==='ar'?'تأكيد الاستيراد':'Confirm import',exact:true}).waitFor();
  }
  console.log('PASS: offline import cancellation and Escape, focus trap/return, AR/EN mobile/desktop; no product writes');
  failure='commit-after';await page.getByRole('button',{name:'Confirm import',exact:true}).click();await page.getByRole('alert').filter({hasText:'Cannot connect to the server'}).waitFor();assert.equal(await db.product.count({where:{businessId:bid}}),1);await shot('02-commit-response-lost');
  await start();await page.getByRole('button',{name:'Confirm import',exact:true}).click();await page.getByRole('status').filter({hasText:'Products imported'}).waitFor();assert.equal(await db.product.count({where:{businessId:bid}}),1);assert.equal(await db.authAudit.count({where:{businessId:bid,action:'products.imported',targetId:commitId}}),1);await shot('03-import-recovered');
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).last().click();await page.getByRole('cell',{name:'RECOVERY-001',exact:true}).waitFor();console.log('PASS: UI interrupted preview, committed import response lost, SIGKILL/restart, same-preview retry creates one product');
  const shop=await db.location.create({data:{businessId:bid,code:'SHOP',name:'Recovery shop',kind:'SHOP'}}),product=await db.product.findFirstOrThrow({where:{businessId:bid}});
  await auth.transaction(tx=>postStock(tx,{businessId:bid,locationId:shop.id,productId:product.id,delta:'10',type:'TEST_OPENING',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'Recovery opening',actorId:uid,notes:''}));
  await page.getByRole('navigation').getByRole('button',{name:'Sales',exact:true}).click();await page.getByRole('button',{name:'New sale',exact:true}).click();await page.getByRole('button',{name:'Choose a shop',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/Recovery shop/}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.locator('#pos-barcode').fill('1234567001');await page.locator('#pos-barcode').press('Enter');await page.locator('#sale-quantity-0').fill('2');await page.getByRole('button',{name:'Review sale',exact:true}).click();await page.getByTestId('sale-receipt').waitFor();await page.locator('#sale-received').fill('10');
  failure='checkout-after';await page.getByRole('button',{name:'Record payment & complete sale',exact:true}).click();await page.getByRole('alert').filter({hasText:'Cannot connect to the server'}).waitFor();await shot('04-checkout-response-lost');assert(checkoutKey);assert.equal(await db.salePayment.count({where:{businessId:bid}}),1);
  await start();await page.getByRole('button',{name:'Record payment & complete sale',exact:true}).click();await page.getByRole('link',{name:'Open printable receipt',exact:true}).waitFor();await shot('05-checkout-recovered');
  assert.equal(await db.salePayment.count({where:{businessId:bid}}),1);assert.equal((await db.stockBalance.findFirstOrThrow({where:{businessId:bid}})).onHand.toFixed(4),'8.0000');assert.equal(await db.stockMovement.count({where:{businessId:bid,type:'SALE'}}),1);
  console.log('PASS: UI checkout response lost after commit, SIGKILL/restart, retry produces one payment and one stock deduction');
  assert.deepEqual(errors,[]);
 }catch(error){if(page){await shot('failure').catch(()=>{});console.error((await page.locator('body').innerText()).slice(-3500));}throw error;}
 finally{
  await browser.close();await stop();
  if(bid){await db.$transaction(async tx=>{const triggers=[['stock_movements','stock_history_immutable'],['sale_payments','sale_payments_immutable'],['sale_lines','completed_sale_lines_immutable'],['sales','completed_sale_immutable']];for(const [t,n]of triggers)await tx.$executeRawUnsafe(`ALTER TABLE ${t} DISABLE TRIGGER ${n}`);const where={businessId:bid};await tx.stockMovement.deleteMany({where});await tx.salePayment.deleteMany({where});await tx.saleLine.deleteMany({where});await tx.sale.deleteMany({where});for(const [t,n]of triggers)await tx.$executeRawUnsafe(`ALTER TABLE ${t} ENABLE TRIGGER ${n}`);});const where={businessId:bid};await db.productImport.deleteMany({where});await db.stockBalance.deleteMany({where});await db.productBarcode.deleteMany({where});await db.product.deleteMany({where});await db.location.deleteMany({where});await db.authAudit.deleteMany({where});await db.business.delete({where:{id:bid}});}
  if(uid)await db.authUser.deleteMany({where:{id:uid}});if(planId)await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
 }
}
