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
