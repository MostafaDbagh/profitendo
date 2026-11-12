import { chromium, type Page } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { encrypt, passwordHash } from '../src/auth/crypto.js';
import { postStock } from '../src/operations/inventory.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3300'}),db=createDatabase(url),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const server=await new Promise<ReturnType<typeof app.listen>>((resolve,reject)=>{const s=app.listen(4300,'localhost',()=>resolve(s));s.on('error',reject);});
const browser=await chromium.launch({channel:'chrome',headless:true}),ids:string[]=[],bids:string[]=[],errors:string[]=[],artifacts='../tmp/sales-design';await mkdir(artifacts,{recursive:true});
let planId:string|undefined,primaryPage:Page|undefined;
async function shot(page:Page,name:string){
 await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.waitForTimeout(200);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);
 for(const dialog of await page.getByRole('dialog').all())assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),`${name} dialog overflow`);
 await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});
}
async function actor(role:'OWNER'|'CASHIER',businessId:string,locationId?:string){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:role==='OWNER'?'Operations Owner':locationId?'Location Employee':'Viewer',email:`${id}@example.test`,passwordHash:await passwordHash('Browser transfer password 194!'),emailVerifiedAt:new Date(),...(role==='OWNER'?{mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}:{})}});
 const member=await db.membership.create({data:{userId:id,businessId,role}});
 if(locationId)await db.locationAssignment.create({data:{businessId,locationId,membershipId:member.id}});
 const session=await auth.transaction(tx=>auth.makeSession(tx,user,true));
 const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4300',httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return {page,user};
}
async function open(page:Page,lang='en'){await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('navigation').getByRole('button',{name:lang==='ar'?'المبيعات':'Sales',exact:true}).click();await page.getByRole('table').waitFor();}
async function choose(page:Page,label:string,name:string){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:new RegExp(name)}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
async function scan(page:Page,value='001234567890'){const input=page.locator('#pos-barcode');await input.fill(value);await input.press('Enter');await page.waitForFunction(()=>document.activeElement?.id==='pos-barcode'&&!!document.querySelector('#sale-quantity-0'));}
async function start(page:Page,lang='en'){await open(page,lang);await page.getByRole('button',{name:lang==='ar'?'بيع جديد':'New sale',exact:true}).click();await choose(page,lang==='ar'?'اختر المتجر':'Choose a shop','Downtown shop');}
try{
 const business=await db.business.create({data:{name:'Sales Browser Market'}});bids.push(business.id);
 planId=(await db.billingPlan.create({data:{code:`browser-sales-${randomUUID()}`,name:'Sales browser',nameAr:'اختبار',trialDays:14,maxMembers:10,maxWarehouses:10,maxShops:10}})).id;
 await db.businessSubscription.create({data:{businessId:business.id,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const shop=await db.location.create({data:{businessId:business.id,code:'SHOP',name:'Downtown shop',kind:'SHOP'}});
 const product=await db.product.create({data:{businessId:business.id,sku:'MILK-001',name:'Fresh milk 1 litre',unit:'LITRE',purchasePrice:'9.8765',sellingPrice:'12'}});
 await db.productBarcode.create({data:{businessId:business.id,productId:product.id,value:'001234567890'}});
 const pack=await db.productPack.create({data:{businessId:business.id,productId:product.id,name:'Six bottles',baseQuantity:'6'}});
 const owner=await actor('OWNER',business.id),page=owner.page,cashier=(await actor('CASHIER',business.id,shop.id)).page;primaryPage=page;
 await auth.transaction(tx=>postStock(tx,{businessId:business.id,locationId:shop.id,productId:product.id,delta:'100',type:'TEST_OPENING',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'test opening',actorId:owner.user.id,notes:''}));
 await start(page);await scan(page);await scan(page);await page.waitForFunction(()=>((document.querySelector('#sale-quantity-0') as HTMLInputElement)?.value)==='2.0000');await page.locator('#sale-pack-0').selectOption(pack.id);await scan(page);await page.locator('#sale-quantity-1').waitFor();await page.locator('#sale-discount-0').fill('4');await page.locator('#sale-reason-0').fill('Approved weekend promotion');
 for(const lang of ['en','ar'])for(const width of [320,390,768,1024,1440]){
  if(await page.evaluate(()=>document.documentElement.lang)!==lang)await page.getByRole('button',{name:lang==='ar'?'العربية':'English',exact:true}).click();await page.setViewportSize({width,height:width<768?844:1100});await shot(page,`new-${lang}-${width}-editor`);
 }
 await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('button',{name:'Review sale',exact:true}).click();await page.getByTestId('sale-receipt').waitFor();
 const doc=await db.sale.findFirstOrThrow({where:{businessId:business.id}});assert.equal(doc.total.toFixed(2),'152.00');assert.equal((await db.stockBalance.findFirstOrThrow({where:{businessId:business.id,locationId:shop.id}})).onHand.toFixed(4),'100.0000');
 for(const lang of ['en','ar'])for(const width of [320,390,768,1024,1440]){if(await page.evaluate(()=>document.documentElement.lang)!==lang)await page.getByRole('button',{name:lang==='ar'?'العربية':'English',exact:true}).click();await page.setViewportSize({width,height:width<768?844:1100});await shot(page,`new-${lang}-${width}-checkout`);}
 await page.getByRole('button',{name:'English',exact:true}).click();await page.locator('#sale-received').fill('200');await page.getByRole('button',{name:'Record payment & complete sale',exact:true}).click();await page.getByRole('link',{name:'Open printable receipt',exact:true}).waitFor();assert.equal((await db.salePayment.findFirstOrThrow({where:{saleId:doc.id}})).change.toFixed(2),'48.00');assert.equal((await db.stockBalance.findFirstOrThrow({where:{businessId:business.id,locationId:shop.id}})).onHand.toFixed(4),'87.0000');
 const receipt=await page.context().newPage();await receipt.goto(`${settings.appOrigin}/sales-v2/${business.id}/${doc.id}/receipt`);await receipt.getByRole('button',{name:'Print receipt',exact:true}).waitFor();await shot(receipt,'new-en-printable');await receipt.emulateMedia({media:'print'});await shot(receipt,'new-en-print-media');await receipt.close();
 await start(cashier);await scan(cashier);assert.equal(await cashier.locator('#sale-discount-0').count(),0);assert(!(await cashier.content()).includes('9.8765'));await cashier.locator('#sale-quantity-0').fill('1000');await cashier.getByRole('button',{name:'Review sale',exact:true}).click();await cashier.getByRole('button',{name:'Record payment & complete sale',exact:true}).click();await cashier.getByRole('alert').waitFor();await shot(cashier,'new-en-insufficient-stock');assert.equal(await db.salePayment.count({where:{businessId:business.id}}),1);
 await cashier.getByRole('button',{name:'Edit / refresh draft',exact:true}).click();await cashier.locator('#sale-quantity-0').fill('1');await cashier.getByRole('button',{name:'Update prices & review',exact:true}).click();await cashier.locator('#sale-method').selectOption('CARD');await cashier.locator('#sale-payment-reference').fill('Terminal 004521');await shot(cashier,'new-en-card-checkout');await cashier.getByRole('button',{name:'Record payment & complete sale',exact:true}).click();await cashier.getByRole('link',{name:'Open printable receipt',exact:true}).waitFor();
 for(const lang of ['en','ar'])for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:width<768?844:1100});await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await open(page,lang);await shot(page,`new-${lang}-${width}-list`);await page.getByRole('button',{name:lang==='ar'?'فتح المستند':'Open document',exact:true}).first().click();await page.getByTestId('sale-receipt').waitFor();await shot(page,`new-${lang}-${width}-receipt`);}
 await start(page,'ar');await scan(page);await page.getByRole('button',{name:'مراجعة البيع',exact:true}).click();await page.getByRole('button',{name:'إلغاء المسودة',exact:true}).click();await shot(page,'new-ar-cancel-dialog');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.textContent==='إلغاء المسودة');
 assert.equal(errors.length,0,errors.join('; '));console.log('PASS: repeated scans, mixed packs, owner discounts, cashier restrictions, draft stock unchanged, cash change, stock failure, external card record, print layout, AR/EN 320/390/768/1024/1440 and focus restore.');
}catch(error){if(primaryPage){await primaryPage.screenshot({path:`${artifacts}/failure.png`,fullPage:true}).catch(()=>{});console.error((await primaryPage.locator('body').innerText()).slice(-5000));}throw error;}
finally{
 await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));
 await db.$transaction(async tx=>{
  for(const [table,trigger] of [['stock_movements','stock_history_immutable'],['sale_payments','sale_payments_immutable'],['sale_lines','completed_sale_lines_immutable'],['sales','completed_sale_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  await tx.stockMovement.deleteMany({where:{businessId:{in:bids}}});await tx.salePayment.deleteMany({where:{businessId:{in:bids}}});await tx.saleLine.deleteMany({where:{businessId:{in:bids}}});await tx.sale.deleteMany({where:{businessId:{in:bids}}});
  for(const [table,trigger] of [['stock_movements','stock_history_immutable'],['sale_payments','sale_payments_immutable'],['sale_lines','completed_sale_lines_immutable'],['sales','completed_sale_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
 });
 await db.stockBalance.deleteMany({where:{businessId:{in:bids}}});await db.productBarcode.deleteMany({where:{businessId:{in:bids}}});await db.productPack.deleteMany({where:{businessId:{in:bids}}});await db.locationAssignment.deleteMany({where:{businessId:{in:bids}}});await db.location.deleteMany({where:{businessId:{in:bids}}});await db.product.deleteMany({where:{businessId:{in:bids}}});await db.authAudit.deleteMany({where:{businessId:{in:bids}}});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});if(planId)await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
}
