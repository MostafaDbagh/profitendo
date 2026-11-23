import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import DocumentEditor from './DocumentEditor';
import {LanguageProvider} from '../../context/LanguageContext';
import {operationsCopy} from './copy';
jest.mock('@/lib/quantity',()=>({formatQuantity:v=>String(Number(v))}),{virtual:true});
jest.mock('@/components/CopyableCode',()=>({__esModule:true,default:({children})=><span>{children}</span>}),{virtual:true});
jest.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}),{virtual:true});
jest.mock('../ui/dialog',()=>({Dialog:({children})=><div role="dialog">{children}</div>,DialogContent:({children})=><div>{children}</div>,DialogTitle:({children})=><h2>{children}</h2>,DialogDescription:({children})=><p>{children}</p>}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root,api,done;
const product={id:'product',productId:'product',name:'Milk',sku:'MILK',unit:'PIECE',baseQuantity:'1',quantity:'1',unitCost:'3',purchasePrice:'3'};
const doc={id:'receipt',revision:0,locationId:'shop',locationName:'Shop',supplierId:'supplier',supplierName:'Supplier',documentDate:'2026-11-23',lines:[product]};
beforeEach(()=>{Object.defineProperty(window,'crypto',{configurable:true,value:{randomUUID:()=> 'test-uuid'}});host=document.createElement('div');document.body.append(host);root=createRoot(host);api=jest.fn(async()=>doc);done=jest.fn();});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(lang='en',permissions={}){localStorage.setItem('profitlens_lang',lang);await act(async()=>root.render(<LanguageProvider><DocumentEditor context={{business:{id:'business',baseCurrency:'USD'},permissions:{'catalogue.cost':true,'receiving.confirm':true,...permissions}}} api={api} c={key=>operationsCopy[lang][key]||key} lang={lang} kind="RECEIPT" document={doc} close={()=>{}} done={done}/></LanguageProvider>));}
function fill(input,value){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}
const button=label=>[...host.querySelectorAll('button')].find(el=>el.textContent===label);
for(const lang of ['en','ar'])test(`review saves a draft without barcode input or stock transition (${lang})`,async()=>{
 await render(lang);const scanner=host.querySelector('#receipt-scan'),saveForm=button(operationsCopy[lang].reviewReceipt).closest('form');
 expect(scanner.closest('details').open).toBe(false);expect(scanner.form).not.toBe(saveForm);expect(saveForm.checkValidity()).toBe(true);
 await act(async()=>saveForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(api).toHaveBeenCalledTimes(1);expect(api.mock.calls[0][0]).toBe('/businesses/business/operations/purchases/receipt');
 expect(api.mock.calls[0][1]).toMatchObject({method:'PATCH',body:{revision:0,lines:[{productId:'product',quantity:'1',unitCost:'3'}]}});
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
test('failed draft save preserves entered quantity for retry',async()=>{
 api.mockRejectedValueOnce(Error('NETWORK_ERROR')).mockResolvedValue(doc);await render();const quantity=host.querySelector('#line-quantity-0');
 act(()=>{fill(quantity,'7');});const form=button('Review receipt').closest('form');
 await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(host.querySelector('[role="alert"]').textContent).toContain('NETWORK_ERROR');expect(quantity.value).toBe('7');expect(done).not.toHaveBeenCalled();
 await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(api.mock.calls[1][1].body.lines[0].quantity).toBe('7');expect(done).toHaveBeenCalledTimes(1);
});
