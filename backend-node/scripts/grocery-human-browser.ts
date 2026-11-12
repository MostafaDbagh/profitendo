import { chromium, type Page } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { encrypt, passwordHash } from '../src/auth/crypto.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3300'}),db=createDatabase(url),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const server=await new Promise<ReturnType<typeof app.listen>>((resolve,reject)=>{const s=app.listen(4301,'localhost',()=>resolve(s));s.on('error',reject);});
const browser=await chromium.launch({channel:'chrome',headless:true}),ids:string[]=[],bids:string[]=[],errors:string[]=[],artifacts='../tmp/grocery-human-test';await mkdir(artifacts,{recursive:true});
let planId:string|undefined, primaryPage:Page|undefined;
async function shot(page:Page,name:string){
 await page.evaluate(()=>document.fonts.ready);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);
 for(const dialog of await page.getByRole('dialog').all())assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),`${name} dialog overflow`);
 await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});
}
async function actor(role:'OWNER'|'WAREHOUSE_STAFF',businessId:string,locationId:string){
 const id=randomUUID();ids.push(id);const user=await db.authUser.create({data:{id,name:role==='OWNER'?'Warehouse Owner':'Receiving Employee',email:`${id}@example.test`,passwordHash:await passwordHash('Browser operations password 194!'),emailVerifiedAt:new Date(),...(role==='OWNER'?{mfaSecret:encrypt(settings.key,'JBSWY3DPEHPK3PXP',`mfa:${id}`)}:{})}});
 const member=await db.membership.create({data:{userId:id,businessId,role}});
 if(role!=='OWNER')await db.locationAssignment.create({data:{businessId,locationId,membershipId:member.id}});
 const session=await auth.transaction(tx=>auth.makeSession(tx,user,true));
 const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addCookies([{name:settings.cookieName,value:session.token,url:'http://localhost:4300',httpOnly:true,sameSite:'Lax'}]);
 await context.route('http://localhost:4300/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:`http://localhost:4301${u.pathname}${u.search}`});await route.fulfill({response});});const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:8001/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"Not authenticated"}'}));
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return page;
}
async function section(page:Page,name:string){if(!page.url().includes('/business')||await page.evaluate(()=>document.documentElement.lang!==localStorage.getItem('profitlens_lang')))await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();}
async function choose(page:Page,label:string,name:string){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:new RegExp(name)}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
async function action(page:Page,label:string){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}

