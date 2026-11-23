import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Purchases from './Purchases';
import {operationsCopy} from './copy';
import {useResource} from '../business-v2/useBusinessApi';
jest.mock('../business-v2/useBusinessApi',()=>({useResource:jest.fn()}));
jest.mock('./SupplierForm',()=>()=>null);
jest.mock('./RecordPicker',()=>()=>null);
jest.mock('./DocumentEditor',()=>()=> <div>Receipt editor</div>);
jest.mock('./PlannedOrderEditor',()=>()=> <div>Order editor</div>);
jest.mock('./DocumentDetail',()=>()=>null);
jest.mock('../ui/tooltip',()=>{const Wrapper=({children})=><>{children}</>;return {Tooltip:Wrapper,TooltipProvider:Wrapper,TooltipTrigger:Wrapper,TooltipContent:Wrapper};});
jest.mock('../business-v2/UI',()=>({Feedback:()=>null,Pager:()=>null,buttonClass:'',primaryClass:'',Select:({label,children,...props})=><label>{label}<select {...props}>{children}</select></label>,Table:({filters,children})=><>{filters}<table><tbody>{children}</tbody></table></>}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);useResource.mockReturnValue({data:{items:[{id:'r',kind:'RECEIPT',reference:'RCV-1'},{id:'o',kind:'ORDER',reference:'PO-1'}]},reload:()=>{}});});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.clearAllMocks();});
test('operation filter defaults to all, uses requested Arabic labels and resets incompatible status',()=>{
 act(()=>root.render(<Purchases context={{business:{id:'b'},permissions:{'receiving.create':true,'purchasing.manage':true}}} api={()=>{}} c={k=>operationsCopy.ar[k]||({all:'الكل'}[k])||k} lang="ar"/>));
 const kind=host.querySelector('#document-kind');expect(kind.value).toBe('ALL');expect([...kind.options].map(o=>o.textContent)).toEqual(['الكل','طلبات الشراء','استلام بضاعة']);expect(kind.parentNode.textContent).toContain('نوع العملية');
 expect(useResource.mock.calls.at(-1)[1]).toBe('/businesses/b/operations/purchases?kind=ALL&page=1');
 expect(host.textContent).toContain('إنشاء طلب شراء');expect(host.textContent).toContain('تسجيل البضاعة المستلمة');
 const status=host.querySelector('#document-state');act(()=>{status.value='COMPLETED';status.dispatchEvent(new Event('change',{bubbles:true}));});
 act(()=>{kind.value='ORDER';kind.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(host.querySelector('#document-state').value).toBe('');expect(useResource.mock.calls.at(-1)[1]).toBe('/businesses/b/operations/purchases?kind=ORDER&page=1');
});

test.each([['طلب من المورد','Order editor'],['استلام مخزون','Receipt editor']])('action card %s opens its workflow', (label,editor)=>{
 act(()=>root.render(<Purchases context={{business:{id:'b'},permissions:{'receiving.create':true,'purchasing.manage':true}}} api={()=>{}} c={k=>operationsCopy.ar[k]||k} lang="ar"/>));
 const button=[...host.querySelectorAll('button')].find(b=>b.textContent.startsWith(label));
 expect(button.querySelector('svg')).not.toBeNull();act(()=>button.click());expect(host.textContent).toContain(editor);expect(host.querySelector('h2').textContent).toBe(operationsCopy.ar.purchases);expect(host.querySelectorAll('button[aria-pressed]')).toHaveLength(2);expect(host.querySelector('button[aria-pressed=true]').textContent).toContain(label);expect(host.querySelector('#document-kind')).toBeNull();
});
