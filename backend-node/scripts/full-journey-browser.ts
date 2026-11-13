import { chromium, type Page } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { decrypt, totp } from '../src/auth/crypto.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
const settings=readAuthSettings({AUTH_EMAIL_REQUIRED:'true', AUTH_WELCOME_EMAIL_ENABLED:'true', AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3200'}),db=createDatabase(url),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const server=await new Promise<ReturnType<typeof app.listen>>((resolve,reject)=>{const s=app.listen(4301,'localhost',()=>resolve(s));s.on('error',reject);});
const browser=await chromium.launch({channel:'chrome',headless:true}),ids:string[]=[],bids:string[]=[],errors:string[]=[],artifacts='../tmp/full-business-journey';await mkdir(artifacts,{recursive:true});
let planId:string|undefined, primaryPage:Page|undefined;
async function shot(page:Page,name:string){
 await page.evaluate(()=>document.fonts.ready);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name);
 for(const dialog of await page.getByRole('dialog').all())assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),`${name} dialog overflow`);
 await page.screenshot({path:`${artifacts}/${name}.png`,fullPage:true,animations:'disabled'});
}
async function newPage(){
 const context=await browser.newContext({viewport:{width:1440,height:1100}});
 await context.route('http://localhost:4200/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:`http://localhost:4301${u.pathname}${u.search}`});await route.fulfill({response});});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{if(!localStorage.getItem('profitlens_lang'))localStorage.setItem('profitlens_lang','en');});return page;
}
const mailIds:string[]=[];
async function tokenFor(email:string,action:string){
 for(const row of await db.authMail.findMany({where:{deliveredAt:null},orderBy:{createdAt:'desc'}})){
  let payload;try{payload=JSON.parse(decrypt(settings.key,row.payload,`mail:${row.id}`));}catch{continue;}
  if(payload.to===email&&payload.text.includes(`action=${action}&`)){mailIds.push(row.id);return payload.text.match(/token=([A-Za-z0-9_-]{43})/)[1] as string;}
 }throw new Error('Expected local outbox token missing');
}
async function section(page:Page,name:string){if(!page.url().includes('/business')||await page.evaluate(()=>document.documentElement.lang!==localStorage.getItem('profitlens_lang')))await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();}
async function choose(page:Page,label:string,name:string){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:new RegExp(name)}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
async function action(page:Page,label:string){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}

const log=(message:string)=>console.log('PASS:',message);
try{
 const email=`journey-${randomUUID()}@example.test`,pass='Local journey password 914!';
 planId=(await db.billingPlan.create({data:{code:`journey-${randomUUID()}`,name:'Journey trial',nameAr:'تجربة الرحلة',published:true,trialDays:14,maxMembers:10,maxWarehouses:3,maxShops:3}})).id;
 const page=await newPage();primaryPage=page;
 await page.goto(settings.appOrigin+'/auth-v2');
 await page.getByRole('button',{name:'Create a business account',exact:true}).click();
 for(const [id,value] of Object.entries({name:'Journey Owner',businessName:'Journey Grocery','register-phone':'+963944123456',email,password:pass,confirmPassword:pass}))await page.locator(`#v2-${id}`).fill(value);
 await page.getByRole('button',{name:'Create business account',exact:true}).click();await page.getByRole('status').filter({hasText:'If eligible'}).waitFor();
 const user=await db.authUser.findUniqueOrThrow({where:{email}});ids.push(user.id);
 const membership=await db.membership.findFirstOrThrow({where:{userId:user.id}});bids.push(membership.businessId);const business=await db.business.findUniqueOrThrow({where:{id:membership.businessId}});
 await page.goto(`${settings.appOrigin}/auth-v2#action=verify&token=${await tokenFor(email,'verify')}`);await page.getByRole('button',{name:'Verify email',exact:true}).click();await page.getByRole('status').filter({hasText:'Email verified'}).waitFor();
 await page.locator('#v2-email').fill(email);await page.locator('#v2-password').fill(pass);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByTestId('business-dashboard').waitFor();await shot(page,'00a-new-account');
 await section(page,'Account security');const mfa=page.getByTestId('mfa-settings');await mfa.getByRole('button',{name:'Enable MFA',exact:true}).click();await page.locator('#mfa-password').fill(pass);await mfa.getByRole('button',{name:'Confirm',exact:true}).click();await page.locator('#mfa-secret').waitFor();const secret=await page.locator('#mfa-secret').inputValue();await page.locator('#mfa-code').fill(totp(secret,email).generate());await mfa.getByRole('button',{name:'Confirm',exact:true}).click();await mfa.getByRole('button',{name:'I saved my recovery codes',exact:true}).click();
 await section(page,'Subscription');await page.getByRole('heading',{name:'Journey trial',exact:true}).locator('..').getByRole('button',{name:'Start free trial',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Start free trial',exact:true}).click();await page.getByText('Your business trial has started.',{exact:true}).waitFor();await shot(page,'00b-trial');
 log('New account, real verification token, login, real TOTP setup and trial activation through UI');
 await section(page,'Warehouses & shops');
 for(const [code,name,kind] of [['GROC-WH','Grocery main warehouse','WAREHOUSE'],['GROC-SHOP','Grocery neighbourhood shop','SHOP']] as const){
  await page.getByRole('button',{name:'Add location',exact:true}).click();
  await page.locator('#location-name').fill(name);await page.locator('#location-code').fill(code);await page.locator('#location-kind').selectOption(kind);await page.locator('#location-address').fill('Mock grocery premises');
  await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByText(name,{exact:true}).waitFor();
 }
 log('Created grocery warehouse and shop through forms');
 await shot(page,'00c-locations');
 const staffEmail=`journey-staff-${randomUUID()}@example.test`;
 await section(page,'Team');await page.getByRole('button',{name:'Add team member',exact:true}).click();
 await page.locator('#add-member-name').fill('Journey Cashier');await page.locator('#add-member-email').fill(staffEmail);await page.locator('#add-member-password').fill(pass);await page.locator('#add-member-role').selectOption('CASHIER');await page.getByRole('dialog').getByRole('button',{name:'Send invitation',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 const staff=await newPage();await staff.goto(`${settings.appOrigin}/auth-v2#action=invite&token=${await tokenFor(staffEmail,'invite')}`);await staff.getByRole('button',{name:'Accept invitation',exact:true}).click();await staff.getByRole('status').filter({hasText:'Invitation accepted'}).waitFor();
 ids.push((await db.authUser.findUniqueOrThrow({where:{email:staffEmail}})).id);
 await staff.locator('#v2-email').fill(staffEmail);await staff.locator('#v2-password').fill(pass);await staff.getByRole('button',{name:'Sign in',exact:true}).click();await staff.getByTestId('business-dashboard').waitFor();
 assert.equal(await staff.getByRole('navigation').getByRole('button',{name:'Subscription',exact:true}).count(),0);await shot(staff,'00d-staff-access');
 await section(page,'Warehouses & shops');const shopRow=page.getByRole('row').filter({hasText:'Grocery neighbourhood shop'});await shopRow.getByRole('button',{name:'Staff access',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Assign · Journey Cashier',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Remove assignment · Journey Cashier',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 log('Invited cashier, accepted invitation, signed in with limited navigation and assigned shop');

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
 await page.getByRole('heading',{name:/Fresh milk 1 litre/}).locator('..').locator('input[id^="adjust-quantity-"]').fill('1');await page.locator('#adjust-reason').fill('Customer returned one unopened milk bottle');await page.getByRole('button',{name:'Save draft',exact:true}).click();await action(page,'Approve & post');await page.getByRole('heading',{name:/Completed$/}).waitFor();log('Customer return restores one sellable milk bottle');
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
 for(const lang of ['en','ar'])for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:1000});await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);await section(page,lang==='ar'?'لوحة المتابعة والتقارير':'Dashboard & reports');await page.locator('#report-view').selectOption('summary');await page.getByText(lang==='ar'?'الربح التقديري':'Estimated profit',{exact:true}).waitFor();await shot(page,`07-${lang}-${width}-reports`);}
 assert.deepEqual(errors,[]);log('Grocery day completed without browser runtime errors; AR/EN desktop/mobile checked');
}catch(error){if(primaryPage){await primaryPage.screenshot({path:`${artifacts}/failure.png`,fullPage:true}).catch(()=>{});console.error((await primaryPage.locator('body').innerText()).slice(-5000));}throw error;}

finally{
 for(const context of browser.contexts())await context.unrouteAll({behavior:'ignoreErrors'});
 await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));
 await db.$transaction(async tx=>{
  const triggers=[['transfer_event_lines','transfer_event_lines_immutable'],['transfer_events','transfer_events_immutable'],['stock_movements','stock_history_immutable'],['adjustments','adjustment_immutable'],['adjustment_lines','adjustment_lines_immutable'],['money_entries','money_entries_immutable'],['cash_closes','cash_closes_immutable'],['sale_payments','sale_payments_immutable'],['sale_lines','completed_sale_lines_immutable'],['sales','completed_sale_immutable']];for(const [table,trigger] of triggers)await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  const where={businessId:{in:bids}};await tx.migrationPreview.deleteMany({where});await tx.moneyEntry.deleteMany({where});await tx.cashClose.deleteMany({where});await tx.adjustmentLine.deleteMany({where});await tx.adjustment.deleteMany({where});await tx.stockMovement.deleteMany({where});await tx.transferEventLine.deleteMany({where});await tx.transferEvent.deleteMany({where});await tx.transferLine.deleteMany({where});await tx.stockTransfer.deleteMany({where});await tx.salePayment.deleteMany({where});await tx.saleLine.deleteMany({where});await tx.sale.deleteMany({where});for(const [table,trigger] of triggers)await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
 });
 await db.authMail.deleteMany({where:{id:{in:mailIds}}});await db.billingAudit.deleteMany({where:{actorId:{in:ids}}});
 const where={businessId:{in:bids}};await db.purchaseLine.deleteMany({where});await db.purchaseDocument.deleteMany({where});await db.supplier.deleteMany({where});await db.stockBalance.deleteMany({where});await db.locationAssignment.deleteMany({where});await db.location.deleteMany({where});await db.productBarcode.deleteMany({where});await db.product.deleteMany({where});await db.authAudit.deleteMany({where});await db.business.deleteMany({where:{id:{in:bids}}});await db.authUser.deleteMany({where:{id:{in:ids}}});if(planId)await db.billingPlan.delete({where:{id:planId}});await db.$disconnect();
}
