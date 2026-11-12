import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/auth/service.js';
import { readAuthSettings } from '../src/auth/settings.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated TEST_DATABASE_URL required');
Object.assign(process.env,{AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:process.env.BROWSER_APP_ORIGIN||'http://localhost:3100',BROWSER_API_ORIGIN:'http://localhost:4100',AUTH_SCREENSHOTS:'../tmp/auth-real-design',NODE_ENV:'test',AUTH_MOCK_OTP:'false'});
const settings=readAuthSettings(process.env),db=createDatabase(url);
const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},new AuthService(db,settings));
app.set('trust proxy','loopback');
process.env.BROWSER_TEST_IP=`10.253.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
const server=await new Promise<ReturnType<typeof app.listen>>((resolve,reject)=>{const s=app.listen(4100,'localhost',()=>resolve(s));s.on('error',reject);});
try{await import('./auth-browser.js');}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await db.$disconnect();}
