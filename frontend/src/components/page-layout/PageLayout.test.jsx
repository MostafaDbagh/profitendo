import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider} from '../../context/LanguageContext';
import PageToolbar from './PageToolbar';
import {PageLayout} from './PageLayout';
import {EmptyState, Feedback, LoadingState, Pager} from './PageResults';

global.IS_REACT_ACT_ENVIRONMENT=true;
let host, root;
beforeEach(()=>{
  window.history.replaceState({}, '', '/business-v2');
  localStorage.setItem('profitlens_lang','en');
  host=document.body.appendChild(document.createElement('div'));
  root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=node=>act(()=>root.render(<LanguageProvider>{node}</LanguageProvider>));

test('optional layout slots do not add empty containers',()=>{
  render(<PageLayout title="Long page title" actions={[{id:'private',label:'Private',visible:false}]}>
    <article>Non-table content</article>
  </PageLayout>);
  const page=host.querySelector('section');
  expect([...page.children].map(el=>el.tagName)).toEqual(['HEADER','ARTICLE']);
  expect(page.querySelector('header').children).toHaveLength(1);
  expect(page.querySelector('h2').textContent).toBe('Long page title');
});

test('actions respect permissions, loading and disabled states',()=>{
  const run=jest.fn();
  render(<PageLayout title="Purchases" actions={[
    {id:'create',label:'Receive stock',variant:'primary',onClick:run},
    {id:'submit',label:'Submitting',loading:true,onClick:run},
    {id:'busy',label:'Unavailable',disabled:true,onClick:run},
    {id:'restricted',label:'Restricted',visible:false,onClick:run},
  ]}/>);
  const buttons=[...host.querySelectorAll('button')];
  expect(buttons.map(button=>button.textContent)).toEqual(['Receive stock','Submitting','Unavailable']);
  expect(buttons[1].getAttribute('aria-busy')).toBe('true');
  expect(buttons.map(button=>button.disabled)).toEqual([false,true,true]);
  act(()=>buttons.forEach(button=>button.click()));
  expect(run).toHaveBeenCalledTimes(1);
});

test('toolbar supports omitted controls and an independently usable export',()=>{
  render(<PageToolbar/>);
  expect(host.childElementCount).toBe(0);
  const download=jest.fn();
  render(<PageToolbar exportAction={<button type="button" onClick={download}>Export</button>}/>);
  expect(host.querySelector('button[aria-expanded]')).toBeNull();
  expect(host.querySelector('input')).toBeNull();
  act(()=>host.querySelector('button').click());
  expect(download).toHaveBeenCalledTimes(1);
});

test('loading, empty content, failure recovery, and pagination keep separate accessible controls',()=>{
  const retry=jest.fn(),setPage=jest.fn();
  const c=key=>key;
  render(<PageLayout title="Results" status={<LoadingState>Loading records</LoadingState>}/>);
  expect(host.querySelector('[role=status]').textContent).toContain('Loading records');
  render(<PageLayout title="Results" status={<Feedback error="NETWORK_ERROR" {...{c,retry}}/>}>
    <EmptyState>Real empty state</EmptyState>
  </PageLayout>);
  act(()=>host.querySelector('[role=alert] button').click());
  expect(retry).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Real empty state');
  render(<PageLayout title="Results" pagination={<Pager data={{page:1,pageSize:25,total:26}} {...{setPage,c}}/>}/>);
  const [previous,next]=host.querySelectorAll('button');
  expect(previous.disabled).toBe(true);
  expect(next.disabled).toBe(false);
  act(()=>next.click());
  expect(setPage).toHaveBeenCalledWith(2);
});
