import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createDatabase} from '../src/database.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {passwordHash} from '../src/auth/crypto.js';
import {SalesService} from '../src/sales/service.js';
import {saleSchema} from '../src/sales/contracts.js';
import {postStock} from '../src/operations/inventory.js';
assert(new URL(process.env.DATABASE_URL!).pathname.endsWith('_tax_test'));
const db=createDatabase(process.env.DATABASE_URL!),auth=new AuthService(db,readAuthSettings(process.env));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
const folder='../tmp/tax-design';await mkdir(folder,{recursive:true});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 const user=await db.authUser.create({data:{name:'Tax browser test',email:`tax-${randomUUID()}@example.test`,passwordHash:await passwordHash(randomUUID()),emailVerifiedAt:new Date()}});
 const business=await db.business.create({data:{name:'Tax test business'}});await db.membership.create({data:{businessId:business.id,userId:user.id,role:'OWNER'}});
 const plan=await db.billingPlan.create({data:{code:randomUUID(),name:'Test',nameAr:'اختبار',trialDays:14,maxMembers:10,maxWarehouses:5,maxShops:5}});
 await db.businessSubscription.create({data:{businessId:business.id,planId:plan.id,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const shop=await db.location.create({data:{businessId:business.id,name:'Test shop',code:'SHOP',kind:'SHOP'}});
 const product=await db.product.create({data:{businessId:business.id,name:'Test product',sku:'TAX',unit:'PIECE',sellingPrice:'100',purchasePrice:'50'}});
 const ctx=await auth.transaction(tx=>auth.makeSession(tx,user,true));
 await auth.transaction(tx=>postStock(tx,{businessId:business.id,locationId:shop.id,productId:product.id,delta:'10',type:'TEST_OPENING',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'Test',actorId:user.id,notes:''}));
 await page.context().addCookies([{name:'pl_session',value:ctx.token,domain:'localhost',path:'/'}]);
 const sales=new SalesService(auth);
 async function receipt(){const d=await sales.create(ctx,business.id,saleSchema.parse({clientKey:randomUUID(),locationId:shop.id,lines:[{productId:product.id,quantity:'1'}]}));return sales.checkout(ctx,business.id,d.id,{clientKey:randomUUID(),revision:d.revision,expectedTotal:d.total.toString(),confirm:true,payment:{method:'CARD',received:d.total.toString(),reference:'Test terminal'}});}
 async function capture(phase:string,id:string){for(const lang of ['en','ar']){
  await page.goto('http://localhost:3200');await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);
  for(const screen of ['settings','receipt']){
   await page.goto(screen==='settings'?'http://localhost:3200/business-v2?tab=settings':`http://localhost:3200/sales-v2/${business.id}/${id}/receipt`);
   await (screen==='settings'?page.locator('#business-name'):page.getByTestId('sale-receipt')).waitFor();
   for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:1100});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${folder}/${phase}-${screen}-${lang}-${width}.png`,fullPage:true});}
  }
 }}
 await page.goto('http://localhost:3200');await page.evaluate(()=>localStorage.setItem('profitlens_lang','en'));await page.goto('http://localhost:3200/business-v2?tab=settings');for(let attempt=0;attempt<15;attempt++){if(await page.locator('#business-tax').count())break;await page.reload({waitUntil:'networkidle'});}await page.locator('#business-tax').waitFor();
 await page.locator('#business-tax').fill('101');assert.equal(await page.locator('#business-tax').evaluate((el:HTMLInputElement)=>el.checkValidity()),false);
 await page.locator('#business-tax').fill('5');await page.locator('form').filter({has:page.locator('#business-tax')}).getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Changes saved.',{exact:true}).waitFor();
 await page.reload();await page.locator('#business-tax').waitFor();assert.equal(Number(await page.locator('#business-tax').inputValue()),5);
 const taxed=await receipt();assert.equal(taxed.tax.toString(),'5');assert.equal(taxed.total.toString(),'105');
 await capture('after',taxed.id);
 assert.equal(errors.length,0);console.log('PASS: saved tax persists, invalid rate blocked, taxed receipt; AR/EN screenshots at 320/390/768/1024/1440, no overflow or page errors.');
}finally{await browser.close();await db.$disconnect();}
