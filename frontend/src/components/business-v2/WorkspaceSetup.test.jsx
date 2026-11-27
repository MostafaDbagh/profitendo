import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import GettingStarted from './GettingStarted';
import {useWorkspaceSetup} from './workspaceSetup';
import {LanguageProvider} from '../../context/LanguageContext';
jest.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}),{virtual:true});
jest.mock('../support-v2/Support',()=>({__esModule:true,default:()=>null,TicketForm:()=>null}));
jest.mock('../ui/dialog',()=>({Dialog:()=>null,DialogContent:()=>null,DialogTitle:()=>null,DialogDescription:()=>null}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root,api,navigate;
const context={role:'OWNER',business:{id:'b'},permissions:Object.fromEntries(['locations.manage','locations.view','catalogue.create','catalogue.cost','catalogue.view','sales.create','sales.view','receiving.create','purchasing.view'].map(k=>[k,true]))};
const visibleTabs=['locations','catalogue','sales','purchases'];
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);api=jest.fn(async()=>({total:0,items:[]}));navigate=jest.fn();});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(lang='en'){localStorage.setItem('profitlens_lang',lang);await act(async()=>root.render(<LanguageProvider><GettingStarted {...{api,context,visibleTabs,lang}} onSection={navigate}/></LanguageProvider>));}
for(const [lang,label] of [['en','Add shop'],['ar','إضافة متجر']])test(`four clear setup steps open the shop form (${lang})`,async()=>{await render(lang);expect(host.querySelectorAll('ol>li')).toHaveLength(4);act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes(label)).click());expect(navigate).toHaveBeenCalledWith('locations','setup');expect(api.mock.calls.map(([path])=>path)).toEqual(expect.arrayContaining(['/businesses/b/locations?kind=SHOP&state=active','/businesses/b/products?state=active','/businesses/b/operations/purchases?kind=RECEIPT&status=COMPLETED','/businesses/b/sales?status=COMPLETED']));expect(api.mock.calls.some(([path])=>path.includes('suppliers')||path.includes('references'))).toBe(false);});
test('only completed sales finish the last step and stock guidance remains before first sale',async()=>{api.mockImplementation(async path=>({total:path.includes('/sales?')||path.includes('/operations/purchases?')?0:1,items:[]}));await render();expect([...host.querySelectorAll('ol h3')].slice(2).map(el=>el.textContent)).toEqual(['3. Receive stock','4. Make your first sale']);expect(host.textContent).not.toContain('You’ve made your first sale');act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Receive goods').click());expect(navigate).toHaveBeenCalledWith('purchases','new');});
test('failed progress checks show retry without pretending setup is complete',async()=>{api.mockRejectedValueOnce(Error('NETWORK_ERROR'));await render();expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(host.textContent).not.toContain('You’ve made your first sale');await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Try again').click());expect(host.querySelector('[role="alert"]')).toBeNull();});
function Harness({ctx,tabs}){const steps=useWorkspaceSetup(ctx,api,tabs);return <p>{steps.length}</p>;}
test('staff and hidden sections do not trigger unauthorized progress requests',async()=>{await act(async()=>root.render(<Harness ctx={{...context,role:'CASHIER'}} tabs={visibleTabs}/>));expect(api).not.toHaveBeenCalled();expect(host.textContent).toBe('0');await act(async()=>root.render(<Harness ctx={context} tabs={[]}/>));expect(api).not.toHaveBeenCalled();});
