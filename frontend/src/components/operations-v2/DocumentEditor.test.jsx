import {feedbackCopy} from '../business-v2/feedbackCopy';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import DocumentEditor from './DocumentEditor';
import {LanguageProvider} from '../../context/LanguageContext';
import {operationsCopy} from './copy';
jest.mock('@/lib/quantity',()=>({formatQuantity:v=>String(Number(v))}),{virtual:true});
jest.mock('@/lib/utils',()=>jest.requireActual('../../lib/utils'),{virtual:true});
jest.mock('@/components/CopyableCode',()=>({__esModule:true,default:({children})=><span>{children}</span>}),{virtual:true});
jest.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}),{virtual:true});
jest.mock('../ui/dialog',()=>({Dialog:({children})=><div role="dialog">{children}</div>,DialogContent:({children})=><div>{children}</div>,DialogTitle:({children})=><h2>{children}</h2>,DialogDescription:({children})=><p>{children}</p>}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root,api,done;
const product={id:'product',productId:'product',name:'Milk',sku:'MILK',unit:'PIECE',baseQuantity:'1',quantity:'1',unitCost:'3',purchasePrice:'3'};
const doc={id:'receipt',revision:0,locationId:'shop',locationName:'Shop',supplierId:'supplier',supplierName:'Supplier',documentDate:'2026-11-23',lines:[product]};
beforeEach(()=>{Object.defineProperty(window,'crypto',{configurable:true,value:{randomUUID:()=> 'test-uuid'}});host=document.createElement('div');document.body.append(host);root=createRoot(host);api=jest.fn(async()=>doc);done=jest.fn();});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(lang='en',permissions={},editorProps={}){localStorage.setItem('profitlens_lang',lang);await act(async()=>root.render(<LanguageProvider><DocumentEditor context={{business:{id:'business',baseCurrency:'USD'},permissions:{'catalogue.cost':true,'receiving.confirm':true,...permissions}}} api={api} c={key=>operationsCopy[lang][key]||key} lang={lang} kind="RECEIPT" document={doc} close={()=>{}} done={done} {...editorProps}/></LanguageProvider>));}
function fill(input,value){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}
const button=label=>[...host.querySelectorAll('button')].find(el=>el.textContent===label);
for(const lang of ['en','ar'])test(`review saves a draft without barcode input or stock transition (${lang})`,async()=>{
 await render(lang);const scanner=host.querySelector('#receipt-scan'),saveForm=button(operationsCopy[lang].reviewReceipt).closest('form');
 const documentDate=host.querySelector('#document-date');
 expect(scanner.closest('details').open).toBe(false);expect(scanner.form).not.toBe(saveForm);
 expect(documentDate.form).toBe(saveForm);
 act(()=>fill(documentDate,''));
 expect(saveForm.checkValidity()).toBe(false);
 act(()=>fill(documentDate,'2026-11-22'));
 expect(saveForm.checkValidity()).toBe(true);
 await act(async()=>saveForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(api).toHaveBeenCalledTimes(1);expect(api.mock.calls[0][0]).toBe('/businesses/business/operations/purchases/receipt');
 expect(api.mock.calls[0][1]).toMatchObject({method:'PATCH',body:{revision:0,documentDate:'2026-11-22',lines:[{productId:'product',quantity:'1',unitCost:'3'}]}});
 expect(done).toHaveBeenCalledWith(doc);
});
test('quantity can be cleared and replaced; Enter moves to cost without opening scanner',async()=>{
 await render();const quantity=host.querySelector('#line-quantity-0');
 act(()=>{quantity.focus();fill(quantity,'');});expect(quantity.value).toBe('');expect(quantity.validity.valueMissing).toBe(true);
 act(()=>{fill(quantity,'12');quantity.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
 expect(quantity.value).toBe('12');expect(document.activeElement.id).toBe('line-cost-0');expect(host.querySelector('#receipt-scan').closest('details').open).toBe(false);
});
test('scanner still adds products and transfers focus to their quantity',async()=>{
 api.mockResolvedValue({product});await render();const scanner=host.querySelector('#receipt-scan');
 act(()=>{scanner.closest('details').open=true;fill(scanner,'MILK');});
 await act(async()=>scanner.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(api.mock.calls[0][0]).toBe('/businesses/business/products/barcode?value=MILK');expect(document.activeElement.id).toBe('line-quantity-0');
});
test('inline product search adds a result and focuses quantity without opening a dialog', async () => {
 jest.useFakeTimers();
 try {
  const added={...product,id:'second',name:'حليب',sku:'MILK-2'};
  api.mockResolvedValue({items:[added],page:1,pageSize:25,total:1});
  await render('ar');
  const search=host.querySelector('input[maxlength="160"]');
  act(()=>fill(search,' 0012 '));
  expect(api).not.toHaveBeenCalled();
  await act(async()=>jest.advanceTimersByTime(220));
  expect(api.mock.calls[0][0]).toBe('/businesses/business/products?state=active&page=1&search=0012');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  act(()=>host.querySelector('ul button').click());
  expect(host.textContent).toContain(added.name);
  expect(document.activeElement.id).toBe('line-quantity-1');
  expect(search.value).toBe('');
 } finally { jest.useRealTimers(); }
});
test('adding a missing product preserves the receipt and adds the created product to its items', async () => {
 const added={...product,id:'second',name:'Tea',sku:'TEA',active:true};
 api.mockImplementation(async(path,options)=>{
  if(options?.method==='POST')return added;
  return {items:[],page:1,pageSize:25,total:0};
 });
 await render('en',{'catalogue.create':true});
 const search=host.querySelector('input[maxlength="160"]');
 act(()=>fill(search,'Tea'));
 await act(async()=>search.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(host.textContent).toContain('No matching products');
 await act(async()=>button('addProduct').click());
 const name=host.querySelector('#product-name');
 expect(name.value).toBe('Tea');
 act(()=>fill(host.querySelector('#product-purchasePrice'),'3'));
 await act(async()=>name.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(api.mock.calls.find(([,options])=>options?.method==='POST')[1].body.name).toBe('Tea');
 expect(host.querySelector('#line-quantity-0').value).toBe('1');
 expect(host.querySelector('#line-quantity-1').value).toBe('1');
 expect(host.textContent).toContain('Tea');
});
test('selecting an inline result for a planned item preserves the source item and outstanding quantity', async () => {
 const seed={id:'order',locationId:'shop',locationName:'Shop',lines:[],
  plannedItems:[{id:'planned',name:'Milk',quantity:'6',receivedQuantity:'2'}]};
 api.mockResolvedValueOnce({items:[product],page:1,pageSize:25,total:1}).mockResolvedValueOnce(doc);
 await render('en',{}, {document:null,seed});
 const search=host.querySelector('input[maxlength="160"]');
 act(()=>fill(search,'Milk'));
 await act(async()=>search.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 act(()=>host.querySelector('ul button').click());
 expect(document.activeElement.id).toBe('line-quantity-0');
 const form=button(operationsCopy.en.reviewReceipt).closest('form');
 await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(api.mock.calls[1][1].body).toMatchObject({orderId:'order',lines:[{plannedItemId:'planned',productId:'product',quantity:'4'}]});
});
test('failed draft save preserves entered quantity for retry',async()=>{
 api.mockRejectedValueOnce(Error('NETWORK_ERROR')).mockResolvedValue(doc);await render();const quantity=host.querySelector('#line-quantity-0');
 act(()=>{fill(quantity,'7');});const form=button('Review receipt').closest('form');
 await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(host.querySelector('[role="alert"]').textContent).toContain(feedbackCopy.ar.NETWORK_ERROR);expect(quantity.value).toBe('7');expect(done).not.toHaveBeenCalled();
 await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(api.mock.calls[1][1].body.lines[0].quantity).toBe('7');expect(done).toHaveBeenCalledTimes(1);
});
test('receipt can be reviewed without a supplier and labels it optional',async()=>{
 const supplierless={...doc,supplierId:null,supplierName:''};
 await act(async()=>root.render(<LanguageProvider><DocumentEditor context={{business:{id:'business',baseCurrency:'USD'},permissions:{'catalogue.cost':true}}} api={api} c={key=>operationsCopy.en[key]||key} lang="en" kind="RECEIPT" document={supplierless} close={()=>{}} done={done}/></LanguageProvider>));
 const review=button(operationsCopy.en.reviewReceipt);expect(review.disabled).toBe(false);expect(host.textContent).toContain('Supplier (optional)');
 await act(async()=>review.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(api).toHaveBeenCalledTimes(1);expect(done).toHaveBeenCalled();
});
test.each(['en','ar'])('CSV recovery uses the real product form and preserves purchase rows (%s)',async lang=>{
 let created=false;
 const added={id:'new-product',sku:'SAFI',name:'Safi milk',unit:'LITRE',purchasePrice:'100',active:true};
 api.mockImplementation(async(path,options)=>{
  if(options?.method==='POST'&&path.endsWith('/products')){created=true;return added;}
  if(path.endsWith('/products/new-product'))return added;
  if(path.includes('/products/barcode?')){if(!created)throw new Error('PRODUCT_NOT_FOUND');return {product:added};}
  return {items:[],page:1,pageSize:25,total:0};
 });
 await render(lang,{'catalogue.create':true});
 const input=host.querySelector('input[type=file]');
 Object.defineProperty(input,'files',{value:[{size:100,text:async()=> 'sku,name,unit,quantity,unit_cost\nsafi,Safi milk,LITRE,2,100'}]});
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 await act(async()=>button(lang==='ar'?'معاينة الأصناف':'Preview items').click());
 const createLabel=lang==='ar'?'إضافة المنتج':'Add product';
 await act(async()=>button(createLabel).click());
 expect(host.querySelector('#product-name').value).toBe('Safi milk');
 expect(host.querySelector('#product-sku').value).toBe('safi');
 expect(host.querySelector('#product-unit').value).toBe('LITRE');
 expect(host.querySelector('#product-purchasePrice').value).toBe('100');
 await act(async()=>host.querySelector('#product-name').form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(host.querySelector('#line-quantity-0').value).toBe('1');
 await act(async()=>button(lang==='ar'?'إعادة التحقق':'Recheck rows').click());
 await act(async()=>button(lang==='ar'?'إضافة الأصناف المراجعة إلى المسودة':'Add reviewed items to draft').click());
 expect(host.querySelector('#line-quantity-1').value).toBe('2');
 expect(host.querySelector('#line-cost-1').value).toBe('100');
 const writes=api.mock.calls.filter(([,options])=>options?.method);
 expect(writes).toHaveLength(1);expect(writes[0][0]).toBe('/businesses/business/products');
 expect(writes[0][1].body).toMatchObject({name:'Safi milk',sku:'safi',unit:'LITRE',purchasePrice:'100'});
});
