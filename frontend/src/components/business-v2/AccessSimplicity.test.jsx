import {feedbackCopy} from './feedbackCopy';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Roles from './Roles';
import Team from './Team';
import {LanguageProvider} from '../../context/LanguageContext';
jest.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}),{virtual:true});
jest.mock('./MemberLocations',()=>({__esModule:true,default:()=>null,LocationChoices:()=>null}));
jest.mock('../ui/dialog',()=>({Dialog:({children})=><div role="dialog">{children}</div>,DialogContent:({children})=><div>{children}</div>,DialogTitle:({children})=><h2>{children}</h2>,DialogDescription:({children})=><p>{children}</p>}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root,api;
const roleData={canCreate:true,permissions:{'business.view':{},'sales.create':{},'receiving.confirm':{}},grantableKeys:['business.view','sales.create'],roles:[{role:'OWNER',permissions:{'business.view':true,'sales.create':true,'receiving.confirm':true}},{role:'CASHIER',permissions:{'business.view':true,'sales.create':true,'receiving.confirm':false}},{role:'VIEWER',permissions:{'business.view':true,'sales.create':false}}]};
const member={id:'member',revision:3,name:'Mostafa',role:'CASHIER',active:true,canEdit:true,email:'test@example.test',permissionOverrides:{'sales.create':false}};
const teamData={items:[member],page:1,pageSize:25,total:1,roleDefaults:roleData.roles,permissionKeys:['sales.create','receiving.confirm','team.manage']};
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);api=jest.fn(async(path,options)=>options?.method?{}:path.includes('/roles')?roleData:teamData);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(Component,lang='en',context={role:'OWNER',permissions:{'team.manage':true}}){localStorage.setItem('profitlens_lang',lang);await act(async()=>root.render(<LanguageProvider><Component {...{api,lang}} c={key=>key} context={{business:{id:'business'},...context}}/></LanguageProvider>));}
const button=label=>[...host.querySelectorAll('button')].find(el=>el.textContent===label);
function select(id,value){act(()=>{const el=host.querySelector(`[id="${id}"]`);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});}
function fill(id,value){act(()=>{const el=host.querySelector(`[id="${id}"]`);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
const writes=()=>api.mock.calls.filter(([,options])=>options?.method);
for(const lang of ['en','ar'])test(`role list replaces the permission matrix with expandable details (${lang})`,async()=>{
 await render(Roles,lang);expect(host.querySelector('table')).toBeNull();expect(host.querySelectorAll('details')).toHaveLength(3);expect([...host.querySelectorAll('details')].every(d=>!d.open)).toBe(true);
 act(()=>host.querySelector('summary').click());expect(host.querySelector('details').open).toBe(true);expect(host.querySelector('details').textContent).toContain('receiving.confirm');expect(writes()).toHaveLength(0);
});
test('role template applies only grantable permissions and customization is optional',async()=>{
 await render(Roles);act(()=>button('addRole').click());expect(host.querySelector('#role-base').compareDocumentPosition(host.querySelector('#role-name'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 select('role-base','CASHIER');fill('role-name','Checkout staff');const dialog=host.querySelector('[role="dialog"]');expect(dialog.querySelector('details').open).toBe(false);
 await act(async()=>dialog.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(writes()[0][1].body).toEqual({name:'Checkout staff',permissions:{'business.view':true,'sales.create':true}});
});
test('collapsed member customization preserves existing exceptions on save',async()=>{
 await render(Team);act(()=>button('edit').click());const dialog=host.querySelector('[role="dialog"]');expect(dialog.querySelector('summary').textContent).toContain('(1)');expect(dialog.querySelector('details').open).toBe(false);
 await act(async()=>dialog.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(writes()[0][1].body).toMatchObject({revision:3,role:'CASHIER',permissionOverrides:{'sales.create':false}});
});
test('switching role resets exceptions as before; viewing permission groups does not change access',async()=>{
 await render(Team);act(()=>button('edit').click());act(()=>host.querySelector('[role="dialog"] summary').click());expect(writes()).toHaveLength(0);
 select('member-role','VIEWER');expect(host.querySelector('[id="permission-sales.create"]').value).toBe('default');
 await act(async()=>host.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(writes()[0][1].body).toMatchObject({role:'VIEWER',permissionOverrides:{}});
});
test('manager cannot enable an unowned permission, and errors retain edits for retry',async()=>{
 await render(Team,'en',{role:'OPERATIONS_MANAGER',permissions:{'team.manage':true,'sales.create':true,'receiving.confirm':false}});act(()=>button('edit').click());
 expect(host.querySelector('[id="permission-receiving.confirm"] option[value="true"]').disabled).toBe(true);
 select('permission-sales.create','true');api.mockRejectedValueOnce(Error('FORBIDDEN'));
 await act(async()=>host.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(host.querySelector('[role="alert"]').textContent).toContain(feedbackCopy.ar.FORBIDDEN);expect(host.querySelector('[id="permission-sales.create"]').value).toBe('true');expect(writes()[0][1].body.permissionOverrides).not.toHaveProperty('team.manage');
});
