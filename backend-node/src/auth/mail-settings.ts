import {z} from 'zod';
import nodemailer from 'nodemailer';
const schema=z.object({
 SMTP_HOST:z.string().trim().min(1).refine(v=>!/[\s/@]/.test(v)),
 SMTP_PORT:z.coerce.number().int().min(1).max(65535).default(587),
 SMTP_USER:z.string().min(1),SMTP_PASSWORD:z.string().min(1),
 MAIL_FROM:z.email(),MAIL_FROM_NAME:z.string().trim().max(100).default('ProfitLens'),
 MAIL_REPLY_TO:z.email().optional(),
});
export type MailSettings=z.infer<typeof schema>;
/** A port/default alone is not a configured provider. Never print credential values. */
export function readMailSettings(env:NodeJS.ProcessEnv,required=env.NODE_ENV==='production'):MailSettings|null{
 const provided=['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','MAIL_FROM'].some(k=>Boolean(env[k]));
 if(!provided&&!required)return null;
 const parsed=schema.safeParse({...env,SMTP_PORT:env.SMTP_PORT||undefined,MAIL_REPLY_TO:env.MAIL_REPLY_TO||undefined,MAIL_FROM_NAME:env.MAIL_FROM_NAME||undefined});
 if(!parsed.success)throw new Error(`Invalid email configuration: ${[...new Set(parsed.error.issues.map(i=>i.path.join('.')))].join(', ')}`);
 return parsed.data;
}
export function emailConfigured(env:NodeJS.ProcessEnv){try{return !!readMailSettings(env,false);}catch{return false;}}
export function createMailTransport(smtp:MailSettings){
 return nodemailer.createTransport({host:smtp.SMTP_HOST,port:smtp.SMTP_PORT,secure:smtp.SMTP_PORT===465,requireTLS:true,
  auth:{user:smtp.SMTP_USER,pass:smtp.SMTP_PASSWORD},connectionTimeout:10000,socketTimeout:30000,greetingTimeout:10000,
  tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},disableFileAccess:true,disableUrlAccess:true});
}
