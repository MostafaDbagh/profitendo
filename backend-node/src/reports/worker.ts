import 'dotenv/config';
import {createDatabase} from '../database.js';
import {readConfig} from '../config.js';
import {readAuthSettings} from '../auth/settings.js';
import {prepareReportBatch} from './delivery-worker.js';
const db=createDatabase(readConfig(process.env).DATABASE_URL),settings=readAuthSettings(process.env);
let stopping=false;for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{stopping=true;});
try{do{console.log(JSON.stringify(await prepareReportBatch(db,settings)));if(!process.argv.includes('--watch'))break;for(let i=0;i<15&&!stopping;i++)await new Promise(resolve=>setTimeout(resolve,1000));}while(!stopping);}finally{await db.$disconnect();}
