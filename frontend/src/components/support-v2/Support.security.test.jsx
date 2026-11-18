import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Thread} from './Support';
import {useResource} from '../business-v2/useBusinessApi';
jest.mock('../business-v2/UI',()=>({Feedback:()=>null,buttonClass:'',primaryClass:'',panelClass:''}));
jest.mock('../business-v2/useBusinessApi',()=>({useResource:jest.fn()}));
it('renders stored support payloads as text, never HTML or event handlers',()=>{
 const payload='<img src=x onerror="window.__xss=1"><script>alert(1)</script>';
 useResource.mockReturnValue({data:{subject:payload,name:payload,email:'visitor@example.test',category:'GENERAL',status:'NEW',messages:[{id:'1',body:payload,createdAt:new Date().toISOString(),fromAdmin:false}]},reload:jest.fn()});
 const html=renderToStaticMarkup(<Thread id="test" api={jest.fn()} lang="en" guest/>);
 const container=document.createElement('div');container.innerHTML=html;
 expect(container.textContent).toContain(payload);
 expect(container.querySelector('script,img,[onerror]')).toBeNull();
});
