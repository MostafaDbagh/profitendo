import {readSmsSettings} from '../src/auth/sms-settings.js';
import {readMailSettings} from '../src/auth/mail-settings.js';
import 'dotenv/config';
import { readConfig } from '../src/config.js';
import { readAuthSettings } from '../src/auth/settings.js';
import { readPayPalSettings } from '../src/billing/paypal/settings.js';
import { checkoutConfiguration } from '../src/billing/paypal/launch.js';
import { createDatabase,probeDatabase } from '../src/database.js';
const checks:{name:string;ok:boolean}[]=[];
function check(name:string,fn:()=>unknown){try{fn();checks.push({name,ok:true});}catch{checks.push({name,ok:false});}}
check('production API configuration',()=>{const c=readConfig(process.env);if(c.NODE_ENV!=='production')throw new Error();const a=readAuthSettings(process.env);if(!c.CORS_ORIGINS.includes(a.appOrigin))throw new Error();});
check('SMTP configuration present',()=>{readMailSettings(process.env,true);});
check('Syrian SMS configuration present',()=>readSmsSettings(process.env,true));
check('billing launch configuration',()=>{const launch=checkoutConfiguration();if(launch.enabled&&!readPayPalSettings(process.env))throw new Error();});
if(!process.argv.includes('--offline')){
 let db:ReturnType<typeof createDatabase>|undefined;
 try{db=createDatabase(readConfig(process.env).DATABASE_URL);await probeDatabase(db);checks.push({name:'database schema ready',ok:true});}catch{checks.push({name:'database schema ready',ok:false});}finally{await db?.$disconnect();}
}
console.log(JSON.stringify({checks,configurationReady:checks.every(c=>c.ok),externalValidationRequired:['SMTP delivery','provider sandbox','backup restore','hardware pilot','owner acceptance']},null,2));
if(checks.some(c=>!c.ok))process.exitCode=1;
