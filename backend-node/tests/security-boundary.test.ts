import {authHttp} from '../src/auth/http.js';
import {csrfFor} from '../src/auth/crypto.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {errorHandler} from '../src/errors.js';
import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {pino} from 'pino';
import {readFileSync} from 'node:fs';
import {createApp} from '../src/app.js';
import {requestBudget} from '../src/request-budget.js';
import {readConfig} from '../src/config.js';
describe('security boundaries',()=>{
 it('ignores forged forwarded IPs unless the direct proxy is trusted',async()=>{
  const app=createApp({CORS_ORIGINS:['http://localhost']},pino({level:'silent'}),async()=>{});
  expect(app.get('trust proxy fn')('127.0.0.1',0)).toBe(false);
  const trusted=createApp({CORS_ORIGINS:['http://localhost'],TRUST_PROXY_IP:'172.30.86.2'},pino({level:'silent'}),async()=>{});
  expect(trusted.get('trust proxy fn')('172.30.86.2',0)).toBe(true);
  expect(trusted.get('trust proxy fn')('172.30.86.3',0)).toBe(false);
  expect(()=>readConfig({DATABASE_URL:'postgresql://localhost/test',CORS_ORIGINS:'http://localhost',TRUST_PROXY_IP:'true'})).toThrow();
 });
 it('limits requests despite changing spoofed headers, then recovers',async()=>{
  let now=1000;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
  try{const app=express();app.use(requestBudget(2,1000));app.get('/',(_req,res)=>res.sendStatus(200));
   expect((await request(app).get('/').set('X-Forwarded-For','1.1.1.1')).status).toBe(200);
   expect((await request(app).get('/').set('X-Forwarded-For','2.2.2.2')).status).toBe(200);
   const blocked=await request(app).get('/');expect(blocked.status).toBe(429);expect(blocked.headers['retry-after']).toBe('1');
   now=2001;expect((await request(app).get('/')).status).toBe(200);
  }finally{clock.mockRestore();}
 });
 it('does not load third-party tracking and protects HTML at the edge',()=>{
  const html=readFileSync('../frontend/public/index.html','utf8');expect(html).not.toMatch(/posthog|emergent-main|<script/);
  const edge=readFileSync('../deployment/Caddyfile','utf8');expect(edge).toContain("script-src 'self'");expect(edge).toContain("frame-ancestors 'none'");expect(edge).toContain('X-Frame-Options DENY');
 });
});

it('rejects cross-origin writes and missing, forged or other-session CSRF tokens',async()=>{
 const key=Buffer.alloc(32,1),token='a'.repeat(43);
 const auth={settings:{key,appOrigin:'https://app.example.com'}} as AuthService;
 const http=authHttp(auth),app=express();
 app.use((_req,res,next)=>{res.locals.auth={token};next();});
 app.post('/write',http.origin,http.csrf,(_req,res)=>res.sendStatus(204));
 app.use(errorHandler(pino({level:'silent'})));
 for(const origin of ['', 'null','https://evil.example.com']){
  const result=await request(app).post('/write').set('Origin',origin).set('X-CSRF-Token',csrfFor(key,token)).send({});
  expect(result.status).toBe(403);
 }
 for(const csrf of ['', 'forged',csrfFor(key,'b'.repeat(43))]){
  expect((await request(app).post('/write').set('Origin',auth.settings.appOrigin).set('X-CSRF-Token',csrf).send({})).status).toBe(403);
 }
 expect((await request(app).post('/write').set('Origin',auth.settings.appOrigin).set('X-CSRF-Token',csrfFor(key,token)).send({})).status).toBe(204);
});

// Exercise the real router and limiter; replace only persistence with an atomic counter.
function contactFixture(){
 const counts=new Map<string,number>();
 const create=vi.fn(async()=>({id:'00000000-0000-4000-8000-000000000001'}));
 const upsert=vi.fn(async({where}:{where:{key:string}})=>{const count=(counts.get(where.key)??0)+1;counts.set(where.key,count);return {count};});
 const auth=Object.assign(Object.create(AuthService.prototype) as AuthService,{
  settings:readAuthSettings({AUTH_ENCRYPTION_KEY:'ab'.repeat(32),APP_ORIGIN:'https://app.example.com'}),
  db:{authRateLimit:{upsert},supportTicket:{create}},
 });
 const makeApp=()=>createApp({CORS_ORIGINS:[auth.settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
 const send=(app:ReturnType<typeof makeApp>,email='visitor@example.com',forwarded='198.51.100.1')=>request(app).post('/api/support/public').set('Origin',auth.settings.appOrigin).set('X-Forwarded-For',forwarded).send({name:'Visitor',email,subject:'Contact request',category:'GENERAL',body:'Please contact me.'});
 return {makeApp,send,create,upsert};
}
it('limits public contact submissions by normalized email across app instances',async()=>{
 const {makeApp,send,create}=contactFixture();
 for(let i=0;i<3;i++)expect((await send(makeApp())).status).toBe(201);
 const blocked=await send(makeApp(),' VISITOR@EXAMPLE.COM ');
 expect(blocked.status).toBe(429);expect(blocked.body.error.code).toBe('RATE_LIMITED');expect(blocked.headers['retry-after']).toBe('3600');expect(create).toHaveBeenCalledTimes(3);
});
it('limits public contact submissions by IP despite changing email and forwarded headers',async()=>{
 const {makeApp,send,create}=contactFixture(),app=makeApp();
 for(let i=0;i<5;i++)expect((await send(app,`visitor${i}@example.com`,`198.51.100.${i}`)).status).toBe(201);
 const blocked=await send(app,'another@example.com','203.0.113.9');
 expect(blocked.status).toBe(429);expect(blocked.headers['retry-after']).toBe('3600');expect(create).toHaveBeenCalledTimes(5);
});
it('blocks malformed contact floods before parsing or database access and recovers after a minute',async()=>{
 let now=100000;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
 try{
  const {makeApp,upsert,create}=contactFixture(),app=makeApp();
  const malformed=()=>request(app).post('/api/support/public').set('Content-Type','application/json').send('{');
  for(let i=0;i<10;i++)expect((await malformed()).status).toBe(400);
  const blocked=await malformed();expect(blocked.status).toBe(429);expect(blocked.headers['retry-after']).toBe('60');
  expect(upsert).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
  now+=60001;expect((await malformed()).status).toBe(400);
 }finally{clock.mockRestore();}
});
