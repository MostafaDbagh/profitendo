import 'dotenv/config';
import { pino } from 'pino';
import { readConfig } from './config.js';
import { createDatabase, probeDatabase } from './database.js';
import { readAuthSettings } from './auth/settings.js';
import { AuthService } from './auth/service.js';
import { readPayPalSettings } from './billing/paypal/settings.js';
import { PayPalClient } from './billing/paypal/client.js';
import { createApp } from './app.js';
const config = readConfig(process.env);
const authSettings = readAuthSettings(process.env);
const paypalSettings = readPayPalSettings(process.env);
if (!config.CORS_ORIGINS.includes(authSettings.appOrigin)) throw new Error('APP_ORIGIN must be included in CORS_ORIGINS');
const logger = pino({ level: config.LOG_LEVEL });
const db = createDatabase(config.DATABASE_URL);
try { await db.$connect(); await probeDatabase(db); }
catch { logger.fatal('Database unavailable or migrations missing'); await db.$disconnect(); process.exit(1); }
const server = createApp(config, logger, () => probeDatabase(db), new AuthService(db, authSettings), paypalSettings ? new PayPalClient(paypalSettings) : undefined).listen(config.PORT, config.HOST, () => {
  logger.info({ port: config.PORT, host: config.HOST }, 'API listening');
});
server.on('error', () => { logger.fatal('HTTP server failed'); void db.$disconnect().finally(() => process.exit(1)); });
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  logger.info('Shutting down');
  const deadline = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => { void db.$disconnect().then(() => { clearTimeout(deadline); process.exit(0); }); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
