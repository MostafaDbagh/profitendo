import type {PrismaClient} from '../generated/prisma/client.js';
import type {AuthSettings} from './settings.js';
import {decrypt} from './crypto.js';
export type SmsPayload={phone:string;code:string;name:string};
export async function deliverSmsBatch(db:PrismaClient,settings:AuthSettings,send:(payload:SmsPayload)=>Promise<void>,limit=20){
 let accepted=0,failed=0;
 for(let i=0;i<limit;i++){
  const row=await db.$transaction(async tx=>{
   const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM sms_outbox WHERE delivered_at IS NULL AND attempts<3 AND available_at<=now() ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1`;
   if(!rows[0])return null;return tx.smsOutbox.update({where:{id:rows[0].id},data:{attempts:{increment:1},availableAt:new Date(Date.now()+60000)},include:{challenge:{include:{user:true}}}});
  });if(!row)break;
  const c=row.challenge;
  if(c.usedAt||c.expiresAt<=new Date()||c.user.disabledAt||c.user.phoneVerifiedAt){await db.smsOutbox.update({where:{id:row.id},data:{payload:'',attempts:3}});continue;}
  try{await send(JSON.parse(decrypt(settings.key,row.payload,`sms:${row.id}`)));await db.smsOutbox.update({where:{id:row.id},data:{deliveredAt:new Date(),payload:''}});accepted++;}
  catch{failed++;await db.smsOutbox.update({where:{id:row.id},data:{availableAt:new Date(Date.now()+30000)}});}
 }return {accepted,failed};
}
