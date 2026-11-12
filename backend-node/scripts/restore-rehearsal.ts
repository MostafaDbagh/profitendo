import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const raw=process.env.TEST_DATABASE_URL;if(!raw)throw new Error('TEST_DATABASE_URL required');const url=new URL(raw);
if(!url.pathname.endsWith('_test')||!['localhost','127.0.0.1','::1'].includes(url.hostname))throw new Error('Local isolated _test database required');
const name=`profitlens_restore_${randomUUID().replaceAll('-','')}`,dir=await mkdtemp(join(tmpdir(),'profitlens-restore-'));await chmod(dir,0o700);
const environment={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)};
function command(binary:string,args:string[],database=environment.PGDATABASE){return new Promise<void>((resolve,reject)=>{const child=spawn(binary,args,{env:{...environment,PGDATABASE:database},stdio:['ignore','ignore','pipe']});let detail='';child.stderr.on('data',v=>{detail+=String(v);});child.on('error',()=>reject(new Error(`${binary} could not start`)));child.on('close',code=>code===0?resolve():reject(new Error(`${binary} failed (exit ${code}); verify PostgreSQL client version and permissions`)));});}
const source=new Client({connectionString:raw}),restoreUrl=new URL(raw);restoreUrl.pathname=`/${name}`;const restored=new Client({connectionString:restoreUrl.toString()});let created=false,connected=false;
async function counts(db:Client){const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows as {tablename:string}[];const result:Record<string,string>={};for(const {tablename} of tables){if(!/^[a-z_]+$/.test(tablename))throw new Error('Unexpected table name');result[tablename]=(await db.query(`SELECT COUNT(*)::text AS count FROM "${tablename}"`)).rows[0].count;}return result;}
try{
 await source.connect();await command('pg_dump',['--format=custom','--no-owner','--no-acl','--file',join(dir,'rehearsal.dump')]);const before=await counts(source);
 await source.query(`CREATE DATABASE "${name}"`);created=true;await command('pg_restore',['--exit-on-error','--no-owner','--no-acl','--dbname',name,join(dir,'rehearsal.dump')],name);await restored.connect();connected=true;
 const after=await counts(restored);if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Restored table counts differ; stop writes and repeat');
 const marker=(await restored.query("SELECT value FROM system_metadata WHERE key='schema_version'")).rows[0]?.value;if(marker!=='paid-reconciliation-v1')throw new Error('Restored schema marker is incorrect');
 const triggers=(await restored.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O'")).rows.map(r=>r.tgname);for(const required of ['stock_history_immutable','adjustment_immutable','money_entries_immutable','cash_closes_immutable'])if(!triggers.includes(required))throw new Error('Restored history protection missing');
 console.log(JSON.stringify({result:'PASS',tables:Object.keys(after).length,schema:marker,immutableTriggersVerified:true,sourceUnchanged:true,temporaryDatabaseRemovedOnExit:true}));
}finally{if(connected)await restored.end();if(created)await source.query(`DROP DATABASE "${name}" WITH (FORCE)`);await source.end();await rm(dir,{recursive:true,force:true});}