const log=(message:string)=>console.log('PASS:',message);
try{
 const business=await db.business.create({data:{name:'Mock Grocery — Warehouse & Shop',baseCurrency:'USD'}});bids.push(business.id);
 planId=(await db.billingPlan.create({data:{code:`grocery-${randomUUID()}`,name:'Grocery mock plan',nameAr:'خطة البقالة التجريبية',trialDays:14,maxMembers:10,maxWarehouses:3,maxShops:3}})).id;
 await db.businessSubscription.create({data:{businessId:business.id,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000*14)}});
 const page=await actor('OWNER',business.id,'');primaryPage=page;
 // Only the account and entitlement are fixtures. Business records below use the UI.
 await section(page,'Warehouses & shops');
 for(const [code,name,kind] of [['GROC-WH','Grocery main warehouse','WAREHOUSE'],['GROC-SHOP','Grocery neighbourhood shop','SHOP']] as const){
  await page.getByRole('button',{name:'Add location',exact:true}).click();
  await page.locator('#location-name').fill(name);await page.locator('#location-code').fill(code);await page.locator('#location-kind').selectOption(kind);await page.locator('#location-address').fill('Mock grocery premises');
  await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByText(name,{exact:true}).waitFor();
 }
 log('Created grocery warehouse and shop through forms');
 const products=[{sku:'GROC-RICE',name:'Basmati rice 1 kg',unit:'KG',cost:'4',price:'6',barcode:'6290000000011',qty:'100',transfer:'20'}, {sku:'GROC-MILK',name:'Fresh milk 1 litre',unit:'LITRE',cost:'2',price:'3',barcode:'6290000000028',qty:'60',transfer:'24'}, {sku:'GROC-OIL',name:'Sunflower oil 1 litre',unit:'LITRE',cost:'5',price:'8',barcode:'6290000000035',qty:'40',transfer:'12'}];
 await section(page,'Products');
 for(const item of products){
  await page.getByRole('button',{name:'Add product',exact:true}).click();
  for(const [field,value] of Object.entries({name:item.name,sku:item.sku,purchasePrice:item.cost,sellingPrice:item.price,minimumStock:'10',category:'Grocery',barcodes:item.barcode}))await page.locator(`#product-${field}`).fill(value);
  await page.locator('#product-unit').selectOption(item.unit);await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('cell',{name:item.sku,exact:true}).waitFor();
 }
 await shot(page,'01-products');log('Created rice, milk and oil with barcode, cost, selling price and minimum stock');
 await section(page,'Suppliers');await page.getByRole('button',{name:'Add supplier',exact:true}).click();await page.getByLabel('Supplier code',{exact:true}).fill('GROC-SUP');await page.getByPlaceholder('e.g. Gulf Food Supplies').fill('Mock Grocery Wholesale');await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('cell',{name:'Mock Grocery Wholesale',exact:true}).waitFor();
 await section(page,'Purchases');await page.getByRole('button',{name:'New receiving',exact:true}).click();await choose(page,'Choose location','Grocery main warehouse');await choose(page,'Choose supplier','Mock Grocery Wholesale');
 for(const [i,item] of products.entries()){const scan=page.getByLabel('Scan delivery barcode',{exact:true});await scan.fill(item.barcode);await scan.press('Enter');await page.locator(`#line-quantity-${i}`).fill(item.qty);}
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('heading',{name:'Receiving · Draft',exact:true}).waitFor();assert.equal(await db.stockMovement.count({where:{businessId:business.id}}),0);
 await action(page,'Send for confirmation');await page.getByRole('heading',{name:'Receiving · Awaiting confirmation',exact:true}).waitFor();await action(page,'Confirm receiving');await page.getByRole('heading',{name:'Receiving · Completed',exact:true}).waitFor();
 const receipt=await db.purchaseDocument.findFirstOrThrow({where:{businessId:business.id,kind:'RECEIPT'}});await shot(page,'02-received-delivery');log('Received 100 rice, 60 milk, 40 oil; draft did not affect stock');
 await section(page,'Stock transfers');await page.getByRole('button',{name:'New transfer',exact:true}).click();await choose(page,'Choose source location','Grocery main warehouse');await choose(page,'Choose destination location','Grocery neighbourhood shop');
 for(const [i,item] of products.entries()){const scan=page.getByLabel('Scan or enter a barcode',{exact:true});await scan.fill(item.barcode);await scan.press('Enter');await page.locator(`#transfer-quantity-${i}`).fill(item.transfer);}
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('heading',{name:'Stock transfers · Draft',exact:true}).waitFor();await action(page,'Dispatch goods');await page.getByRole('heading',{name:'Stock transfers · In transit',exact:true}).waitFor();await page.getByRole('button',{name:'Record arrival',exact:true}).click();
 const quantities=page.getByLabel('Quantity',{exact:true});for(const [i,item] of products.entries())await quantities.nth(i).fill(item.transfer);
 await page.getByRole('button',{name:'Review quantities',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('heading',{name:'Stock transfers · Closed',exact:true}).waitFor();await shot(page,'03-shop-restock');log('Dispatched and received 20 rice, 24 milk and 12 oil into shop');
 await section(page,'Sales');await page.getByRole('button',{name:'New sale',exact:true}).click();await choose(page,'Choose a shop','Grocery neighbourhood shop');
 for(const [i,item] of products.entries()){await page.locator('#pos-barcode').fill(item.barcode);await page.locator('#pos-barcode').press('Enter');await page.locator(`#sale-quantity-${i}`).fill(['2','3','1'][i]!);}
 await page.getByRole('button',{name:'Review sale',exact:true}).click();await page.getByTestId('sale-receipt').waitFor();await page.locator('#sale-received').fill('50');await page.getByRole('button',{name:'Record payment & complete sale',exact:true}).click();await page.getByRole('link',{name:'Open printable receipt',exact:true}).waitFor();
 const sale=await db.sale.findFirstOrThrow({where:{businessId:business.id}});assert.equal(sale.total.toFixed(2),'29.00');assert.equal((await db.salePayment.findFirstOrThrow({where:{saleId:sale.id}})).change.toFixed(2),'21.00');await shot(page,'04-sale-receipt');log('Sold basket for $29; $50 cash yields $21 change');
 await section(page,'Returns');await page.getByRole('button',{name:'New record',exact:true}).click();await choose(page,'Choose location','Grocery neighbourhood shop');await choose(page,'Choose original document',sale.reference);
 // Return quantities default to blank. Return only one milk.
 await page.locator('#adjust-quantity-1').fill('1');await page.locator('#adjust-reason').fill('Customer returned one unopened milk bottle');await page.getByRole('button',{name:'Save draft',exact:true}).click();await action(page,'Approve & post');await page.getByRole('heading',{name:/Completed$/}).waitFor();log('Customer return restores one sellable milk bottle');
 for(const [kind,product,quantity] of [['DAMAGE','Fresh milk','2'],['COUNT','Basmati rice','79']] as const){
  await section(page,'Counts & damage');await page.locator('#adjust-kind').selectOption(kind);await page.getByRole('button',{name:'New record',exact:true}).click();await choose(page,'Choose location','Grocery main warehouse');await choose(page,'Find products',product);await page.locator('#adjust-quantity-0').fill(quantity);await page.locator('#adjust-reason').fill(kind==='DAMAGE'?'Two milk bottles damaged during warehouse handling':'Physical rice count found one missing unit');await page.getByRole('button',{name:'Save draft',exact:true}).click();await action(page,'Approve & post');await page.getByRole('heading',{name:/Completed$/}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
 }
 log('Approved two damaged milk units and warehouse rice count of 79');
 async function payment(kind:string,amount:string,method:string,location:string,source?:string){
  await section(page,'Treasury');await page.getByRole('button',{name:'Record payment',exact:true}).click();await page.locator('#money-kind').selectOption(kind);await choose(page,'Choose location',location);if(source)await choose(page,'Choose original document',source);await page.locator('#money-amount').fill(amount);await page.locator('#money-method').selectOption(method);if(method!=='CASH')await page.locator('#money-reference').fill('MOCK-BANK-001');await page.locator('#money-reason').fill('Grocery mock day reconciliation');await page.getByRole('button',{name:'Review payment',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('table').waitFor();
 }
 await payment('SUPPLIER_PAYMENT','200','TRANSFER','Grocery main warehouse',receipt.reference);await payment('CUSTOMER_REFUND','3','CASH','Grocery neighbourhood shop','CUSTOMER_RETURN');await payment('EXPENSE','15','CASH','Grocery neighbourhood shop');
 await page.getByRole('button',{name:'Daily cash closing',exact:true}).click();await choose(page,'Choose location','Grocery neighbourhood shop');await page.locator('#cash-opening').fill('100');await page.locator('#cash-counted').fill('111');await page.locator('#cash-reason').fill('Opening 100 plus sales 29 less refund 3 less expense 15');await page.getByRole('button',{name:'Review & close day',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByText('Day closed',{exact:true}).waitFor();await shot(page,'05-cash-closing');
 const close=await db.cashClose.findFirstOrThrow({where:{businessId:business.id}});assert.equal(close.variance.toFixed(2),'0.00');log('Paid supplier $200 by transfer, refunded $3 cash, paid $15 expense; cash closes at $111 with zero variance');
 const balances=await db.stockBalance.findMany({where:{businessId:business.id},include:{product:true,location:true}});
 const expected:Record<string,string>={'GROC-WH:GROC-RICE':'79','GROC-WH:GROC-MILK':'34','GROC-WH:GROC-OIL':'28','GROC-SHOP:GROC-RICE':'18','GROC-SHOP:GROC-MILK':'22','GROC-SHOP:GROC-OIL':'11'};
 for(const b of balances)assert.equal(b.onHand.toFixed(0),expected[`${b.location.code}:${b.product.sku}`]);assert.equal(balances.length,6);log('All six final stock balances reconcile: 192 total units');
 await section(page,'Dashboard & reports');await page.getByText('Estimated profit',{exact:true}).waitFor();for(const [label,value] of [['Sales after discounts','$29.00'],['Customer return credits','$3.00'],['Net sales','$26.00'],['Recorded expenses','$15.00'],['Estimated profit','-$14.00'],['Estimated net sale cost','$17.00'],['Recorded damage cost','$4.00']] as const)assert.equal(await page.locator('dl > div').filter({has:page.getByText(label,{exact:true})}).locator('dd').innerText(),value);await shot(page,'06-reports-summary');await page.locator('#report-view').selectOption('balances');await page.getByRole('table').waitFor();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();await(await download).saveAs(`${artifacts}/supplier-balances.csv`);const csv=await readFile(`${artifacts}/supplier-balances.csv`,'utf8');assert(csv.includes('\"720.0000\",\"0.0000\",\"200.0000\",\"0.0000\",\"520.0000\"'));log('Report metrics reconcile and CSV shows $720 delivery, $200 paid, $520 outstanding');
 for(const lang of ['en','ar'])for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await section(page,lang==='ar'?'لوحة المتابعة والتقارير':'Dashboard & reports');await page.locator('#report-view').selectOption('summary');await page.getByText(lang==='ar'?'الربح التقديري':'Estimated profit',{exact:true}).waitFor();await shot(page,`07-${lang}-${width}-reports`);}
 assert.deepEqual(errors,[]);log('Grocery day completed without browser runtime errors; AR/EN desktop/mobile checked');
}catch(error){if(primaryPage){await primaryPage.screenshot({path:`${artifacts}/failure.png`,fullPage:true}).catch(()=>{});console.error((await primaryPage.locator('body').innerText()).slice(-5000));}throw error;}

finally{
 await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));
 await db.$transaction(async tx=>{
  const triggers=[['transfer_event_lines','transfer_event_lines_immutable'],['transfer_events','transfer_events_immutable'],['stock_movements','stock_history_immutable'],['adjustments','adjustment_immutable'],['adjustment_lines','adjustment_lines_immutable'],['money_entries','money_entries_immutable'],['cash_closes','cash_closes_immutable'],['sale_payments','sale_payments_immutable'],['sale_lines','completed_sale_lines_immutable'],['sales','completed_sale_immutable']];for(const [table,trigger] of triggers)await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  const where={businessId:{in:bids}};await tx.migrationPreview.deleteMany({where});await tx.moneyEntry.deleteMany({where});await tx.cashClose.deleteMany({where});await tx.adjustmentLine.deleteMany({where});await tx.adjustment.deleteMany({where});await tx.stockMovement.deleteMany({where});await tx.transferEventLine.deleteMany({where});await tx.transferEvent.deleteMany({where});await tx.transferLine.deleteMany({where});await tx.stockTransfer.deleteMany({where});await tx.salePayment.deleteMany({where});await tx.saleLine.deleteMany({where});await tx.sale.deleteMany({where});for(const [table,trigger] of triggers)await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
 });
 const where={businessId:{in:bids}};await db.purchaseLine.deleteMany({where});await db.purchaseDocument.deleteMany({where});await db.supplier.deleteMany({where});await db.stockBalance.deleteMany({where});await db.locationAssignment.deleteMany({where});await db.location.deleteMany({where});await db.productBarcode.deleteMany({where});await db.product.deleteMany({where});await db.authAudit.deleteMany({where});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});if(planId)await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
}
