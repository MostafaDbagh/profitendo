import {reportRecipient} from '../reports/delivery-access.js';
import {billingState} from '../billing/entitlements.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AuthSettings } from './settings.js';
import { decrypt } from './crypto.js';
export type MailPayload = { to: string; subject: string; text: string; verificationId?:string };
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
      if(payload.verificationId){
        const verification=await db.verificationChallenge.findUnique({where:{id:payload.verificationId},include:{user:true}});
        if(!verification||verification.usedAt||verification.expiresAt<=new Date()||verification.user.disabledAt||verification.user.emailVerifiedAt){await db.authMail.update({where:{id:row.id},data:{payload:'',attempts:8}});continue;}
      }
      if(row.reportId){
        const allowed=await db.$transaction(async tx=>{
          const report=await tx.reportDelivery.findUnique({where:{id:row.reportId!}});
          if(!report||report.cancelledAt)return false;
          const member=await reportRecipient(tx,report.businessId,report.userId,report.reportTypes,report.locationId);
          const preference=report.automatic?await tx.reportPreference.findUnique({where:{businessId_userId:{businessId:report.businessId,userId:report.userId}}}):null;
          return !!member&&member.user.email===payload.to&&(!report.automatic||!!preference?.enabled)&&(await billingState(tx,report.businessId)).active;
        });
        if(!allowed){await db.$transaction(async tx=>{await tx.reportDelivery.update({where:{id:row.reportId!},data:{cancelledAt:new Date()}});await tx.authMail.update({where:{id:row.id},data:{payload:'',attempts:8}});});continue;}
      }
      await send({to:payload.to,subject:payload.subject,text:payload.text});
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
