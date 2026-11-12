import {chromium} from 'playwright';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pino} from 'pino';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/app.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {passwordHash} from '../src/auth/crypto.js';
import {postStock} from '../src/operations/inventory.js';
import {TransferService} from '../src/transfers/service.js';
const url=process.env.TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
const db=createDatabase(url),settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3300'}),auth=new AuthService(db,settings);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
const server=app.listen(4300,'localhost');await new Promise<void>(resolve=>server.once('listening',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
const id=randomUUID(),bid=randomUUID(),planId=randomUUID(),folder='../tmp/transfer-loss-report';await mkdir(folder,{recursive:true});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 const user=await db.authUser.create({data:{id,email:`loss-${id}@example.test`,name:'Report owner',emailVerifiedAt:new Date(),passwordHash:await passwordHash(randomUUID())}});
 await db.business.create({data:{id:bid,name:'Transfer loss report test'}});await db.membership.create({data:{userId:id,businessId:bid,role:'OWNER'}});
 await db.billingPlan.create({data:{id:planId,code:planId,name:'Test',nameAr:'اختبار',trialDays:14,maxMembers:5,maxWarehouses:3,maxShops:3}});await db.businessSubscription.create({data:{businessId:bid,planId,trialStartedAt:new Date(),trialEndsAt:new Date(Date.now()+86400000)}});
 const warehouse=await db.location.create({data:{businessId:bid,code:'WH',name:'Warehouse',kind:'WAREHOUSE'}}),shop=await db.location.create({data:{businessId:bid,code:'SH',name:'Shop',kind:'SHOP'}});
 const product=await db.product.create({data:{businessId:bid,sku:'LOSS',name:'Loss test',unit:'PIECE',purchasePrice:'2',sellingPrice:'5'}});
 const ctx=await auth.transaction(tx=>auth.makeSession(tx,user));await page.context().addCookies([{name:settings.cookieName,value:ctx.token,url:settings.appOrigin,httpOnly:true,sameSite:'Lax'}]);
 await auth.transaction(tx=>postStock(tx,{businessId:bid,locationId:warehouse.id,productId:product.id,delta:'2',type:'TEST_OPENING',sourceId:randomUUID(),sourceLineId:randomUUID(),reference:'Test',actorId:id,notes:''}));
 const service=new TransferService(auth),draft=await service.create(ctx,bid,{clientKey:randomUUID(),sourceId:warehouse.id,destinationId:shop.id,notes:'',lines:[{productId:product.id,quantity:'2'}]});
 const sent=await service.transition(ctx,bid,draft.id,{revision:0,action:'dispatch'});
 const result=await service.record(ctx,bid,draft.id,{clientKey:randomUUID(),revision:sent.revision,kind:'LOSS',reason:'Lost in test transit',confirm:true,lines:[{lineId:sent.lines[0]!.id,quantity:'1'}]});
 for(const state of ['known','historical']){
  if(state==='historical')await db.$transaction(async tx=>{await tx.$executeRawUnsafe('ALTER TABLE transfer_event_lines DISABLE TRIGGER transfer_event_lines_immutable');await tx.transferEventLine.updateMany({where:{eventId:result.eventId},data:{unitCost:null}});await tx.$executeRawUnsafe('ALTER TABLE transfer_event_lines ENABLE TRIGGER transfer_event_lines_immutable');});
  for(const lang of ['en','ar']){
   await page.goto(settings.appOrigin+'/auth-v2');await page.evaluate(l=>localStorage.setItem('profitlens_lang',l),lang);
   for(const tab of ['dashboard','reports']){
    await page.goto(settings.appOrigin+`/business-v2?tab=${tab}`);const main=page.locator('main');await main.locator('dl').waitFor();
    if(state==='historical')await main.getByText(lang==='ar'?'غير متاح':'Unavailable',{exact:true}).waitFor();
    else assert((await main.innerText()).includes('2.00'));
    for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:1100});await main.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await main.screenshot({path:`${folder}/${state}-${tab}-${lang}-${width}.png`});}
   }
  }
 }
 assert.deepEqual(errors,[]);console.log('PASS: known loss reduces profit; historical missing cost shows Unavailable, AR/EN dashboard/reports at five widths, no overflow/errors.');
}finally{
 await browser.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 await db.$transaction(async tx=>{
  for(const [table,trigger] of [['stock_movements','stock_history_immutable'],['transfer_event_lines','transfer_event_lines_immutable'],['transfer_events','transfer_events_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  await tx.stockMovement.deleteMany({where:{businessId:bid}});await tx.transferEventLine.deleteMany({where:{businessId:bid}});await tx.transferEvent.deleteMany({where:{businessId:bid}});await tx.transferLine.deleteMany({where:{businessId:bid}});await tx.stockTransfer.deleteMany({where:{businessId:bid}});
  for(const [table,trigger] of [['stock_movements','stock_history_immutable'],['transfer_event_lines','transfer_event_lines_immutable'],['transfer_events','transfer_events_immutable']])await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
 });
 await db.stockBalance.deleteMany({where:{businessId:bid}});await db.product.deleteMany({where:{businessId:bid}});await db.location.deleteMany({where:{businessId:bid}});await db.authAudit.deleteMany({where:{businessId:bid}});await db.business.deleteMany({where:{id:bid}});await db.authUser.deleteMany({where:{id}});await db.billingPlan.deleteMany({where:{id:planId}});await db.$disconnect();
}
