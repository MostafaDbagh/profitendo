import Excel from 'exceljs';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type { createDatabase } from '../src/database.js';

/** Runs against real API/database; only transport failures are injected. */
export async function checkImportRecovery(page:Page,db:ReturnType<typeof createDatabase>,businessId:string,tag:string,shot:(page:Page,name:string)=>Promise<void>){
 const importButton=page.getByRole('button',{name:'Import Excel / CSV',exact:true});
 const previewButton=page.getByRole('button',{name:'Preview import',exact:true});
 const confirmButton=page.getByRole('button',{name:'Confirm import',exact:true});
 const count=()=>db.product.count({where:{businessId}});
 const before=await count();
 async function data(suffix:string,size=1){
  const book=new Excel.Workbook(),sheet=book.addWorksheet('Products');sheet.addRow(['name','SKU','unit','Purchase price','Sale price','Barcode']);
  for(let i=0;i<size;i++)sheet.addRow([`${tag} recovery ${suffix} ${i}`,`${tag}-${suffix}-${i}`,'PIECE','1.2345','2.5',`000-${tag}-${suffix}-${i}`]);
  return Buffer.from(await book.xlsx.writeBuffer());
 }
 async function pick(suffix:string,size=1){await page.locator('#product-import-file').setInputFiles({name:'recovery.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await data(suffix,size)});await page.waitForFunction(()=>!(document.querySelector('#product-import-file') as HTMLInputElement)?.disabled);}
 async function preview(){const response=page.waitForResponse(r=>r.url().endsWith('/product-imports/preview'));await previewButton.click();const r=await response;assert.equal(r.status(),201);const body=await r.json();await confirmButton.waitFor();return body.id as string;}
 async function closeSuccess(){await page.getByRole('status').filter({hasText:'Products imported'}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).last().click();}
 await importButton.click();
 await page.locator('#product-import-file').setInputFiles({name:'unsupported.xls',mimeType:'application/octet-stream',buffer:Buffer.from('invalid')});
 await page.getByRole('alert').waitFor();assert.equal(await previewButton.count(),0);assert.equal(await count(),before);
 await page.locator('#product-import-file').setInputFiles({name:'oversize.xlsx',mimeType:'application/octet-stream',buffer:Buffer.alloc(1024*1024+1)});
 await page.getByRole('alert').waitFor();assert.equal(await previewButton.count(),0);
 await pick('DRAFT');
 await page.route('**/product-imports/preview',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TRANSACTION_BUSY'}})}),{times:1});
 await previewButton.click();await page.getByRole('alert').waitFor();assert(await previewButton.isEnabled());assert.equal(await count(),before);
 const draftId=await preview();await shot(page,`${tag}-recovery-before-discard`);
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert(await importButton.evaluate(el=>el===document.activeElement));
 await importButton.click();await confirmButton.waitFor();assert.equal((await db.productImport.findUniqueOrThrow({where:{id:draftId}})).status,'PREVIEW');
 // Cancel preserves both the browser draft and the server-side preview.
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Discard draft',exact:true}).click();await confirmButton.waitFor();
 assert.equal((await db.productImport.findUniqueOrThrow({where:{id:draftId}})).status,'PREVIEW');
 // Failed cleanup during replacement must retain the original reviewable draft.
 await page.route(`**/product-imports/${draftId}/discard`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TRANSACTION_BUSY'}})}),{times:1});
 await pick('REPLACE-FAIL');await page.getByRole('alert').waitFor();
 assert.equal(await confirmButton.count(),1,'Failed replacement must retain the original preview');
 assert.equal(await page.getByRole('dialog').getByText(`${tag}-DRAFT-0`,{exact:true}).count(),1);
 assert.equal((await db.productImport.findUniqueOrThrow({where:{id:draftId}})).status,'PREVIEW');
 await shot(page,`${tag}-replacement-failure`);
 const discardResponse=page.waitForResponse(r=>r.url().endsWith(`/product-imports/${draftId}/discard`));
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Discard draft',exact:true}).click();assert.equal((await discardResponse).status(),200);await confirmButton.waitFor({state:'hidden'});
 const discarded=await db.productImport.findUniqueOrThrow({where:{id:draftId}});assert.equal(discarded.status,'EXPIRED','Discard draft must release the server preview');assert.equal(discarded.payload,'');
 assert.equal(await previewButton.count(),0);
 // Replacing a file expires the previous preview, and commits cannot resurrect it.
 await pick('REPLACED');const replacedId=await preview();await pick('EXPIRED');
 assert.equal((await db.productImport.findUniqueOrThrow({where:{id:replacedId}})).status,'EXPIRED');
 const expiredId=await preview();await db.productImport.update({where:{id:expiredId},data:{expiresAt:new Date(0)}});
 await confirmButton.click();await page.getByRole('alert').filter({hasText:'expired'}).waitFor();assert.equal(await count(),before);
 await preview();await confirmButton.click();await closeSuccess();assert.equal(await count(),before+1);
 // The server commits, but the response is lost. Retrying the same preview is idempotent.
 await importButton.click();await pick('LOST');const lostId=await preview();
 await page.route(`**/product-imports/${lostId}/commit`,async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');},{times:1});
 await confirmButton.click();await page.getByRole('alert').waitFor();assert.equal(await count(),before+2);assert(await confirmButton.isEnabled());
 await confirmButton.click();await closeSuccess();assert.equal(await count(),before+2);
 assert.equal(await db.authAudit.count({where:{businessId,action:'products.imported',targetId:lostId}}),1);
 // Pagination is review only: all 26 listed rows, including page two, commit together.
 await importButton.click();await pick('PAGES',26);const pagesId=await preview();
 assert.equal(await page.getByRole('dialog').getByRole('row').count(),26);
 await page.getByRole('dialog').getByRole('button',{name:'Next',exact:true}).click();assert.equal(await page.getByRole('dialog').getByRole('row').count(),2);
 await shot(page,`${tag}-recovery-page-two`);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route(`**/product-imports/${pagesId}/commit`,async route=>{await gate;await route.continue();},{times:1});
 await confirmButton.click();await page.getByRole('button',{name:'Saving…',exact:true}).waitFor();
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);assert(await page.locator('#product-import-file').isDisabled());
 release();await closeSuccess();assert.equal(await count(),before+28);
 assert.equal(await db.stockMovement.count({where:{businessId}}),0);assert.equal(await db.stockBalance.count({where:{businessId}}),0);
 console.log(`PASS ${tag}: invalid files, retry, draft restore/cancel/discard, replacement, expiry, lost-response idempotency, pagination, busy guards, keyboard focus and unchanged stock.`);
}
