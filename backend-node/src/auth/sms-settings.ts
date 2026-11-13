import {z} from 'zod';
export function normalizeSyrianMobile(raw:string){
 let value=raw.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[\s()-]/g,'');
 value=value.replace(/^00963/,'').replace(/^\+?963/,'').replace(/^0/,'');
 return /^9\d{8}$/.test(value)?`+963${value}`:null;
}
const schema=z.object({MSGPLUS_API_KEY:z.string().min(1),MSGPLUS_SENDER_NAME:z.string().trim().min(1).max(50),MSGPLUS_TEMPLATE_ID:z.coerce.number().int().positive(),MSGPLUS_VARIABLE_STYLE:z.enum(['code','P1','P2','P3']).default('code'),MSGPLUS_APP_NAME:z.string().trim().min(1).max(60).default('ProfitLens')});
export type SmsSettings=z.infer<typeof schema>;
export function readSmsSettings(env:NodeJS.ProcessEnv,required=env.NODE_ENV==='production'):SmsSettings|null{
 if(!env.MSGPLUS_API_KEY&&!required)return null;
 const parsed=schema.safeParse(env);if(!parsed.success)throw new Error(`Invalid SMS configuration: ${[...new Set(parsed.error.issues.map(i=>i.path.join('.')))].join(', ')}`);return parsed.data;
}
export function smsConfigured(env:NodeJS.ProcessEnv){try{return !!readSmsSettings(env,false);}catch{return false;}}
export async function sendSms(settings:SmsSettings,payload:{phone:string;code:string;name:string},fetcher:typeof fetch=fetch){
 const phone=normalizeSyrianMobile(payload.phone);if(!phone)throw new Error('Invalid SMS destination');
 const vars=settings.MSGPLUS_VARIABLE_STYLE==='code'?{code:payload.code}:settings.MSGPLUS_VARIABLE_STYLE==='P1'?{P1:payload.code}:settings.MSGPLUS_VARIABLE_STYLE==='P2'?{P1:payload.name,P2:payload.code}:{P1:payload.name,P2:settings.MSGPLUS_APP_NAME,P3:payload.code};
 const response=await fetcher('https://sms.msgplus.tech/api/v1/send',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${settings.MSGPLUS_API_KEY}`,'X-Timestamp':String(Math.floor(Date.now()/1000)),'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({sender_name:settings.MSGPLUS_SENDER_NAME,template_id:settings.MSGPLUS_TEMPLATE_ID,numbers:[phone.slice(1)],vars})});
 const body=await response.json().catch(()=>null) as {success?:boolean;sms_log_id?:unknown}|null;
 if(!response.ok||!body||body.success===false||!body.sms_log_id)throw new Error('SMS provider did not accept the request');
}
