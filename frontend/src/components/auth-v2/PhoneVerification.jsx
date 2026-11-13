import PhoneInput,{internationalPhone} from './PhoneInput';
import {useEffect,useState} from 'react';
import {Submit,linkClass} from './Fields';
import OtpField from './OtpField';
export default function PhoneVerification({call,c,mockOtp,done,logout,initialPhone=''}){
 const [phone,setPhone]=useState(()=>internationalPhone(initialPhone)),[challenge,setChallenge]=useState(null),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[resendAt,setResendAt]=useState(0),[now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 async function request(){const result=await call('/phone-code/request',{phone});setChallenge(result.challenge);setCode('');setResendAt(Date.now()+60000);setNow(Date.now());}
 async function run(work){setBusy(true);setError('');try{await work();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <div className="space-y-4 mt-5"><p className="text-sm text-slate-600">{c('phoneVerificationHint')}</p>{mockOtp&&<p className="text-sm text-amber-900">{c('mockNotice')}</p>}{error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{c(error)}</p>}
 <form className="space-y-4" onSubmit={e=>{e.preventDefault();run(async()=>{if(challenge)done(await call('/phone-code/confirm',{challenge,code}));else await request();});}}>
 <PhoneInput id="v2-phone" label={c('phoneNumber')} value={phone} onChange={setPhone} disabled={busy||!!challenge}/>
 {challenge&&<><p className="text-sm text-slate-600">{c('phoneCodeHint')}</p><OtpField c={c} value={code} onChange={setCode} disabled={busy}/></>}
 <Submit busy={busy}>{c(challenge?'verifyCode':'sendCode')}</Submit></form>
 {challenge&&<div className="flex flex-wrap gap-4"><button className={linkClass} disabled={busy||now<resendAt} onClick={()=>run(request)}>{now<resendAt?`${c('resendIn')} ${Math.ceil((resendAt-now)/1000)}`:c('resendCode')}</button><button className={linkClass} disabled={busy} onClick={()=>{setChallenge(null);setCode('');setError('');}}>{c('changePhone')}</button></div>}
 <button className={linkClass} disabled={busy} onClick={logout}>{c('logout')}</button></div>;
}
