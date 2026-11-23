import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Dashboard from './Dashboard';
import {LanguageProvider} from '../../context/LanguageContext';
jest.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}),{virtual:true});
jest.mock('./SetupProgressCard',()=>()=>null);
jest.mock('./MySalesDay',()=>()=>null);
jest.mock('./DashboardCharts',()=>({__esModule:true,default:({data})=><div data-testid="charts">{JSON.stringify(data)}</div>}));
jest.mock('../ui/popover',()=>({Popover:({children})=><div>{children}</div>,PopoverTrigger:({children})=><div>{children}</div>,PopoverContent:({children})=><div>{children}</div>}));
jest.mock('../ui/dialog',()=>({Dialog:()=>null,DialogContent:()=>null,DialogTitle:()=>null,DialogDescription:()=>null}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root,api,navigate;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);api=jest.fn(async()=>({currency:'USD',sales:'100',expenses:'10',estimatedProfit:'30',purchases:'50'}));navigate=jest.fn();});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(lang='en',pinLocked=false,permissions={}){localStorage.setItem('profitlens_lang',lang);await act(async()=>root.render(<LanguageProvider><Dashboard context={{business:{id:'b',name:'Shop',timezone:'Asia/Dubai'},permissions:{'reports.view':true,'payments.view':true,'catalogue.cost':true,'purchasing.view':true,...permissions}}} {...{api,lang,pinLocked}} c={k=>k} onSection={navigate} visibleTabs={['reports','payments']}/></LanguageProvider>));}
for(const lang of ['en','ar'])test(`today is default and month remains available (${lang})`,async()=>{await render(lang);const query=new URLSearchParams(api.mock.calls[0][0].split('?')[1]);expect(query.get('from')).toBe(query.get('to'));expect(host.querySelectorAll('dl>div')).toHaveLength(3);expect(host.querySelector('details').open).toBe(false);await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent===(lang==='ar'?'هذا الشهر':'This month')).click());expect(api.mock.calls.at(-1)[0]).toMatch(/from=\d{4}-\d{2}-01/);});
test('money links open the correct reports without inventing customer receivables',async()=>{await render();act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Customer refunds to pay').click());expect(navigate).toHaveBeenCalledWith('reports','refunds');expect(host.textContent).not.toContain('Customers owe you');});
test('locked dashboard removes sensitive figures and chart data',async()=>{await render('en',true);expect(host.querySelectorAll('dl>div')).toHaveLength(1);expect(host.querySelector('[data-testid="charts"]')).toBeNull();});
test('supplier links require cost and purchasing access',async()=>{await render('en',false,{'catalogue.cost':false});expect(host.textContent).not.toContain('What you owe suppliers');});
