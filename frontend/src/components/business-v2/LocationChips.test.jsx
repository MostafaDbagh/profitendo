import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {operationsCopy} from '../operations-v2/copy';
import LocationChips from './LocationChips';
jest.mock('./UI',()=>({Feedback:({error,retry})=>error?<button onClick={retry}>{error}</button>:null}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root;
const context={business:{id:'tenant'}};
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render({lang='en',...props}){await act(async()=>root.render(<LocationChips {...{context,lang}} c={key=>operationsCopy[lang][key]??key} {...props}/>));}
test.each(['en','ar'])('shows all paginated shops inline and selects a chip (%s)',async lang=>{
 const first={id:'a',name:'متجر أول'},second={id:'b',name:'Second shop'},onChange=jest.fn();
 const api=jest.fn().mockResolvedValueOnce({items:[first],total:2}).mockResolvedValueOnce({items:[second],total:2});
 await render({api,lang,value:first,onChange});
 expect(api.mock.calls.map(call=>call[0])).toEqual(['/businesses/tenant/locations?state=active&page=1','/businesses/tenant/locations?state=active&page=2']);
 const group=host.querySelector('[role=group]');
 const label=document.getElementById(group.getAttribute('aria-labelledby'));
 expect(label).toBe(group.previousElementSibling);
 expect(label.textContent).toBe(lang==='ar'?'اختر المتجر:':'Choose store:');
 const buttons=host.querySelectorAll('button');expect(buttons).toHaveLength(2);expect(buttons[0].getAttribute('aria-pressed')).toBe('true');expect(host.querySelector('[role=dialog]')).toBeNull();
 act(()=>buttons[1].click());expect(onChange).toHaveBeenCalledWith(second);expect(host.firstChild.dir).toBe(lang==='ar'?'rtl':'ltr');
});
test('locked document retains selected shop without fetching or changing it',async()=>{
 const api=jest.fn(),onChange=jest.fn();await render({api,onChange,documentLocation:{id:'a',name:'Saved shop'}});
 const button=host.querySelector('button');expect(button.disabled).toBe(true);act(()=>button.click());expect(onChange).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();
});
test('errors are retryable and empty results are explicit',async()=>{
 const api=jest.fn().mockRejectedValueOnce(new Error('NETWORK_ERROR')).mockResolvedValueOnce({items:[],total:0});
 await render({api,onChange:()=>{}});expect(host.textContent).toContain('NETWORK_ERROR');await act(async()=>host.querySelector('button').click());expect(host.textContent).toContain('No shops or warehouses available');
});
test('changing business drops previously fetched choices',async()=>{
 const api=jest.fn().mockResolvedValueOnce({items:[{id:'a',name:'Old shop'}],total:1}).mockResolvedValueOnce({items:[{id:'b',name:'New shop'}],total:1});
 await render({api,onChange:()=>{}});await render({api,context:{business:{id:'other'}},onChange:()=>{}});expect(host.textContent).not.toContain('Old shop');expect(host.textContent).toContain('New shop');
});
test('a saved selection cannot add an option missing from the current business',async()=>{
 const warehouse={id:'w',name:'Assigned warehouse',kind:'WAREHOUSE'};
 const stale={id:'old',name:'Old shop',kind:'SHOP'};
 const api=jest.fn().mockResolvedValue({items:[warehouse],total:1}),onChange=jest.fn();
 await render({api,value:stale,onChange});
 expect([...host.querySelectorAll('[aria-pressed]')].map(el=>el.textContent)).toEqual([warehouse.name]);
 expect(onChange).toHaveBeenCalledWith(null);
 await render({api,value:warehouse,onChange,excludeId:warehouse.id});
 expect(host.querySelector('[aria-pressed]')).toBeNull();
});

test('inventory selects its only location and labels the selected chip',async()=>{
 const shop={id:'only',name:'متجري'},api=jest.fn().mockResolvedValue({items:[shop],total:1}),onChange=jest.fn();
 await render({api,onChange,lang:'ar',defaultSingle:true});
 expect(onChange).toHaveBeenCalledWith(shop);
 await render({api,onChange,lang:'ar',defaultSingle:true,value:shop});
 expect(host.querySelector('[aria-pressed="true"]').textContent).toContain('افتراضيا');
});
