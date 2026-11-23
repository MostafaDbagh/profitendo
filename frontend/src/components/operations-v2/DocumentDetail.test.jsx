import {feedbackCopy} from '../business-v2/feedbackCopy';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import DocumentDetail from './DocumentDetail';
import {operationsCopy} from './copy';
import {LanguageProvider} from '../../context/LanguageContext';
jest.mock('@/lib/quantity',()=>({formatQuantity:v=>String(Number(v))}),{virtual:true});
jest.mock('@/components/CopyableCode',()=>({__esModule:true,default:({children})=><span>{children}</span>}),{virtual:true});
jest.mock('../ui/dialog',()=>({Dialog:({children})=><div role="dialog">{children}</div>,DialogContent:({children})=><div>{children}</div>,DialogTitle:({children})=><h2>{children}</h2>,DialogDescription:({children})=><p>{children}</p>}));
jest.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}),{virtual:true});
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root,doc,api;
const permissions={'receiving.create':true,'receiving.confirm':true,'catalogue.cost':true,'receiving.delete':true};
beforeEach(()=>{
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 doc={id:'receipt',kind:'RECEIPT',status:'DRAFT',revision:0,reference:'REC-1',supplierName:'Supplier',locationName:'Shop',documentDate:'2026-11-23',actorName:'Mostafa',currency:'USD',totalValue:'6',lines:[{id:'line',name:'Milk',sku:'MILK',unit:'PIECE',quantity:'2',baseQuantity:'2',unitCost:'3',lineTotal:'6',barcodes:[]}]};
 api=jest.fn(async(path,options={})=>{if(options.method){doc={...doc,revision:1,status:options.body.action==='submit'?'PENDING':'COMPLETED'};}return doc;});
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(overrides={},lang='en'){
 localStorage.setItem('profitlens_lang',lang);
 await act(async()=>root.render(<LanguageProvider><DocumentDetail id="receipt" api={api} context={{business:{id:'business',timezone:'UTC'},permissions:{...permissions,...overrides}}} c={key=>operationsCopy[lang][key]||key} lang={lang} close={()=>{}} edit={()=>{}} receive={()=>{}}/></LanguageProvider>));
}
const button=(label,within=host)=>[...within.querySelectorAll('button')].find(el=>el.textContent===label);
const writes=()=>api.mock.calls.filter(([,options])=>options?.method);
for(const lang of ['en','ar'])test(`authorized receiving requires explicit review confirmation (${lang})`,async()=>{
 const c=operationsCopy[lang];await render({},lang);
 expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
 expect(host.querySelector('input[type="search"]')).toBeNull();
 await act(async()=>button(c.receiveNow).click());
 expect(writes()).toHaveLength(0);
 const dialog=host.querySelector('[role="dialog"]');expect(dialog.textContent).toContain('Supplier');expect(dialog.textContent).toContain('Shop');expect(dialog.textContent).toContain('Milk: 2');
 await act(async()=>button(c.receiveNow,dialog).click());
 expect(writes()).toHaveLength(1);expect(writes()[0][1].body).toEqual({revision:0,action:'receive',confirm:true});
 expect(host.textContent).toContain(c.receiptCompletedHint);expect(button(c.receiveNow)).toBeUndefined();
});
test('preparers send for approval without posting and cannot see cost data',async()=>{
 await render({'receiving.confirm':false,'catalogue.cost':false});
 expect(button('Confirm & add stock')).toBeUndefined();
 expect(host.textContent).not.toContain('Cost per base unit');
 await act(async()=>button('Send for approval').click());
 expect(writes()[0][1].body.action).toBe('submit');
 expect(host.textContent).toContain(operationsCopy.en.receiptPendingHint);
 expect(button('Confirm & add stock')).toBeUndefined();expect(button('Send for approval')).toBeUndefined();
});
test('approvers without preparation permission can approve pending receipts only',async()=>{
 await render({'receiving.create':false});expect(button('Confirm & add stock')).toBeUndefined();expect(button('Edit draft')).toBeUndefined();
 doc={...doc,status:'PENDING'};await act(async()=>root.unmount());root=createRoot(host);await render({'receiving.create':false});
 await act(async()=>button('Confirm & add stock').click());
 await act(async()=>button('Confirm & add stock',host.querySelector('[role="dialog"]')).click());
 expect(writes()[0][1].body.action).toBe('confirm');
});
test('failed confirmation keeps review visible and retry uses the same receipt revision',async()=>{
 const original=api;let failed=false;
 api=jest.fn(async(path,options)=>{if(options?.method&&!failed){failed=true;throw Error('NETWORK_ERROR');}return original(path,options);});
 await render();await act(async()=>button('Confirm & add stock').click());
 await act(async()=>button('Confirm & add stock',host.querySelector('[role="dialog"]')).click());
 expect(host.querySelector('[role="alert"]').textContent).toContain(feedbackCopy.ar.NETWORK_ERROR);expect(doc.status).toBe('DRAFT');
 await act(async()=>button('Confirm & add stock',host.querySelector('[role="dialog"]')).click());
 expect(writes()).toHaveLength(2);expect(writes()[0][1].body).toEqual(writes()[1][1].body);
 expect(host.textContent).toContain(operationsCopy.en.receiptCompletedHint);
});
test('blocks repeated confirmations while a request is pending',async()=>{
 const original=api;let release;
 api=jest.fn((path,options)=>options?.method?new Promise(resolve=>{release=()=>resolve(original(path,options));}):original(path,options));
 await render();await act(async()=>button('Confirm & add stock').click());
 const confirm=button('Confirm & add stock',host.querySelector('[role="dialog"]'));
 await act(async()=>{confirm.click();confirm.click();});
 expect(writes()).toHaveLength(1);expect(confirm.disabled).toBe(true);
 await act(async()=>release());expect(host.textContent).toContain(operationsCopy.en.receiptCompletedHint);
});
