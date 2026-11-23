import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import ReceiptCsv from './ReceiptCsv';
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
 expect(onImport).not.toHaveBeenCalled();expect(host.querySelector('[role=alert]').textContent).toContain('No items were added');expect(api.mock.calls.every(call=>call.length===1)).toBe(true);
});
