import 'dotenv/config';
import {readMailSettings,createMailTransport} from './mail-settings.js';
import { createDatabase } from '../database.js';
import { readConfig } from '../config.js';
import { readAuthSettings } from './settings.js';
import { deliverMailBatch } from './mail.js';
const config = readConfig(process.env), settings = readAuthSettings(process.env);
const smtp=readMailSettings(process.env,true)!;
const transport=createMailTransport(smtp);
const db = createDatabase(config.DATABASE_URL);
try {
  const counts = await deliverMailBatch(db, settings, async payload => { await transport.sendMail({ from: {name:smtp.MAIL_FROM_NAME,address:smtp.MAIL_FROM}, replyTo:smtp.MAIL_REPLY_TO, ...payload }); });
  console.log(JSON.stringify(counts));
  if(counts.failed)process.exitCode=1;
} finally { transport.close(); await db.$disconnect(); }
