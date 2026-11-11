import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { pino } from 'pino';
import { createDatabase, probeDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Set TEST_DATABASE_URL to a dedicated database ending in _test; apply migrations first.');
const db = createDatabase(url);
afterAll(async () => { await db.$disconnect(); });
describe('real PostgreSQL foundation', () => {
  it('reads the applied migration through Prisma and HTTP readiness', async () => {
    await expect(probeDatabase(db)).resolves.toBeUndefined();
    const app = createApp({ CORS_ORIGINS: ['http://localhost:3000'] }, pino({ level: 'silent' }), () => probeDatabase(db));
    expect((await request(app).get('/api/health/ready')).status).toBe(200);
  });
  it('preserves UTC instants in SQL even when the database server uses another timezone', async () => {
    const key = `time-${randomUUID()}`, instant = new Date('2026-11-11T14:00:00.000Z');
    try {
      await db.systemMetadata.create({ data: { key, value: 'timezone-check', createdAt: instant } });
      const [row] = await db.$queryRaw<{ epoch: number }[]>`SELECT EXTRACT(EPOCH FROM created_at)::double precision AS epoch FROM system_metadata WHERE key = ${key}`;
      expect(row!.epoch * 1000).toBe(instant.getTime());
    } finally { await db.systemMetadata.deleteMany({ where: { key } }); }
  });
  it('rolls back all writes when a unique constraint fails inside a transaction', async () => {
    const key = `rollback-${randomUUID()}`;
    try {
      await expect(db.$transaction(async tx => {
        await tx.systemMetadata.create({ data: { key, value: 'first' } });
        await tx.systemMetadata.create({ data: { key, value: 'duplicate' } });
      })).rejects.toMatchObject({ code: 'P2002' });
      expect(await db.systemMetadata.findUnique({ where: { key } })).toBeNull();
    } finally { await db.systemMetadata.deleteMany({ where: { key } }); }
  });
});

it('retries adapter serialization errors raised at COMMIT without duplicating writes', async () => {
  const { AuthService } = await import('../src/auth/service.js');
  const { readAuthSettings } = await import('../src/auth/settings.js');
  const { randomBytes } = await import('node:crypto');
  const auth = new AuthService(db, readAuthSettings({ AUTH_ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_ORIGIN: 'http://localhost:3000' }));
  // A deferred trigger reproduces a PostgreSQL serialization failure specifically
  // at COMMIT. Sequence increments survive rollback, so only the first attempt fails.
  const suffix = randomUUID().replaceAll('-', ''), table = `retry_${suffix}`, seq = `seq_${suffix}`, fn = `fn_${suffix}`;
  let attempts = 0;
  try {
    await db.$executeRawUnsafe(`CREATE SEQUENCE ${seq}`);
    await db.$executeRawUnsafe(`CREATE TABLE ${table} (id int PRIMARY KEY)`);
    await db.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('${seq}') = 1 THEN RAISE EXCEPTION 'test serialization conflict' USING ERRCODE = '40001'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER retry_commit AFTER INSERT ON ${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    await auth.transaction(async tx => { attempts++; await tx.$executeRawUnsafe(`INSERT INTO ${table} (id) VALUES (1)`); });
    expect(attempts).toBe(2);
    expect(await db.$queryRawUnsafe(`SELECT id FROM ${table}`)).toEqual([{ id: 1 }]);
  } finally {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table}`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
    await db.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS ${seq}`);
  }
});

it('retries serialization errors raised inside a raw query without duplicating writes', async () => {
  const { AuthService } = await import('../src/auth/service.js');
  const { readAuthSettings } = await import('../src/auth/settings.js');
  const { randomBytes } = await import('node:crypto');
  const auth = new AuthService(db, readAuthSettings({ AUTH_ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_ORIGIN: 'http://localhost:3000' }));
  // An immediate trigger reproduces a raw-query serialization conflict.
  // Sequence increments survive rollback, so only the first attempt fails.
  const suffix = randomUUID().replaceAll('-', ''), table = `retry_${suffix}`, seq = `seq_${suffix}`, fn = `fn_${suffix}`;
  let attempts = 0;
  try {
    await db.$executeRawUnsafe(`CREATE SEQUENCE ${seq}`);
    await db.$executeRawUnsafe(`CREATE TABLE ${table} (id int PRIMARY KEY)`);
    await db.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('${seq}') = 1 THEN RAISE EXCEPTION 'test serialization conflict' USING ERRCODE = '40001'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER retry_commit AFTER INSERT ON ${table} NOT DEFERRABLE FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    await auth.transaction(async tx => { attempts++; await tx.$executeRawUnsafe(`INSERT INTO ${table} (id) VALUES (1)`); });
    expect(attempts).toBe(2);
    expect(await db.$queryRawUnsafe(`SELECT id FROM ${table}`)).toEqual([{ id: 1 }]);
  } finally {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table}`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
    await db.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS ${seq}`);
  }
});
