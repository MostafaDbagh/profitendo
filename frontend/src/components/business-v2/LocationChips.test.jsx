import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import LocationChips from './LocationChips';
jest.mock('./UI',()=>({Feedback:({error,retry})=>error?<button onClick={retry}>{error}</button>:null}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root;
const context={business:{id:'tenant'}},c=k=>k;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(props){await act(async()=>root.render(<LocationChips {...{context,c}} lang="en" {...props}/>));}
test.each(['en','ar'])('shows all paginated shops inline and selects a chip (%s)',async lang=>{
 const first={id:'a',name:'متجر أول'},second={id:'b',name:'Second shop'},onChange=jest.fn();
 const api=jest.fn().mockResolvedValueOnce({items:[first],total:2}).mockResolvedValueOnce({items:[second],total:2});
 await render({api,lang,value:first,onChange});
 expect(api.mock.calls.map(call=>call[0])).toEqual(['/businesses/tenant/locations?state=active&page=1','/businesses/tenant/locations?state=active&page=2']);
 const buttons=host.querySelectorAll('button');expect(buttons).toHaveLength(2);expect(buttons[0].getAttribute('aria-pressed')).toBe('true');expect(host.querySelector('[role=dialog]')).toBeNull();
 act(()=>buttons[1].click());expect(onChange).toHaveBeenCalledWith(second);expect(host.firstChild.dir).toBe(lang==='ar'?'rtl':'ltr');
});
test('locked document retains selected shop without fetching or changing it',async()=>{
 const api=jest.fn(),onChange=jest.fn();await render({api,onChange,disabled:true,value:{id:'a',name:'Saved shop'}});
 const button=host.querySelector('button');expect(button.disabled).toBe(true);act(()=>button.click());expect(onChange).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();
});
test('errors are retryable and empty results are explicit',async()=>{
 const api=jest.fn().mockRejectedValueOnce(new Error('NETWORK_ERROR')).mockResolvedValueOnce({items:[],total:0});
 await render({api,onChange:()=>{}});expect(host.textContent).toContain('NETWORK_ERROR');await act(async()=>host.querySelector('button').click());expect(host.textContent).toContain('No stores available');
});
test('changing business drops previously fetched choices',async()=>{
 const api=jest.fn().mockResolvedValueOnce({items:[{id:'a',name:'Old shop'}],total:1}).mockResolvedValueOnce({items:[{id:'b',name:'New shop'}],total:1});
 await render({api,onChange:()=>{}});await render({api,context:{business:{id:'other'}},onChange:()=>{}});expect(host.textContent).not.toContain('Old shop');expect(host.textContent).toContain('New shop');
});
