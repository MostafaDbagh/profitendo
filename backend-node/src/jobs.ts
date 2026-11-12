import 'dotenv/config';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
// Each bounded job owns its database connections; no overlapping runs in this process.
let stopping=false,child:ReturnType<typeof spawn>|null=null;
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{stopping=true;child?.kill('SIGTERM');});
async function run(path:string){return new Promise<boolean>(resolve=>{
 child=spawn(process.execPath,[new URL(path,import.meta.url).pathname],{stdio:'inherit'});
 const timer=setTimeout(()=>child?.kill('SIGKILL'),90000);
 child.once('error',()=>{clearTimeout(timer);child=null;resolve(false);});
 child.once('exit',code=>{clearTimeout(timer);child=null;resolve(code===0);});
});}
while(!stopping){
 const jobs=['./auth/mail-worker.js','./catalogue/purge-imports.js'];
 if(process.env.B2B_PAYPAL_CLIENT_ID)jobs.push('./billing/paypal/worker.js');
 let healthy=true;
 for(const job of jobs){if(stopping)break;if(!await run(job))healthy=false;}
 if(healthy&&!stopping)await writeFile('/tmp/jobs-heartbeat',new Date().toISOString(),{mode:0o600});
 for(let seconds=0;seconds<30&&!stopping;seconds++)await new Promise(resolve=>setTimeout(resolve,1000));
}
