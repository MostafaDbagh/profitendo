import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DraftScope, useLocalDraft } from './localDraft';

global.IS_REACT_ACT_ENVIRONMENT = true;
let host, root, controls;
const scope = {business:{id:'business-a'}, membershipId:'member-a', permissions:{'catalogue.cost':true}, lang:'en'};
function Entry() {
  const [name,setName] = useState(''), [lines,setLines] = useState([]);
  const draft = useLocalDraft('test-entry', {name,lines}, saved=>{setName(saved.name);setLines(saved.lines);});
  controls = {name,lines,setName,setLines,draft};
  return <span>{draft.status}</span>;
}
function mount(value=scope) { act(()=>root.render(<DraftScope.Provider value={value}><Entry key={value.membershipId+value.business.id}/></DraftScope.Provider>)); }
function remount(value=scope) { act(()=>root.unmount());root=createRoot(host);mount(value); }
beforeEach(()=>{localStorage.clear();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.restoreAllMocks();});

test('writes immediately, including ten partially entered rows, and restores after remount',()=>{
  mount();expect(localStorage.length).toBe(0);
  const lines=Array.from({length:10},(_,i)=>({quantity:i===9?'':'2.50',name:`Product ${i}`}));
  act(()=>{controls.setName('Invoice');controls.setLines(lines);});
  expect(controls.draft.status).toBe('saved');expect(JSON.parse(localStorage.getItem(localStorage.key(0))).values.lines).toEqual(lines);
  remount();expect(controls.name).toBe('Invoice');expect(controls.lines).toEqual(lines);expect(controls.draft.restored).toBe(true);
});
test('separates business, membership and permission scopes',()=>{
  mount();act(()=>controls.setName('Private draft'));
  remount({...scope,membershipId:'member-b'});expect(controls.name).toBe('');
  remount({...scope,business:{id:'business-b'}});expect(controls.name).toBe('');
  remount({...scope,permissions:{'catalogue.cost':false}});expect(controls.name).toBe('');
  remount();expect(controls.name).toBe('Private draft');
});
test('does not claim a successful save when storage is full, and recovers on next edit',()=>{
  mount();const failure=jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  act(()=>controls.setName('Still in memory'));expect(controls.draft.status).toBe('error');expect(controls.name).toBe('Still in memory');
  failure.mockRestore();act(()=>controls.setName('Recovered'));expect(controls.draft.status).toBe('saved');remount();expect(controls.name).toBe('Recovered');
});
test('does not overwrite another tab or malformed stored data',()=>{
  mount();act(()=>controls.setName('First'));const key=localStorage.key(0);
  const other=JSON.stringify({version:1,values:{name:'Other tab',lines:[]}});localStorage.setItem(key,other);
  act(()=>controls.setName('Conflicting'));expect(controls.draft.status).toBe('conflict');expect(localStorage.getItem(key)).toBe(other);
  localStorage.setItem(key,'{broken');remount();expect(controls.draft.status).toBe('error');act(()=>controls.setName('New'));expect(localStorage.getItem(key)).toBe('{broken');
});
test('clear after submission prevents resurrection on subsequent renders or remount',()=>{
  mount();act(()=>controls.setName('Submitted'));act(()=>controls.draft.clear());mount();expect(localStorage.length).toBe(0);remount();expect(controls.name).toBe('');
});
test('discard requires confirmation and resets the current form and its backup',()=>{
  mount();act(()=>controls.setName('Discard'));const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);
  act(()=>controls.draft.discard());expect(controls.name).toBe('Discard');confirm.mockReturnValue(true);
  act(()=>controls.draft.discard());expect(controls.name).toBe('');expect(localStorage.length).toBe(0);remount();expect(controls.name).toBe('');
});
test('request metadata is persisted synchronously before a network call',()=>{
  mount();act(()=>controls.setName('Payment'));
  act(()=>controls.draft.checkpoint({clientKey:'stable-retry-key',fingerprint:'same-body'}));
  const stored=JSON.parse(localStorage.getItem(localStorage.key(0))).values;expect(stored.name).toBe('Payment');expect(stored.clientKey).toBe('stable-retry-key');
});

test('caller-managed reset clears the draft after external cleanup without another confirmation',()=>{
  mount();act(()=>controls.setName('Import preview'));const confirm=jest.spyOn(window,'confirm');
  act(()=>controls.draft.reset());expect(confirm).not.toHaveBeenCalled();expect(controls.name).toBe('');expect(localStorage.length).toBe(0);
  remount();expect(controls.name).toBe('');
});
