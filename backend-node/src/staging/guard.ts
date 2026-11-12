import type { PrismaClient } from '../generated/prisma/client.js';
export const MOCK_SCOPE='staging-demo-v1';
export const MOCK_MARKER='staging-demo-v1';
export function stagingTarget(env:NodeJS.ProcessEnv){
 if(!['staging','preprod'].includes(env.APP_ENV??'')||env.MOCK_DATA_ENABLED!=='true')throw new Error('Mock data requires APP_ENV=staging or preprod and MOCK_DATA_ENABLED=true');
 let url:URL;try{url=new URL(env.DATABASE_URL??'');}catch{throw new Error('A dedicated staging database is required');}
 const name=decodeURIComponent(url.pathname.slice(1));
 if(!['postgres:','postgresql:'].includes(url.protocol)||!name.endsWith(env.APP_ENV==='staging'?'_staging':'_preprod')||[name,url.hostname].some(v=>/(^|[._-])(prod|production)([._-]|$)/i.test(v)))throw new Error('Database name must match the staging/preprod environment; production targets are forbidden');
 if(env.B2B_PAYPAL_MODE==='live'||env.B2B_CHECKOUT_ENABLED==='true'||env.B2B_PAYPAL_CLIENT_ID||env.B2B_PAYPAL_CLIENT_SECRET||env.B2B_PAYPAL_WEBHOOK_ID)throw new Error('Mock dataset requires disabled checkout and no payment-provider credentials');
 return name;
}
export async function checkSeedEnvironment(db:PrismaClient,env:NodeJS.ProcessEnv){
 if(env.MOCK_DATA_ENABLED==='true')stagingTarget(env);
 if(await db.systemMetadata.findUnique({where:{key:MOCK_MARKER}}))stagingTarget(env);
}
