import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider} from '../../context/LanguageContext';
import {Field} from './Fields';
import {Select} from '../business-v2/UI';
jest.mock('../ui/dialog',()=>({Dialog:()=>null,DialogContent:()=>null,DialogTitle:()=>null,DialogDescription:()=>null}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root;
beforeEach(()=>{window.history.replaceState({},'', '/workspace');host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
function render(node,lang='en'){localStorage.setItem('profitlens_lang',lang);act(()=>root.render(<LanguageProvider key={lang}>{node}</LanguageProvider>));}
for(const lang of ['en','ar'])test(`required indicators are single, red and absent on optional inputs (${lang})`,()=>{
 render(<><Field id="name" label="Name" required/><Field id="notes" label="Notes"/><Select id="unit" label="Unit" required><option>Piece</option></Select><Select id="filter" label="Filter"><option>All</option></Select></>,lang);
 expect(host.querySelectorAll('[data-required-mark]').length).toBe(2);
 for(const id of ['name','unit']){const label=host.querySelector(`label[for="${id}"]`);expect(label.querySelectorAll('[data-required-mark]').length).toBe(1);expect(label.querySelector('[data-required-mark]').className).toContain('text-red-600');expect(host.querySelector(`#${id}`).required).toBe(true);}
 for(const id of ['notes','filter'])expect(host.querySelector(`label[for="${id}"] [data-required-mark]`)).toBeNull();
});
test('conditional requirement follows validation and never changes entered values',()=>{
 render(<Field id="reason" label="Reason" required={false} value="Existing note" readOnly/>);expect(host.querySelector('[data-required-mark]')).toBeNull();
 render(<Field id="reason" label="Reason" required value="Existing note" readOnly/>);expect(host.querySelectorAll('[data-required-mark]').length).toBe(1);expect(host.querySelector('input').value).toBe('Existing note');
 render(<Field id="reason" label="Reason" required={false} value="Existing note" readOnly/>);expect(host.querySelector('[data-required-mark]')).toBeNull();
});
