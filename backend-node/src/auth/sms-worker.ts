import 'dotenv/config';
import {createDatabase} from '../database.js';
import {readConfig} from '../config.js';
import {readAuthSettings} from './settings.js';
import {readSmsSettings,sendSms} from './sms-settings.js';
import {deliverSmsBatch} from './sms.js';
const db=createDatabase(readConfig(process.env).DATABASE_URL),settings=readAuthSettings(process.env),sms=readSmsSettings(process.env,true)!;
try{const counts=await deliverSmsBatch(db,settings,payload=>sendSms(sms,payload));console.log(JSON.stringify(counts));if(counts.failed)process.exitCode=1;}finally{await db.$disconnect();}
