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
function toolbar(){
 const toggle=host.querySelector('button[aria-expanded]');
 return {toggle,panel:document.getElementById(toggle.getAttribute('aria-controls')),row:toggle.parentElement};
}
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
test.each(['en','ar'])('search, options, and export share one row in logical order (%s)',lang=>{
 localStorage.setItem('profitlens_lang',lang);
 render(table());
 const {toggle,panel,row}=toolbar();
 const button=row.querySelector('button[aria-label*="CSV"]');
 expect(row.children).toHaveLength(3);
 expect(row.children[0].querySelector('input')).not.toBeNull();
 expect(row.children[1]).toBe(toggle);
 expect(row.children[2].contains(button)).toBe(true);
 expect(row.parentElement.dir).toBe(lang==='ar'?'rtl':'ltr');
 expect(panel.hidden).toBe(true);
 expect(toggle.getAttribute('aria-expanded')).toBe('false');
 act(()=>toggle.click());
 expect(panel.hidden).toBe(false);
 expect(toggle.getAttribute('aria-expanded')).toBe('true');
 expect(row.parentElement.children[1]).toBe(panel);
 expect(panel.contains(button)).toBe(false);
});
test('table column filter still filters rows and identifies active filters when collapsed',()=>{
 render(table());const {toggle,panel}=toolbar();act(()=>toggle.click());
 change(host.querySelector('select'),'1');change(host.querySelectorAll('select')[1],'Inactive');
 act(()=>toggle.click());
 expect(host.querySelectorAll('tbody tr').length).toBe(1);expect(host.querySelector('tbody').textContent).toContain('Bread');
 expect(toggle.getAttribute('aria-label')).toContain('Filtered');expect(panel.hidden).toBe(true);
 act(()=>toggle.click());
 expect(host.querySelectorAll('select')[1].value).toBe('Inactive');
 change(host.querySelectorAll('select')[1],'');expect(host.querySelectorAll('tbody tr').length).toBe(2);
});
test('clearing table search restores matching rows, keeps the column filter and returns focus',()=>{
 render(table());act(()=>toolbar().toggle.click());change(host.querySelector('select'),'1');change(host.querySelectorAll('select')[1],'Inactive');
 const input=host.querySelector('input');act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Milk');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
 act(()=>host.querySelector('button[aria-label="Clear search"]').click());
 expect(host.querySelectorAll('tbody tr')).toHaveLength(1);expect(host.querySelector('tbody').textContent).toContain('Bread');expect(document.activeElement).toBe(input);
 expect(host.querySelector('[role="status"]').textContent).toContain('1 of 2');
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Clear column filter').click());expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
});
test('a custom search and report export replace the defaults in the same toolbar',()=>{
 const exportReport=jest.fn();
 render(table({searchContent:<input aria-label="Product search"/>,searchActions:<button onClick={exportReport}>Export report</button>,
  filters:<select aria-label="Status"><option>All</option></select>,filtersActive:true}));
 const {toggle,panel,row}=toolbar();
 expect(row.querySelectorAll('input')).toHaveLength(1);
 expect(host.querySelector('input[aria-label="Product search"]')).not.toBeNull();
 expect(row.querySelectorAll('button')).toHaveLength(2);
 expect(toggle.getAttribute('aria-label')).toContain('Filtered');
 expect(panel.hidden).toBe(true);
 expect(panel.querySelectorAll('select')).toHaveLength(1);
 act(()=>row.children[2].querySelector('button').click());
 expect(exportReport).toHaveBeenCalledTimes(1);
});
