import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Editor from './Editor';
import {LanguageProvider} from '../../context/LanguageContext';
import {DraftScope} from '../../lib/localDraft';
jest.mock('@/lib/quantity',()=>({formatQuantity:v=>String(Number(v))}),{virtual:true});
jest.mock('@/lib/utils',()=>jest.requireActual('../../lib/utils'),{virtual:true});
jest.mock('@/components/CopyableCode',()=>({__esModule:true,default:({children})=><span>{children}</span>}),{virtual:true});
jest.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}),{virtual:true});
jest.mock('../ui/dialog',()=>({Dialog:({children})=><div>{children}</div>,DialogContent:({children})=><div>{children}</div>,DialogTitle:({children})=><h2>{children}</h2>,DialogDescription:({children})=><p>{children}</p>}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root,api,done;
const product={id:'p',name:'Milk',sku:'001',unit:'PIECE',sellingPrice:'2',available:'3',packs:[]};
beforeEach(()=>{let id=0;Object.defineProperty(window,'crypto',{configurable:true,value:{randomUUID:()=>`key-${++id}`}});localStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);done=jest.fn();api=jest.fn(async(path,options)=>{if(options?.method)throw new Error('NETWORK_ERROR');return path.includes('/locations')?{items:[{id:'shop',name:'Shop'}],total:1,page:1,pageSize:25}:{items:[product]};});});
afterEach(()=>{act(()=>root.unmount());host.remove();});
function fill(input,value){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}
async function render(lang){localStorage.setItem('profitlens_lang',lang);await act(async()=>root.render(<LanguageProvider><Editor context={{business:{id:'b',baseCurrency:'USD'},permissions:{}}} {...{api,done,lang}} c={k=>k} close={()=>{}}/></LanguageProvider>));}
test('a restored sale cannot use a location removed from the current assignment',async()=>{
 const context={business:{id:'b',baseCurrency:'USD'},membershipId:'member',permissions:{}};
 const key='profitendo:entry:v1:'+JSON.stringify(['b','member',{},'sale:new:0']);
 localStorage.setItem(key,JSON.stringify({version:1,values:{
  shop:{id:'old',name:'Former shop'},rows:[{...product,productId:'p',key:'row',quantity:'1',unitPrice:'2',discountPercent:'0',discountReason:''}],
  customer:'',notes:'',barcode:'',clientKey:'saved',fingerprint:null,
 }}));
 await act(async()=>root.render(<LanguageProvider><DraftScope.Provider value={context}><Editor {...{context,api,done}} lang="en" c={k=>k} close={()=>{}}/></DraftScope.Provider></LanguageProvider>));
 expect(host.textContent).not.toContain('Former shop');
 expect(host.querySelector('#pos-barcode').disabled).toBe(true);
 expect(host.querySelector('#sale-quantity-0').value).toBe('1');
 expect([...host.querySelectorAll('button')].find(b=>b.textContent==='reviewSale').disabled).toBe(true);
});
for(const lang of ['en','ar'])test(`scan, stock limit and failed save preserve sale entries (${lang})`,async()=>{
 await render(lang);const barcode=host.querySelector('#pos-barcode');expect(barcode.disabled).toBe(false);
 await act(async()=>{fill(barcode,'001');barcode.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 expect(api.mock.calls.some(([path])=>path==='/businesses/b/sales/products?locationId=shop&barcode=001')).toBe(true);
 expect(host.textContent).toContain('Milk');const quantity=host.querySelector('#sale-quantity-0');
 const review=()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='reviewSale');
 act(()=>fill(quantity,'4'));expect(review().disabled).toBe(true);
 act(()=>fill(quantity,'2'));expect(review().disabled).toBe(false);
 await act(async()=>review().closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(done).not.toHaveBeenCalled();expect(quantity.value).toBe('2');expect(host.textContent).toContain('Milk');
 const writes=api.mock.calls.filter(([,options])=>options?.method);expect(writes).toHaveLength(1);expect(writes[0][1].body.lines[0].quantity).toBe('2');
});
