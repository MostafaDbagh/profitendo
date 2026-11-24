import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import ReceiptCsv from './ReceiptCsv';
import {downloadCsv} from '../completion-v2/Shared';
import {readReceiptWorkbook} from './readReceiptWorkbook';
jest.mock('./readReceiptWorkbook',()=>({readReceiptWorkbook:jest.fn()}));
jest.mock('./ProductSearch',()=>({onSelect})=><button onClick={()=>onSelect({id:'p',sku:'001',active:true,name:'Milk',unit:'LITRE'})}>Match product</button>);
jest.mock('../catalogue-v2/ProductForm',()=>({done,initialName,initialSku})=><button onClick={()=>done(true,{id:'new',sku:initialSku||'NEW',name:initialName,active:true})}>Save product</button>);
jest.mock('../business-v2/UI',()=>({buttonClass:'button',primaryClass:'primary'}));
jest.mock('../completion-v2/Shared',()=>({downloadCsv:jest.fn()}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root;
const product={id:'p',sku:'001',name:'Milk',unit:'LITRE',purchasePrice:'3',active:true};
const button=label=>[...host.querySelectorAll('button')].find(b=>b.textContent===label);
beforeEach(()=>{jest.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
function render(props={}){const api=jest.fn(async path=>path.endsWith('/products/p')?product:{product});const onImport=jest.fn();act(()=>root.render(<ReceiptCsv api={api} onImport={onImport} onBusy={()=>{}} lang="en" c={key=>key} root="/businesses/b" cost lines={[]} {...props}/>));return {api,onImport};}
async function upload(text,name='items.csv'){const input=host.querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:[{name,size:text.length,text:async()=>text,arrayBuffer:async()=>new ArrayBuffer(4)}]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));}
async function click(label){await act(async()=>button(label).click());}
for(const lang of ['en','ar'])test(`missing rows are red, retained and exportable (${lang})`,async()=>{
 const api=jest.fn().mockRejectedValue(Error('PRODUCT_NOT_FOUND')),onImport=jest.fn();render({lang,api,onImport,context:{permissions:{'catalogue.create':true,'catalogue.cost':true}}});
 await upload('sku,name,quantity,unit_cost\nsafi,Safi milk,2,100');await click(lang==='ar'?'معاينة الأصناف':'Preview items');
 expect(host.querySelector('[data-import-row]').className).toContain('bg-red-50');expect(host.textContent).toContain(lang==='ar'?'أضفه أولاً':'Add it first');
 expect(button(lang==='ar'?'إضافة الأصناف المراجعة إلى المسودة':'Add reviewed items to draft').disabled).toBe(true);
 await click(lang==='ar'?'تصدير المعاينة CSV':'Export preview CSV');expect(downloadCsv.mock.calls.at(-1)[0].csv).toContain('Safi milk');expect(onImport).not.toHaveBeenCalled();
});
test('100 columns ignore extras; review and explicit confirmation are required',async()=>{
 const {onImport}=render();const headers=['sku','quantity',...Array.from({length:98},(_,i)=>`extra${i}`)];
 await upload(headers.join(',')+'\n'+['001','2',...Array(98).fill('unused')].join(','));
 expect(host.querySelectorAll('select')).toHaveLength(100);expect([...host.querySelectorAll('select')].filter(s=>s.value==='')).toHaveLength(98);
 await click('Preview items');expect(onImport).not.toHaveBeenCalled();await click('Add reviewed items to draft');expect(onImport.mock.calls[0][0][0]).toMatchObject({productId:'p',quantity:'2'});
});
test('edits invalidate review and duplicate rows can be excluded',async()=>{
 const {onImport}=render();await upload('sku,quantity\n001,1\n001,2');await click('Preview items');
 expect(host.querySelectorAll('.bg-red-50').length).toBeGreaterThan(0);
 act(()=>host.querySelector('input[aria-label="Include row 3"]').click());await click('Recheck rows');await click('Add reviewed items to draft');expect(onImport.mock.calls[0][0]).toHaveLength(1);
});
test('Excel supports worksheet selection and maps the selected sheet',async()=>{
 readReceiptWorkbook.mockResolvedValue([{name:'First',grid:[['sku','quantity'],['001','1']]},{name:'Second',grid:[['sku','quantity'],['001','4']]}]);
 const {onImport}=render();await upload('xlsx','items.xlsx');const select=host.querySelector('select');
 act(()=>{select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));});await click('Preview items');await click('Add reviewed items to draft');expect(onImport.mock.calls[0][0][0].quantity).toBe('4');
});
test('file reading is locked against a second selection',async()=>{
 let finish;const {onImport}=render();const input=host.querySelector('input');
 Object.defineProperty(input,'files',{configurable:true,value:[{name:'a.csv',size:20,text:()=>new Promise(resolve=>finish=resolve)}]});
 act(()=>input.dispatchEvent(new Event('change',{bubbles:true})));expect(input.disabled).toBe(true);
 await upload('sku,quantity\n001,9');await act(async()=>finish('sku,quantity\n001,2'));await click('Preview items');await click('Add reviewed items to draft');expect(onImport.mock.calls[0][0][0].quantity).toBe('2');
});
test('permission restrictions hide product creation and cost columns',async()=>{
 render({cost:false,api:jest.fn().mockRejectedValue(Error('PRODUCT_NOT_FOUND'))});await upload('sku,quantity,unit_cost\nNEW,1,5');expect([...host.querySelectorAll('select')][2].value).toBe('');await click('Preview items');expect(button('Add product')).toBeUndefined();
});
test('failed lookups retain editable rows and retry succeeds',async()=>{
 let offline=true;const api=jest.fn(async path=>{if(offline)throw Error('NETWORK_ERROR');return path.endsWith('/products/p')?product:{product};});
 const {onImport}=render({api});await upload('sku,quantity\n001,2');await click('Preview items');expect(host.textContent).toContain('Could not verify');offline=false;await click('Recheck rows');await click('Add reviewed items to draft');expect(onImport).toHaveBeenCalledTimes(1);
});
test('confirmation rechecks changed catalogue and never imports an inactive match',async()=>{
 let inactive=false;const api=jest.fn(async path=>path.endsWith('/products/p')?{...product,active:!inactive}:{product});const {onImport}=render({api});
 await upload('sku,quantity\n001,1');await click('Preview items');inactive=true;await click('Add reviewed items to draft');expect(onImport).not.toHaveBeenCalled();expect(host.textContent).toContain('Add it first');
});
test('invalid quantity can be corrected in the review table',async()=>{
 const {onImport}=render();await upload('sku,quantity\n001,wrong');await click('Preview items');
 const input=host.querySelector('input[aria-label="Quantity 2"]');act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'4');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(button('Add reviewed items to draft').disabled).toBe(true);await click('Recheck rows');await click('Add reviewed items to draft');expect(onImport.mock.calls[0][0][0].quantity).toBe('4');
});
test('a failed file read unlocks controls and leaves existing preview intact',async()=>{
 render();await upload('sku,quantity\n001,1');await click('Preview items');const input=host.querySelector('input[type=file]');
 Object.defineProperty(input,'files',{configurable:true,value:[{size:20,name:'bad.csv',text:async()=>{throw Error('READ');}}]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 expect(input.disabled).toBe(false);expect(host.querySelector('[data-import-row]')).not.toBeNull();expect(host.querySelector('[role=alert]')).not.toBeNull();
});
for(const lang of ['en','ar'])test(`auto-add creates a product from the row without receiving stock (${lang})`,async()=>{
 let created=null;
 const api=jest.fn(async(path,options)=>{
  if(options?.method==='POST'){created={...options.body,id:'new',sku:'NEW'};return created;}
  if(path.endsWith('/products/new'))return created;
  if(created)return {product:created};
  throw Error('PRODUCT_NOT_FOUND');
 });
 const {onImport}=render({api,lang,context:{permissions:{'catalogue.create':true,'catalogue.cost':true}}});
 await upload('sku,barcode,name,unit,quantity,unit_cost,selling price\nNEW,00123,New milk,لتر,2,450,600');await click(lang==='ar'?'معاينة الأصناف':'Preview items');
 expect(button(lang==='ar'?'اختيار منتج':'Choose product')).toBeUndefined();
 await click(lang==='ar'?'إضافة تلقائية':'Auto-add');
 expect(api.mock.calls.filter(([,o])=>o?.method==='POST')).toEqual([['/businesses/b/products',{method:'POST',body:{sku:'NEW',name:'New milk',unit:'LITRE',purchasePrice:'450',sellingPrice:'600',barcodes:['00123'],minimumStock:'0',active:true}}]]);
 expect(onImport).not.toHaveBeenCalled();
 await click(lang==='ar'?'إضافة الأصناف المراجعة إلى المسودة':'Add reviewed items to draft');
 expect(onImport.mock.calls[0][0][0]).toMatchObject({productId:'new',quantity:'2',unitCost:'450'});
});
test('auto-add rechecks products and avoids creating a duplicate',async()=>{
 let exists=false;const api=jest.fn(async()=>{if(exists)return {product};throw Error('PRODUCT_NOT_FOUND');});
 render({api,context:{permissions:{'catalogue.create':true,'catalogue.cost':true}}});
 await upload('sku,name,quantity,unit_cost\n001,Milk,2,3');await click('Preview items');exists=true;await click('Auto-add');
 expect(api.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
 expect(button('Add reviewed items to draft').disabled).toBe(false);
});
test('auto-add requires name and cost and respects creation permissions',async()=>{
 const api=jest.fn().mockRejectedValue(Error('PRODUCT_NOT_FOUND'));
 render({api,context:{permissions:{'catalogue.create':true,'catalogue.cost':true}}});
 await upload('sku,quantity\nNEW,1');await click('Preview items');await click('Auto-add');
 expect(host.querySelector('[role=alert]').textContent).toContain('Enter the product name and unit cost');
 expect(api.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
 render({api,context:{permissions:{'catalogue.create':false,'catalogue.cost':true}}});expect(button('Auto-add')).toBeUndefined();
});
test('auto-add blocks double clicks and retains rows after a failed save',async()=>{
 let rejectSave;const api=jest.fn(async(path,o)=>{if(o?.method==='POST')return new Promise((resolve,reject)=>{rejectSave=reject;});throw Error('PRODUCT_NOT_FOUND');});
 render({api,context:{permissions:{'catalogue.create':true,'catalogue.cost':true}}});
 await upload('sku,name,quantity,unit_cost\nNEW,New milk,2,3');await click('Preview items');
 await act(async()=>{button('Auto-add').click();button('Auto-add').click();});
 expect(button('Auto-add').disabled).toBe(true);expect(api.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(1);
 await act(async()=>rejectSave(Error('NETWORK_ERROR')));
 expect(host.querySelector('[role=alert]').textContent).toContain('Could not add the product');
 expect(host.querySelector('input[aria-label="Product name 2"]').value).toBe('New milk');expect(button('Auto-add').disabled).toBe(false);
});
