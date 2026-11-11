import type { PrismaClient } from '../generated/prisma/client.js';
import type { AuthSettings } from './settings.js';
import { decrypt } from './crypto.js';
export type MailPayload = { to: string; subject: string; text: string };
export async function deliverMailBatch(db: PrismaClient, settings: AuthSettings, send: (payload: MailPayload) => Promise<void>, limit = 20) {
  let delivered = 0, failed = 0;
  for (let i = 0; i < limit; i++) {
    const row = await db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM auth_mail WHERE delivered_at IS NULL AND available_at <= now() AND attempts < 8 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows[0]) return null;
      return tx.authMail.update({ where: { id: rows[0].id }, data: { attempts: { increment: 1 }, availableAt: new Date(Date.now() + 5 * 60000) } });
    });
    if (!row) break;
    try {
      const payload = JSON.parse(decrypt(settings.key, row.payload, `mail:${row.id}`)) as MailPayload;
      await send(payload);
      await db.authMail.update({ where: { id: row.id }, data: { deliveredAt: new Date(), payload: '' } });
      delivered++;
    } catch {
      // Keep encrypted payload for retry. Never log SMTP errors, which can expose mail content.
      await db.authMail.update({ where: { id: row.id }, data: { availableAt: new Date(Date.now() + Math.min(60, 2 ** row.attempts) * 60000) } });
      failed++;
    }
  }
  return { delivered, failed };
}
