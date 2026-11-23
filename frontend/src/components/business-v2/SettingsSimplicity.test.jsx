import {feedbackCopy} from './feedbackCopy';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Settings from './Settings';
import {LanguageProvider} from '../../context/LanguageContext';
jest.mock('./FifoSettings',()=>({__esModule:true,default:()=> <section data-testid="fifo-settings">FIFO review</section>}));
jest.mock('./OwnerPin',()=>({OwnerPinUnlock:()=>null}));
jest.mock('./BusinessBackup',()=>({__esModule:true,default:()=>null}));
jest.mock('./DangerZone',()=>({__esModule:true,default:()=>null}));
jest.mock('./SettingsSelect',()=>({__esModule:true,default:({label,id,children,...props})=><label>{label}<select id={id} {...props}>{children}</select></label>}));
jest.mock('../ui/dialog',()=>({Dialog:({children})=><div role="dialog">{children}</div>,DialogContent:({children})=><div>{children}</div>,DialogTitle:({children})=><h2>{children}</h2>,DialogDescription:({children})=><p>{children}</p>}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root,api;
const business={id:'business',name:'Test shop',revision:2,countryCode:'AE',baseCurrency:'AED',timezone:'Asia/Dubai',salesTaxRate:'5',dateFormat:'dmy',numberFormat:'western'};
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);api=jest.fn(async(path,{body})=>({...business,...body,revision:3}));});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(lang='en',props={},permissions={}){localStorage.setItem('profitlens_lang',lang);await act(async()=>root.render(<LanguageProvider><Settings context={{role:'OWNER',business,permissions:{'business.edit':true,'migration.manage':true,...permissions}}} {...{api,lang}} c={key=>key} reload={()=>{}} onName={()=>{}} {...props}/></LanguageProvider>));}
for(const lang of ['en','ar'])test(`business settings come first and accounting stays collapsed (${lang})`,async()=>{
 await render(lang);const form=host.querySelector('form'),fifo=host.querySelector('[data-testid="fifo-settings"]');
 expect(form.compareDocumentPosition(fifo)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(fifo.closest('details').open).toBe(false);
 act(()=>fifo.closest('details').querySelector('summary').click());expect(api).not.toHaveBeenCalled();
 await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(api).toHaveBeenCalledTimes(1);expect(api.mock.calls[0][1].body).toMatchObject({timezone:'Asia/Dubai',revision:2,baseCurrency:'AED',salesTaxRate:'5'});
});
test('searching timezone does not submit settings; selection saves only with Save',async()=>{
 await render();act(()=>host.querySelector('#business-timezone').click());
 const input=host.querySelector('#timezone-search');act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Damascus');input.dispatchEvent(new Event('input',{bubbles:true}));});
 const enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});act(()=>input.dispatchEvent(enter));expect(enter.defaultPrevented).toBe(true);expect(api).not.toHaveBeenCalled();
 act(()=>host.querySelector('[role="dialog"] li button').click());expect(api).not.toHaveBeenCalled();expect(host.querySelector('#business-timezone').textContent).toBe('Damascus');
 await act(async()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(api.mock.calls[0][1].body.timezone).toBe('Asia/Damascus');
});
test('read-only access disables timezone selection and hides unavailable accounting setup',async()=>{
 await render('en',{}, {'business.edit':false,'migration.manage':false});expect(host.querySelector('#business-timezone').disabled).toBe(true);expect(host.querySelector('[data-testid="fifo-settings"]')).toBeNull();
});
test('initial setup omits accounting and a failed save preserves the chosen city',async()=>{
 await render('en',{initialSetup:true,onSetupComplete:()=>{}});expect(host.querySelector('[data-testid="fifo-settings"]')).toBeNull();
 api.mockRejectedValueOnce(Error('NETWORK_ERROR'));await act(async()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(host.querySelector('[role="alert"]').textContent).toContain(feedbackCopy.ar.NETWORK_ERROR);expect(host.querySelector('#business-timezone').textContent).toBe('Dubai');
});
