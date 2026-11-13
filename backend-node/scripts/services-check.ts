import {readSmsSettings} from '../src/auth/sms-settings.js';
import 'dotenv/config';
import {readConfig} from '../src/config.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {readMailSettings,createMailTransport} from '../src/auth/mail-settings.js';
const checks:{name:string;ok:boolean}[]=[];
function check(name:string,fn:()=>unknown){try{fn();checks.push({name,ok:true});}catch{checks.push({name,ok:false});}}
check('API configuration and matching app origin',()=>{const c=readConfig(process.env),a=readAuthSettings(process.env);if(!c.CORS_ORIGINS.includes(a.appOrigin))throw new Error();});
check('real authenticator OTP; mock codes disabled',()=>{if(readAuthSettings(process.env).mockOtp)throw new Error();});
check('owner email and phone verification required',()=>{const settings=readAuthSettings(process.env);if(!settings.emailOtp||!settings.ownerPhoneRequired)throw new Error();});
check('complete Syrian SMS configuration',()=>readSmsSettings(process.env,true));
check('complete SMTP configuration',()=>readMailSettings(process.env,true));
if(process.argv.includes('--connect')){
 let transport:ReturnType<typeof createMailTransport>|undefined;
 try{transport=createMailTransport(readMailSettings(process.env,true)!);await transport.verify();checks.push({name:'SMTP connection, TLS and authentication',ok:true});}
 catch{checks.push({name:'SMTP connection, TLS and authentication',ok:false});}
 finally{transport?.close();}
}
console.log(JSON.stringify({checks,ready:checks.every(c=>c.ok),emailSent:false,smsSent:false,note:'Connection verification does not prove sender authorization or inbox delivery. API and jobs worker must use the same environment and encryption key.'},null,2));
if(checks.some(c=>!c.ok))process.exitCode=1;
