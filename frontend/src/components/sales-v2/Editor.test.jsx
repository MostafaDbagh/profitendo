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
 expect(host.querySelector('[data-testid="sale-confirm"]').disabled).toBe(true);
});
for(const lang of ['en','ar'])test(`scan, stock limit and failed save preserve sale entries (${lang})`,async()=>{
 await render(lang);const barcode=host.querySelector('#pos-barcode');expect(barcode.disabled).toBe(false);
 await act(async()=>{fill(barcode,'001');barcode.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 expect(api.mock.calls.some(([path])=>path==='/businesses/b/sales/products?locationId=shop&barcode=001')).toBe(true);
 expect(host.textContent).toContain('Milk');const quantity=host.querySelector('#sale-quantity-0');
 const review=()=>host.querySelector('[data-testid="sale-confirm"]');
 act(()=>fill(quantity,'4'));expect(review().disabled).toBe(true);
 act(()=>fill(quantity,'2'));expect(review().disabled).toBe(false);
 await act(async()=>review().closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(done).not.toHaveBeenCalled();expect(quantity.value).toBe('2');expect(host.textContent).toContain('Milk');
 const writes=api.mock.calls.filter(([,options])=>options?.method);expect(writes).toHaveLength(1);expect(writes[0][1].body.lines[0].quantity).toBe('2');
});

test('two Enter events for one entry are consumed once, and a fresh scan while pending adds a second unit',async()=>{
 await render('en');
 const resolvers=[];
 api.mockImplementation(()=>new Promise(resolve=>resolvers.push(resolve)));
 const input=host.querySelector('#pos-barcode');
 const enter=()=>input.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await act(async()=>{fill(input,'001');enter();enter();});
 expect(resolvers).toHaveLength(1);
 await act(async()=>{fill(input,'0');fill(input,'001');enter();});
 expect(resolvers).toHaveLength(1);
 await act(async()=>resolvers[0]({items:[product]}));
 expect(input.value).toBe('001');
 await act(async()=>resolvers[1]({items:[product]}));
 expect(input.value).toBe('');
 expect(host.querySelector('#sale-quantity-0').value).toBe('2');
 expect(host.querySelector('#sale-quantity-1')).toBeNull();
 expect(host.querySelector('[data-testid="sale-total"]').textContent).toContain('4.00');
 expect(api.mock.calls.every(([,options])=>!options?.method)).toBe(true);
});

test('missing and unavailable barcodes keep the entered code, customer and quantities',async()=>{
 await render('ar'); const barcode=host.querySelector('#pos-barcode');
 const scan=async(code,result)=>{
   api.mockResolvedValueOnce({items:result});
   await act(async()=>{fill(barcode,code);barcode.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 };
 act(()=>fill(host.querySelector('#sale-customer'),'ليلى'));
 await scan('001',[product]);await scan('002',[]);expect(barcode.value).toBe('002');
 expect(host.querySelector('#pos-scan-error')).not.toBeNull();
 await scan('003',[{...product,id:'p2',available:'0'}]);expect(barcode.value).toBe('003');
 expect(host.querySelector('#sale-customer').value).toBe('ليلى');
 expect(host.querySelector('#sale-quantity-0').value).toBe('1');expect(host.querySelector('#sale-quantity-1')).toBeNull();
});

test('a changed server price needs review before payment',async()=>{
 await render('en');
 const input=host.querySelector('#pos-barcode');
 await act(async()=>{fill(input,'001');input.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 api.mockResolvedValueOnce({id:'draft',status:'DRAFT',capabilities:{checkout:true},currency:'USD',subtotal:'3',tax:'0',discount:'0',total:'3'});
 await act(async()=>host.querySelector('#sale-entry').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(done).toHaveBeenCalledWith(expect.objectContaining({id:'draft'}),expect.objectContaining({error:'TOTAL_CHANGED'}));
 expect(api.mock.calls.filter(([,options])=>options?.method)).toHaveLength(1);
});
