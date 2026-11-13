import {z} from 'zod';
import type {PrismaClient} from '../generated/prisma/client.js';
import type {Tx} from './service.js';
import type {AuthSettings} from './settings.js';
export const policyKey='auth.onboarding-policy';
export const policySchema=z.object({revision:z.number().int().nonnegative(),emailRequired:z.boolean(),ownerPhoneRequired:z.boolean(),welcomeEnabled:z.boolean()}).strict();
export async function onboardingPolicy(db:Tx|PrismaClient,settings:AuthSettings){
 const row=await db.systemMetadata.findUnique({where:{key:policyKey}});
 return row?policySchema.parse(JSON.parse(row.value)):{revision:0,emailRequired:settings.emailRequired,ownerPhoneRequired:settings.ownerPhoneRequired,welcomeEnabled:settings.welcomeEnabled};
}
