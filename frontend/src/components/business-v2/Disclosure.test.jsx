import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider} from '../../context/LanguageContext';
import {OptionalFields} from './Disclosure';
import {LocalDraftNotice} from '../../lib/localDraft';
import TableTools from './TableTools';
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root;
beforeEach(()=>{window.history.replaceState({},'', '/workspace');localStorage.setItem('profitlens_lang','en');host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.restoreAllMocks();});
function render(node){act(()=>root.render(<LanguageProvider>{node}</LanguageProvider>));}
const rows=[<tr key="a"><td>Milk</td><td>Active</td><td><button>Edit</button></td></tr>,<tr key="b"><td>Bread</td><td>Inactive</td><td><button>Edit</button></td></tr>];
function table(props={}){return <TableTools headers={['name','status','actions']} c={key=>key} render={items=><table><tbody>{items}</tbody></table>} {...props}>{rows}</TableTools>;}
function change(el,value){act(()=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});}
test('empty optional fields collapse, restored values reveal them, invalid fields reopen them',()=>{
 render(<OptionalFields><input required/></OptionalFields>);const details=host.querySelector('details');expect(details.open).toBe(false);
 render(<OptionalFields hasValue><input required/></OptionalFields>);expect(details.open).toBe(true);
 details.open=false;act(()=>host.querySelector('input').dispatchEvent(new Event('invalid',{bubbles:false})));expect(details.open).toBe(true);
});
test('idle draft notice is absent; errors, restoration and offline state remain visible',()=>{
 const draft={status:'idle',online:true,restored:false};render(<LocalDraftNotice draft={draft} lang="en"/>);expect(host.textContent).toBe('');
 render(<LocalDraftNotice draft={{...draft,status:'error'}} lang="en"/>);expect(host.querySelector('[role=alert]').textContent).toContain('could not be saved');
 render(<LocalDraftNotice draft={{...draft,status:'saved',restored:true}} lang="en"/>);expect(host.textContent).toContain('restored');
 render(<LocalDraftNotice draft={{...draft,online:false}} lang="en"/>);expect(host.textContent).toContain('offline');
});
test('table suppresses duplicate search and keeps export under closed options',()=>{
 render(table({searchable:false,filters:<select aria-label="Status"><option>All</option></select>,filtersActive:true}));
 expect(host.querySelectorAll('input').length).toBe(0);expect(host.querySelector('details').open).toBe(false);
 expect(host.querySelector('summary').textContent).toContain('Filtered');expect(host.querySelector('details button').textContent).toContain('CSV');
 expect(host.querySelectorAll('select').length).toBe(1);
});
test('table column filter still filters rows and identifies active filters when collapsed',()=>{
 render(table());change(host.querySelector('select'),'1');change(host.querySelectorAll('select')[1],'Inactive');
 expect(host.querySelectorAll('tbody tr').length).toBe(1);expect(host.querySelector('tbody').textContent).toContain('Bread');expect(host.querySelector('summary').textContent).toContain('Filtered');
 change(host.querySelectorAll('select')[1],'');expect(host.querySelectorAll('tbody tr').length).toBe(2);
});
