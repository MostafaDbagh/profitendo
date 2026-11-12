import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '../generated/prisma/client.js';
import {passwordHash} from '../auth/crypto.js';
import {MOCK_MARKER,MOCK_SCOPE,stagingTarget} from './guard.js';
export async function seedStaging(db:PrismaClient,env:NodeJS.ProcessEnv){
 const name=stagingTarget(env);
 if(env.SEED_CONFIRM!==name)throw new Error('SEED_CONFIRM must exactly match the staging database name');
 if(!env.SEED_PASSWORD||env.SEED_PASSWORD.length<20||env.SEED_PASSWORD.length>128)throw new Error('Set SEED_PASSWORD to a private 20–128 character password');
 const hash=await passwordHash(env.SEED_PASSWORD),now=new Date(),day=86400000;
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(87234901)`;
  const old=await tx.systemMetadata.findUnique({where:{key:MOCK_MARKER}});if(old)return {created:false,...JSON.parse(old.value)};
  if(await tx.authUser.count()||await tx.business.count()||await tx.billingCheckout.count()||await tx.supportTicket.count())throw new Error('Seed only an empty staging database; existing customer data will not be changed');
  const accounts:{email:string;role:string}[]=[];
  async function user(tag:string,role:'USER'|'SUPER_ADMIN'='USER'){
   const email=`${tag}@demo.example.test`;const row=await tx.authUser.create({data:{email,name:`DEMO ${tag}`,passwordHash:hash,platformRole:role,emailVerifiedAt:now}});accounts.push({email,role});return row;
  }
  const admin=await user('admin','SUPER_ADMIN');
  const trial=await tx.billingPlan.create({data:{code:'demo-trial',name:'DEMO · 14-day trial',nameAr:'تجريبي · تجربة 14 يوماً',priceMinor:null,currency:'USD',interval:'MONTH',trialDays:14,maxMembers:10,maxWarehouses:2,maxShops:3,published:true}});
  const monthly=await tx.billingPlan.create({data:{code:'demo-monthly',name:'DEMO · Monthly',nameAr:'تجريبي · شهري',priceMinor:2900,currency:'USD',interval:'MONTH',trialDays:0,maxMembers:15,maxWarehouses:3,maxShops:5,published:true}});
  const annual=await tx.billingPlan.create({data:{code:'demo-yearly',name:'DEMO · Annual',nameAr:'تجريبي · سنوي',priceMinor:24900,currency:'EUR',interval:'YEAR',trialDays:0,maxMembers:40,maxWarehouses:8,maxShops:12,published:true}});
  await tx.billingPlan.create({data:{code:'demo-draft',name:'DEMO · Editable draft',nameAr:'تجريبي · مسودة قابلة للتعديل',priceMinor:4900,currency:'USD',interval:'MONTH',trialDays:0,maxMembers:20,maxWarehouses:4,maxShops:6}});
  for(const [index,state] of ['trial','pending','approved','rejected','paid','expired','cancelled','suspended'].entries()){
   const owner=await user('owner-'+state),b=await tx.business.create({data:{name:`DEMO · ${state} business`,timezone:'Asia/Dubai',suspendedAt:state==='suspended'?now:null}});
   await tx.membership.create({data:{businessId:b.id,userId:owner.id,role:'OWNER'}});
   const warehouse=await tx.location.create({data:{businessId:b.id,code:'WH-01',name:'DEMO Main warehouse',kind:'WAREHOUSE',address:'Staging sample address'}});
   const shop=await tx.location.create({data:{businessId:b.id,code:'SHOP-01',name:'DEMO Retail shop',kind:'SHOP',address:'Staging sample address'}});
   if(state==='trial')for(const role of ['OPERATIONS_MANAGER','WAREHOUSE_STAFF','SHOP_MANAGER','CASHIER','VIEWER'] as const){
    const u=await user(role.toLowerCase());accounts[accounts.length-1]!.role=role;
    const m=await tx.membership.create({data:{businessId:b.id,userId:u.id,role}});
    if(['WAREHOUSE_STAFF','SHOP_MANAGER','CASHIER'].includes(role))await tx.locationAssignment.create({data:{businessId:b.id,membershipId:m.id,locationId:role==='WAREHOUSE_STAFF'?warehouse.id:shop.id}});
   }
   await tx.businessSubscription.create({data:{businessId:b.id,planId:trial.id,trialStartedAt:new Date(now.getTime()-(state==='expired'?30:3)*day),trialEndsAt:new Date(now.getTime()+(state==='expired'?-16:11)*day)}});
   const paidPlan=index%2?annual:monthly;
   if(state!=='trial'){
    const status=state==='pending'?'PENDING':state==='rejected'?'REJECTED':'APPROVED';
    const reason=status==='REJECTED'?'DEMO: Please complete the business information.':status==='APPROVED'?'DEMO: Business details reviewed.':'';
    await tx.paidApproval.create({data:{businessId:b.id,planId:paidPlan.id,requestedBy:owner.id,status,reason,...(status!=='PENDING'?{decidedBy:admin.id,decidedAt:now}:{})}});
    await tx.billingAudit.create({data:{actorId:status==='PENDING'?owner.id:admin.id,businessId:b.id,planId:paidPlan.id,action:status==='PENDING'?'approval.requested':`approval.${status.toLowerCase()}`,changes:{reason}}});
   }
   if(['paid','expired','cancelled','suspended'].includes(state)){
    const end=new Date(now.getTime()+(state==='expired'?-1:20)*day),from=new Date(now.getTime()-10*day);
    const checkout=await tx.billingCheckout.create({data:{businessId:b.id,planId:paidPlan.id,scope:MOCK_SCOPE,providerPlanId:'DEMO-NOT-A-PROVIDER-PLAN',providerStatus:state==='cancelled'?'CANCELLED':'ACTIVE',paidFrom:from,paidUntil:end,paidTransaction:`DEMO-${state}`,nextBillingAt:state==='cancelled'?null:end,reconciledAt:now}});
    for(let month=0;month<3;month++){
     const paidAt=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-month*(paidPlan.interval==='YEAR'?12:1),1,12));
     await tx.billingReceipt.create({data:{checkoutId:checkout.id,scope:MOCK_SCOPE,transactionId:`DEMO-${state}-${month}`,eventId:`DEMO-${randomUUID()}`,amountMinor:paidPlan.priceMinor!,currency:paidPlan.currency,paidAt}});
    }
   }
   const status=['NEW','IN_PROGRESS','RESOLVED'][index%3]!;
   const ticket=await tx.supportTicket.create({data:{userId:owner.id,businessId:b.id,name:owner.name,email:owner.email,subject:`DEMO · ${state} subscription question`,category:['SUBSCRIPTION','BILLING','TECHNICAL','GENERAL'][index%4]!,status,messages:{create:{authorId:owner.id,body:'DEMO: Can you help us test our subscription and warehouse setup?'}}}});
   if(status!=='NEW')await tx.supportMessage.create({data:{ticketId:ticket.id,authorId:admin.id,fromAdmin:true,body:'DEMO: We reviewed your request. This is a staging-only reply.'}});
  }
  await tx.supportTicket.create({data:{name:'DEMO Visitor',email:'visitor@demo.example.test',subject:'DEMO public contact enquiry',category:'GENERAL',messages:{create:{body:'DEMO: I would like to try the system.'}}}});
  const result={accounts,businesses:8,plans:4,receipts:12,tickets:9,createdAt:now.toISOString()};
  await tx.systemMetadata.create({data:{key:MOCK_MARKER,value:JSON.stringify(result)}});
  return {created:true,...result};
 },{isolationLevel:'Serializable',timeout:30000});
}
