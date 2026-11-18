import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CopyableCode from './CopyableCode';
import { toast } from 'sonner';
jest.mock('../context/LanguageContext',()=>({useLanguage:()=>({lang:'ar'})}));
jest.mock('sonner',()=>({toast:{success:jest.fn(),error:jest.fn()}}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root,writeText;
beforeEach(()=>{host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);writeText=jest.fn().mockResolvedValue();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.clearAllMocks();});
test('copies an exact leading-zero barcode without selecting its parent or submitting',async()=>{
 const select=jest.fn(),submit=jest.fn();act(()=>root.render(<form onSubmit={submit}><div onClick={select}><CopyableCode kind="barcode">001234567890</CopyableCode></div></form>));
 const button=host.querySelector('button');expect(button.type).toBe('button');expect(button.getAttribute('aria-label')).toContain('001234567890');
 await act(async()=>button.click());expect(writeText).toHaveBeenCalledWith('001234567890');expect(select).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();expect(toast.success).toHaveBeenCalled();
});
test('reports a clipboard failure without pretending that copying succeeded',async()=>{
 writeText.mockRejectedValue(new Error('Denied'));act(()=>root.render(<CopyableCode>MOCK-001</CopyableCode>));await act(async()=>host.querySelector('button').click());expect(toast.error).toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();
});
