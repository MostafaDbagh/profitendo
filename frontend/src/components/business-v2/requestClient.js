import {createRequestFeedback,successFor} from './requestFeedback';
export function createBusinessClient({navigate,fetcher=(...args)=>fetch(...args),baseUrl=process.env.REACT_APP_AUTH_API_URL,timeoutMs=30000,slowMs=5000}){
 let csrf='';
 const feedback=createRequestFeedback();
 const api=async(path,{method='GET',body,signal,download=false}={})=>{
  method=method.toUpperCase();const write=!['GET','HEAD'].includes(method);
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(navigator.onLine===false)throw new Error('OFFLINE_NOT_SENT');
  if(write)feedback.dismiss();
  const controller=new AbortController(),id=Symbol(),abort=()=>controller.abort();
  let timedOut=false;
  signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  const slow=setTimeout(()=>feedback.slow(id,write),slowMs);
  let response;
  try{
   try{
    response=await fetcher(`${baseUrl}/api${path}`,{method,credentials:'include',signal:controller.signal,headers:write?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.status===401){navigate('/auth-v2',{replace:true});throw new Error('SESSION_EXPIRED');}
    if(download&&response.ok)return await response.blob();
    let data;
    try{data=await response.json();}catch(error){
     if(controller.signal.aborted)throw error;
     throw new Error(write?'SAVE_UNCONFIRMED':response.status===429?'TOO_MANY_REQUESTS':response.status>=500?'SERVER_UNAVAILABLE':'INVALID_SERVER_RESPONSE');
    }
    if(['MFA_REQUIRED','PHONE_UNVERIFIED'].includes(data?.error?.code))navigate('/auth-v2',{replace:true});
    if(!response.ok){
     const code=data?.error?.code;
     // Never expose raw server text/stack traces. Keep domain validation codes.
     throw new Error(response.status>=500?(write?'SAVE_UNCONFIRMED':'SERVER_UNAVAILABLE'):response.status===429?'TOO_MANY_REQUESTS':typeof code==='string'&&/^[A-Z][A-Z0-9_]{1,100}$/.test(code)?code:response.status===403?'FORBIDDEN':response.status===404?'NOT_FOUND':'REQUEST_REJECTED');
    }
    if(data===null||typeof data!=='object')throw new Error(write?'SAVE_UNCONFIRMED':'INVALID_SERVER_RESPONSE');
    if(data.csrfToken)csrf=data.csrfToken;
    if(write){const success=successFor(path,body,data);if(success?.key)feedback.saved(success);}
    return data;
   }catch(error){
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(timedOut)throw new Error(write?'SAVE_UNCONFIRMED':'REQUEST_TIMEOUT');
    if(error instanceof TypeError||error?.name==='AbortError')throw new Error(write?'SAVE_UNCONFIRMED':'NETWORK_ERROR');
    throw error;
   }
  }finally{clearTimeout(timeout);clearTimeout(slow);signal?.removeEventListener('abort',abort);feedback.finish(id);}
 };
 api.feedback=feedback;return api;
}
