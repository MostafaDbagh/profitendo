import { PrismaClient } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
export function createDatabase(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: '-c timezone=UTC', connectionTimeoutMillis: 5000, statement_timeout: 5000, max: 10 }) });
}
export async function probeDatabase(db: PrismaClient) {
  const metadata = await db.systemMetadata.findUnique({ where: { key: 'schema_version' } });
  if (metadata?.value !== 'operations-completion-v1') throw new Error('Database migration is required');
}
