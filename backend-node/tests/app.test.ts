import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { pino } from 'pino';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { errorHandler, validateBody } from '../src/errors.js';
const logger = pino({ level: 'silent' });
const config = { CORS_ORIGINS: ['http://localhost:3000'] };
const app = createApp(config, logger, async () => {});
describe('HTTP boundary', () => {
  it('returns liveness and security headers without framework details', async () => {
    const res = await request(app).get('/api/health/live');
    expect(res.status).toBe(200); expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
  it('returns ready only when the database probe succeeds', async () => {
    expect((await request(app).get('/api/health/ready')).status).toBe(200);
    const broken = createApp(config, logger, async () => { throw new Error('postgresql://secret'); });
    const res = await request(broken).get('/api/health/ready');
    expect(res.status).toBe(503); expect(res.body.error.code).toBe('NOT_READY');
    expect(res.text).not.toContain('secret');
  });
  it('restricts browser origins and supports credentialed preflight', async () => {
    const allowed = await request(app).options('/api/health/live').set('Origin', config.CORS_ORIGINS[0]!).set('Access-Control-Request-Method', 'GET');
    expect(allowed.status).toBe(204); expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect((await request(app).get('/api/health/live').set('Origin','https://untrusted.example')).status).toBe(403);
  });
  it('normalizes missing routes, malformed JSON and oversized bodies', async () => {
    const missing = await request(app).get('/api/businesses');
    expect(missing.status).toBe(404); expect(missing.body.detail).toBe('Route not found');
    const malformed = await request(app).post('/api/example').set('Content-Type','application/json').send('{');
    expect(malformed.status).toBe(400); expect(malformed.body.error.code).toBe('INVALID_JSON');
    expect((await request(app).post('/api/example').send({ text: 'x'.repeat(110_000) })).status).toBe(413);
  });
  it('validates bodies and hides unexpected exception content', async () => {
    const validationApp = express();
    validationApp.use(express.json());
    validationApp.post('/validate', validateBody(z.object({ quantity: z.number().positive() })), (_req, res) => { res.sendStatus(204); });
    validationApp.get('/failure', async () => { throw new Error('private internal details'); });
    validationApp.use(errorHandler(logger));
    expect((await request(validationApp).post('/validate').send({ quantity: -1 })).status).toBe(422);
    expect((await request(validationApp).post('/validate').send({ quantity: 1 })).status).toBe(204);
    const fail = await request(validationApp).get('/failure');
    expect(fail.status).toBe(500); expect(fail.text).not.toContain('private');
  });
});
describe('configuration', () => {
  const env = { DATABASE_URL: 'postgresql://user:password@localhost/db', CORS_ORIGINS: 'http://localhost:3000' };
  it('parses defaults and rejects invalid or wildcard origins', () => {
    expect(readConfig(env).PORT).toBe(4000);
    expect(() => readConfig({ ...env, PORT: '0' })).toThrow();
    expect(() => readConfig({ ...env, CORS_ORIGINS: '*' })).toThrow();
    expect(() => readConfig({ ...env, NODE_ENV: 'production' })).toThrow('HTTPS');
  });
  it('never puts invalid credential values in configuration errors', () => {
    expect(() => readConfig({ ...env, DATABASE_URL: 'secret-value' })).toThrow('Invalid configuration: DATABASE_URL');
  });
});
