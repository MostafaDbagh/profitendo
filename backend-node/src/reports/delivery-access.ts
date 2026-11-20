import {z} from 'zod';
import type {Tx} from '../auth/service.js';
import {effectivePermissions,type Permission} from '../businesses/permissions.js';
export const reportTypes=['SALES','GROSS_PROFIT','NET_PROFIT','EXPENSES','RETURNS','CASH'] as const;
export type ReportType=typeof reportTypes[number];
const grants:Record<ReportType,Permission[]>={SALES:['sales.view'],GROSS_PROFIT:['sales.view','catalogue.cost'],NET_PROFIT:['sales.view','catalogue.cost','payments.view'],EXPENSES:['payments.view'],RETURNS:['returns.view'],CASH:['cash.close','payments.view']};
export function allowedReportTypes(permissions:Record<Permission,boolean>){return reportTypes.filter(type=>grants[type].every(p=>permissions[p]));}
export async function reportRecipient(tx:Tx,businessId:string,userId:string,types:readonly string[],locationId:string|null){
 const member=await tx.membership.findUnique({where:{businessId_userId:{businessId,userId}},include:{user:true,business:true}});
 if(!member||member.disabledAt||member.user.disabledAt||!member.user.emailVerifiedAt||member.business.suspendedAt)return null;
 const p=effectivePermissions(member.role,member.permissionOverrides);
 if(!p['business.view']||!p['reports.view']||!p['reports.deliver']||!p['locations.view']||types.some(type=>!allowedReportTypes(p).includes(type as ReportType)))return null;
 if(locationId){if(!await tx.location.findFirst({where:{id:locationId,businessId,...(p['locations.all']?{}:{assignments:{some:{membershipId:member.id,businessId}}})}}))return null;}
 else if(!p['locations.all'])return null;
 return member;
}

export const partnerRecipientsSchema = z.array(z.object({
 partnerId: z.uuid(),
 email: z.string().trim().email().max(254).transform(email => email.toLowerCase()),
}).strict()).max(20).refine(rows => new Set(rows.map(row => row.partnerId)).size === rows.length);

export function partnerRecipients(value: unknown) {
 return partnerRecipientsSchema.safeParse(value).data ?? [];
}

export async function activeReportPartners(tx: Tx, businessId: string, ids?: string[]) {
 return tx.partner.findMany({
  where: {businessId, active: true, ...(ids && {id: {in: ids}})},
  select: {id: true, name: true}, orderBy: [{name: 'asc'}, {id: 'asc'}],
 });
}
