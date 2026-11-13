import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import request from 'supertest';
import {pino} from 'pino';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/app.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {policyKey} from '../src/auth/policy.js';
import {csrfFor,encrypt} from '../src/auth/crypto.js';
import {queueWelcome} from '../src/auth/welcome.js';
import {deliverMailBatch} from '../src/auth/mail.js';
it('disables onboarding messages, enforces admin policy controls and restores verification gates',async()=>{
 const url=process.env.TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('_test'))throw Error('Dedicated test database required');
 const db=createDatabase(url),settings=readAuthSettings({AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3000'}),auth=new AuthService(db,settings);
 const app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth);
 const previous=await db.systemMetadata.findUnique({where:{key:policyKey}}),ids:string[]=[],businesses:string[]=[],mails:string[]=[];
 const password='Onboarding policy test password 274!';
 try{
  await db.systemMetadata.deleteMany({where:{key:policyKey}});
  expect(await auth.policy()).toEqual({revision:0,emailRequired:false,ownerPhoneRequired:false,welcomeEnabled:false});
  for(const role of ['owner','admin']){
   const email=`policy-${role}-${randomUUID()}@example.test`;
   await auth.register({email,password,name:'Policy test',businessName:'Policy test business',phone:'+971501234567'});
   const u=await db.authUser.findUniqueOrThrow({where:{email}});ids.push(u.id);
   businesses.push((await db.membership.findFirstOrThrow({where:{userId:u.id}})).businessId);
   expect(u.emailVerifiedAt).toBeNull();expect(u.phoneVerifiedAt).toBeNull();
   expect(await db.authToken.count({where:{userId:u.id}})).toBe(0);
  }
  await db.authUser.update({where:{id:ids[1]!},data:{platformRole:'SUPER_ADMIN',emailVerifiedAt:new Date()}});
  await db.membership.deleteMany({where:{userId:ids[1]!}});
  const owner=await auth.login((await db.authUser.findUniqueOrThrow({where:{id:ids[0]!}})).email,password);
  const admin=await auth.login((await db.authUser.findUniqueOrThrow({where:{id:ids[1]!}})).email,password);
  expect(auth.stage(owner)).toBe('authenticated');expect(auth.stage(admin)).toBe('authenticated');
  const path='/api/platform/onboarding-policy';
  const patch=(body:object,ctx=admin)=>request(app).patch(path).set('Cookie',`pl_session=${ctx.token}`).set('Origin',settings.appOrigin).set('X-CSRF-Token',csrfFor(settings.key,ctx.token)).send(body);
  const initial=await auth.policy();
  expect((await request(app).get(path).set('Cookie',`pl_session=${owner.token}`)).status).toBe(403);
  expect((await patch(initial,owner)).status).toBe(403);
  expect((await request(app).patch(path).set('Cookie',`pl_session=${admin.token}`).set('Origin',settings.appOrigin).send(initial)).status).toBe(403);
  const emailOn=await patch({...initial,emailRequired:true});expect(emailOn.status).toBe(200);
  expect((await patch(initial)).status).toBe(409);
  await expect(auth.login(owner.user.email,password)).rejects.toMatchObject({code:'EMAIL_UNVERIFIED'});
  await expect(auth.authenticate(owner.token)).rejects.toMatchObject({code:'SESSION_EXPIRED'});
  const phoneOn=await patch({...emailOn.body,emailRequired:false,ownerPhoneRequired:true});expect(phoneOn.status).toBe(200);
  expect(auth.stage(await auth.authenticate(owner.token))).toBe('phone_verification_required');
  const off=await patch({...phoneOn.body,ownerPhoneRequired:false});expect(off.status).toBe(200);
  expect(auth.stage(await auth.authenticate(owner.token))).toBe('authenticated');
  await auth.transaction(tx=>queueWelcome(auth,tx,admin.user.id));
  expect((await db.authUser.findUniqueOrThrow({where:{id:admin.user.id}})).welcomeQueuedAt).toBeNull();
  // Both legacy and newly typed welcome messages must be cancelled without delivery.
  for(const subject of ['Welcome to ProfitLens','أهلاً بك في ProfitLens']){
   const id=randomUUID();mails.push(id);await db.authMail.create({data:{id,createdAt:new Date(0),payload:encrypt(settings.key,JSON.stringify({to:admin.user.email,subject,text:'Welcome'}),`mail:${id}`)}});
  }
  let sent=0;await deliverMailBatch(db,settings,async()=>{sent++;},2);expect(sent).toBe(0);
  for(const id of mails)expect(await db.authMail.findUnique({where:{id}})).toMatchObject({attempts:8,payload:'',deliveredAt:null});
  const on=await patch({...off.body,welcomeEnabled:true});expect(on.status).toBe(200);
  await auth.transaction(tx=>queueWelcome(auth,tx,admin.user.id));
  expect((await db.authUser.findUniqueOrThrow({where:{id:admin.user.id}})).welcomeQueuedAt).not.toBeNull();
  const queued=await db.authMail.findMany({where:{deliveredAt:null,attempts:0}});
  // Only collect messages encrypted with this isolated test's key.
  const {decrypt}=await import('../src/auth/crypto.js');
  for(const row of queued){try{if(JSON.parse(decrypt(settings.key,row.payload,`mail:${row.id}`)).to===admin.user.email)mails.push(row.id);}catch{}}
  expect(mails.length).toBe(3);
  expect(await db.platformAudit.count({where:{actorId:admin.user.id,targetType:'onboarding-policy'}})).toBe(5);
 }finally{
  if(previous)await db.systemMetadata.upsert({where:{key:policyKey},create:previous,update:{value:previous.value}});else await db.systemMetadata.deleteMany({where:{key:policyKey}});
  await db.authMail.deleteMany({where:{id:{in:mails}}});await db.platformAudit.deleteMany({where:{actorId:{in:ids}}});await db.authAudit.deleteMany({where:{userId:{in:ids}}});await db.business.deleteMany({where:{id:{in:businesses}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.$disconnect();
 }
},30000);
