import 'dotenv/config';
import { z } from 'zod';
import { createDatabase } from '../database.js';
import { readConfig } from '../config.js';
import { passwordHash } from './crypto.js';
// Local operator command only. No HTTP route can assign SUPER_ADMIN.
const parsed = z.object({ ADMIN_EMAIL: z.string().email().transform(s => s.toLowerCase()), ADMIN_NAME: z.string().min(2), ADMIN_PASSWORD: z.string().min(16).max(128) }).safeParse(process.env);
if (!parsed.success) throw new Error('Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD (at least 16 characters) through secure environment input');
const db = createDatabase(readConfig(process.env).DATABASE_URL);
try {
  const password = await passwordHash(parsed.data.ADMIN_PASSWORD);
  await db.$transaction(async tx => {
    if (await tx.authUser.count({ where: { platformRole: 'SUPER_ADMIN' } })) throw new Error('A platform administrator already exists');
    const user = await tx.authUser.create({ data: { email: parsed.data.ADMIN_EMAIL, name: parsed.data.ADMIN_NAME, passwordHash: password, platformRole: 'SUPER_ADMIN', emailVerifiedAt: new Date() } });
    await tx.authAudit.create({ data: { userId: user.id, action: 'platform_admin.bootstrapped' } });
  }, { isolationLevel: 'Serializable' });
  console.log('Platform administrator created. MFA enrollment is required at first login.');
} finally { await db.$disconnect(); }
