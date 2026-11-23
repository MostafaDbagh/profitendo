import React,{act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import TimezoneField,{timezoneOptions} from './TimezoneField';
import {LanguageProvider} from '../../context/LanguageContext';
jest.mock('../ui/dialog',()=>({Dialog:({children})=><div role="dialog">{children}</div>,DialogContent:({children})=><div>{children}</div>,DialogTitle:({children})=><h2>{children}</h2>,DialogDescription:({children})=><p>{children}</p>}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root,changed;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);changed=jest.fn();});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.restoreAllMocks();});
function Harness({lang,value:initial='UTC',disabled=false}){const [value,setValue]=useState(initial);return <LanguageProvider><TimezoneField {...{value,lang,disabled}} c={key=>key} onChange={zone=>{changed(zone);setValue(zone);}}/></LanguageProvider>;}
async function render(lang='en',props={}){localStorage.setItem('profitlens_lang',lang);await act(async()=>root.render(<Harness {...{lang,...props}}/>));}
function fill(value){act(()=>{const input=host.querySelector('#timezone-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
for(const [lang,term,label] of [['en','Dubai','Dubai'],['ar','دبي','دبي']])test(`search chooses a city and stores its IANA value (${lang})`,async()=>{
 await render(lang);act(()=>host.querySelector('#business-timezone').click());fill(term);
 const choices=host.querySelectorAll('li button');expect(choices).toHaveLength(1);expect(choices[0].textContent).toBe(label);
 act(()=>choices[0].click());expect(changed).toHaveBeenCalledWith('Asia/Dubai');expect(host.querySelector('[role="dialog"]')).toBeNull();expect(host.querySelector('#business-timezone').textContent).toBe(label);
});
test('opening, searching and closing do not silently replace an existing timezone',async()=>{
 await render('en',{value:'US/Eastern'});act(()=>host.querySelector('#business-timezone').click());fill('not-a-city');expect(host.querySelector('[role="status"]')).not.toBeNull();
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='close').click());expect(changed).not.toHaveBeenCalled();expect(host.querySelector('#business-timezone').textContent).toContain('Eastern');
});
test('preserves UTC and saved aliases when browser timezone enumeration is unavailable',()=>{
 jest.spyOn(Intl,'supportedValuesOf').mockImplementation(()=>{throw Error('unsupported');});
 const zones=timezoneOptions('US/Eastern');expect(zones).toContain('US/Eastern');expect(zones).toContain('UTC');expect(zones).toContain('Asia/Damascus');expect(new Set(zones).size).toBe(zones.length);
});
test('disabled field cannot open the selector',async()=>{await render('en',{disabled:true});act(()=>host.querySelector('button').click());expect(host.querySelector('[role="dialog"]')).toBeNull();});
