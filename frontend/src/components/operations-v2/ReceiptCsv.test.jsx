import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import ReceiptCsv from './ReceiptCsv';
import {downloadCsv} from '../completion-v2/Shared';
jest.mock('./ProductSearch',()=>({onSelect})=><button onClick={()=>onSelect({id:'q',sku:'REAL',active:true})}>Match product</button>);
jest.mock('../catalogue-v2/ProductForm',()=>({initialSku,initialName,initialPurchasePrice,done})=><button onClick={()=>done(true,{id:'q',sku:initialSku,active:true})}>Save {initialName} {initialPurchasePrice}</button>);
jest.mock('../business-v2/UI',()=>({buttonClass:'button'}));
jest.mock('../completion-v2/Shared',()=>({downloadCsv:jest.fn()}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function upload(text){const input=host.querySelector('input');Object.defineProperty(input,'files',{configurable:true,value:[{size:text.length,text:async()=>text}]});await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});}
test.each(['en','ar'])('imports only complete resolved files into draft (%s)',async lang=>{
 const api=jest.fn().mockResolvedValue({product:{id:'p',sku:'001',name:'Milk',unit:'LITRE'}}),onImport=jest.fn(),onBusy=jest.fn();
 act(()=>root.render(<ReceiptCsv {...{api,lang,onImport,onBusy}} root="/businesses/b" cost={false} lines={[]}/>));
 await upload('sku,quantity\n001,2');
 expect(onImport).toHaveBeenCalledTimes(1);expect(onImport.mock.calls[0][0][0].quantity).toBe('2');expect(host.querySelector('[role=status]')).not.toBeNull();expect(onBusy.mock.calls).toEqual([[true],[false]]);
});
test('failed lookup never adds partial rows or writes stock',async()=>{
 const api=jest.fn().mockResolvedValueOnce({product:{id:'p',sku:'001'}}).mockRejectedValueOnce(new Error('PRODUCT_NOT_FOUND')),onImport=jest.fn();
 act(()=>root.render(<ReceiptCsv api={api} lang="en" onImport={onImport} onBusy={()=>{}} root="/businesses/b" cost={false} lines={[]}/>));
 await upload('sku,quantity\n001,2\n002,1');
 expect(onImport).not.toHaveBeenCalled();expect(host.querySelector('[role=alert]')).toBeNull();expect(host.querySelector('[role=note]').textContent).toContain('not in your active products');expect(api.mock.calls.every(call=>call.length===1)).toBe(true);
});
test('the downloaded receipt works in an empty draft and does not duplicate the original draft',async()=>{
 const product={id:'p',sku:'001',name:'Milk',unit:'LITRE'};
 const lines=[{productId:'p',sku:'001',quantity:'1.2500',unitCost:''}];
 const api=jest.fn().mockResolvedValue({product}),onImport=jest.fn(),onBusy=jest.fn();
 function render(draft){
  act(()=>root.render(<ReceiptCsv {...{api,onImport,onBusy}} lang="en" root="/businesses/b" cost lines={draft}/>));
 }
 render(lines);
 act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Export CSV').click());
 const {csv}=downloadCsv.mock.calls.at(-1)[0];
 await upload('\uFEFF'+csv);
 expect(api).not.toHaveBeenCalled();
 expect(onImport).not.toHaveBeenCalled();
 expect(host.querySelector('[role=status]').textContent).toContain('already in the draft');
 render([]);
 await upload('\uFEFF'+csv);
 expect(onImport).toHaveBeenCalledWith([{...lines[0],name:'Milk',unit:'LITRE'}]);
 expect(host.querySelector('[role=alert]')).toBeNull();
});
test('retains the whole file and imports all rows after matching an unknown product',async()=>{
 const api=jest.fn(async path=>{if(path.endsWith('value=001'))return {product:{id:'p',sku:'001'}};if(path.endsWith('value=REAL'))return {product:{id:'q',sku:'REAL'}};throw new Error('PRODUCT_NOT_FOUND');});
 const onImport=jest.fn();
 act(()=>root.render(<ReceiptCsv api={api} lang="en" c={key=>key} onImport={onImport} onBusy={()=>{}} root="/businesses/b" cost lines={[]}/>));
 await upload('sku,quantity,unit_cost\n001,1,90\nsafi,2,100');
 expect(onImport).not.toHaveBeenCalled();
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Match product').click());
 expect(onImport).toHaveBeenCalledTimes(1);
 expect(onImport.mock.calls[0][0].map(row=>[row.sku,row.quantity,row.unitCost])).toEqual([['001','1','90'],['REAL','2','100']]);
});
test('offers explicit permission-gated creation with CSV details and resumes retained import',async()=>{
 let exists=false;
 const api=jest.fn(async()=>{if(!exists)throw new Error('PRODUCT_NOT_FOUND');return {product:{id:'q',sku:'NEW',name:'Milk',unit:'LITRE'}};});
 const onImport=jest.fn();
 act(()=>root.render(<ReceiptCsv api={api} lang="en" c={key=>key} context={{permissions:{'catalogue.create':true,'catalogue.cost':true}}} onImport={onImport} onBusy={()=>{}} root="/businesses/b" cost lines={[]}/>));
 await upload('sku,name,unit,quantity,unit_cost\nNEW,Milk,LITRE,2,100');
 expect(onImport).not.toHaveBeenCalled();
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Add product').click());
 exists=true;
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Save Milk 100').click());
 expect(onImport.mock.calls[0][0][0]).toMatchObject({sku:'NEW',quantity:'2',unitCost:'100'});
});
test.each([{}, {'catalogue.create':true}, {'catalogue.cost':true}])('does not offer creation without both permissions: %j',async permissions=>{
 const api=jest.fn().mockRejectedValue(new Error('PRODUCT_NOT_FOUND'));
 act(()=>root.render(<ReceiptCsv api={api} lang="en" c={key=>key} context={{permissions}} onImport={jest.fn()} onBusy={()=>{}} root="/businesses/b" cost lines={[]}/>));
 await upload('sku,quantity\nNEW,1');
 expect(host.textContent).not.toContain('Add product');
 expect(host.textContent).toContain('Match product');
});
test('cancel discards pending import without adding rows',async()=>{
 const onImport=jest.fn();
 act(()=>root.render(<ReceiptCsv api={jest.fn().mockRejectedValue(new Error('PRODUCT_NOT_FOUND'))} lang="en" c={key=>key} onImport={onImport} onBusy={()=>{}} root="/businesses/b" lines={[]}/>));
 await upload('sku,quantity\nNEW,1');
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Cancel import').click());
 expect(host.textContent).not.toContain('Retry retained file');expect(onImport).not.toHaveBeenCalled();
});
test('network failure retains file for successful retry without reupload',async()=>{
 const api=jest.fn().mockRejectedValueOnce(new Error('NETWORK_ERROR')).mockResolvedValue({product:{id:'p',sku:'001'}}),onImport=jest.fn();
 act(()=>root.render(<ReceiptCsv {...{api,onImport}} lang="en" c={key=>key} onBusy={()=>{}} root="/businesses/b" lines={[]}/>));
 await upload('sku,quantity\n001,2');
 expect(onImport).not.toHaveBeenCalled();
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Retry retained file').click());
 expect(onImport).toHaveBeenCalledTimes(1);
});
test('locks import before file reading so a second selection cannot race it',async()=>{
 let finishRead;
 const api=jest.fn().mockResolvedValue({product:{id:'p',sku:'001'}}),onImport=jest.fn(),onBusy=jest.fn();
 act(()=>root.render(<ReceiptCsv {...{api,onImport,onBusy}} lang="en" root="/businesses/b" lines={[]}/>));
 const input=host.querySelector('input');
 Object.defineProperty(input,'files',{configurable:true,value:[{size:30,text:()=>new Promise(resolve=>{finishRead=resolve;})}]});
 act(()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 expect(input.disabled).toBe(true);
 await upload('sku,quantity\n001,9');
 await act(async()=>finishRead('sku,quantity\n001,2'));
 expect(onImport).toHaveBeenCalledTimes(1);
 expect(onImport.mock.calls[0][0][0].quantity).toBe('2');
 expect(onBusy.mock.calls).toEqual([[true],[false]]);
});
test('read failure unlocks the importer and clears an earlier success notice',async()=>{
 const api=jest.fn().mockResolvedValue({product:{id:'p',sku:'001'}}),onImport=jest.fn();
 act(()=>root.render(<ReceiptCsv {...{api,onImport}} lang="en" root="/businesses/b" onBusy={()=>{}} lines={[]}/>));
 await upload('sku,quantity\n001,2');
 expect(host.querySelector('[role=status]')).not.toBeNull();
 const input=host.querySelector('input');
 Object.defineProperty(input,'files',{value:[{size:30,text:async()=>{throw new Error('READ_FAILED');}}]});
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 expect(input.disabled).toBe(false);expect(host.querySelector('[role=status]')).toBeNull();
 expect(host.querySelector('[role=alert]')).not.toBeNull();
});
test('rejects oversized files before reading or looking up products',async()=>{
 const api=jest.fn(),read=jest.fn(),onImport=jest.fn(),onBusy=jest.fn();
 act(()=>root.render(<ReceiptCsv {...{api,onImport,onBusy}} lang="en" root="/businesses/b" lines={[]}/>));
 const input=host.querySelector('input');Object.defineProperty(input,'files',{value:[{size:1000001,text:read}]});
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 expect(read).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();expect(onImport).not.toHaveBeenCalled();expect(input.disabled).toBe(false);
});
test('repeated retry clicks issue only one lookup while pending',async()=>{
 let finish;
 const api=jest.fn().mockRejectedValueOnce(new Error('NETWORK_ERROR')).mockImplementation(()=>new Promise(resolve=>{finish=resolve;})),onImport=jest.fn();
 act(()=>root.render(<ReceiptCsv {...{api,onImport}} lang="en" root="/businesses/b" onBusy={()=>{}} lines={[]}/>));
 await upload('sku,quantity\n001,2');
 const retry=[...host.querySelectorAll('button')].find(b=>b.textContent==='Retry retained file');
 act(()=>{retry.click();retry.click();});
 expect(api).toHaveBeenCalledTimes(2);
 await act(async()=>finish({product:{id:'p',sku:'001'}}));
 expect(onImport).toHaveBeenCalledTimes(1);
});
test.each(['ar','en'])('accepts an unknown item as pending with an add-product note, not a rejection (%s)',async lang=>{
 const api=jest.fn().mockRejectedValue(new Error('PRODUCT_NOT_FOUND')),onImport=jest.fn();
 act(()=>root.render(<ReceiptCsv {...{api,onImport,lang}} c={key=>key} context={{permissions:{'catalogue.create':true,'catalogue.cost':true}}} onBusy={()=>{}} root="/businesses/b" cost lines={[]}/>));
 await upload('sku,name,unit,quantity,unit_cost\nsafi,Safi milk,LITRE,2,100');
 expect(host.querySelector('[role=alert]')).toBeNull();
 expect(host.querySelector('[role=status]').textContent).toContain(lang==='ar'?'تم تحميل الملف':'File loaded');
 expect(host.querySelector('[role=note]').textContent).toContain(lang==='ar'?'غير موجود':'not in your active products');
 expect(host.textContent).toContain('Safi milk');expect(host.textContent).toContain('safi');
 expect([...host.querySelectorAll('button')].some(b=>b.textContent===(lang==='ar'?'إضافة المنتج':'Add product'))).toBe(true);
 expect(onImport).not.toHaveBeenCalled();
});
