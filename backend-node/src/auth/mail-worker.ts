import 'dotenv/config';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { createDatabase } from '../database.js';
import { readConfig } from '../config.js';
import { readAuthSettings } from './settings.js';
import { deliverMailBatch } from './mail.js';
const config = readConfig(process.env), settings = readAuthSettings(process.env);
const parsed = z.object({ SMTP_HOST: z.string().min(1), SMTP_PORT: z.coerce.number().int().min(1).max(65535), SMTP_USER: z.string().min(1), SMTP_PASSWORD: z.string().min(1), MAIL_FROM: z.string().email() }).safeParse(process.env);
if (!parsed.success) throw new Error('Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and MAIL_FROM');
const smtp = parsed.data;
const transport = nodemailer.createTransport({ host: smtp.SMTP_HOST, port: smtp.SMTP_PORT, secure: smtp.SMTP_PORT === 465, requireTLS: true, auth: { user: smtp.SMTP_USER, pass: smtp.SMTP_PASSWORD }, connectionTimeout: 10000, socketTimeout: 30000, greetingTimeout: 10000, disableFileAccess: true, disableUrlAccess: true });
const db = createDatabase(config.DATABASE_URL);
try {
  const counts = await deliverMailBatch(db, settings, async payload => { await transport.sendMail({ from: smtp.MAIL_FROM, ...payload }); });
  console.log(JSON.stringify(counts));
} finally { transport.close(); await db.$disconnect(); }
