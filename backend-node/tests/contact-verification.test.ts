import {randomBytes,randomUUID,randomInt} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
import request from 'supertest';
import {pino} from 'pino';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/app.js';
import {AuthService,type AuthContext} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {csrfFor,decrypt,digest,encrypt} from '../src/auth/crypto.js';
import {deliverSmsBatch} from '../src/auth/sms.js';
import {deliverMailBatch} from '../src/auth/mail.js';
const url=process.env.TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Test database required');
const settings=readAuthSettings({AUTH_EMAIL_REQUIRED:'true', AUTH_WELCOME_EMAIL_ENABLED:'true', AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://localhost:3000',AUTH_OWNER_PHONE_REQUIRED:'true',AUTH_EMAIL_VERIFICATION:'otp'}),db=createDatabase(url),auth=new AuthService(db,settings),app=createApp({CORS_ORIGINS:[settings.appOrigin]},pino({level:'silent'}),async()=>{},auth),emails:string[]=[],password='Contact verification password 741!';
app.set('trust proxy',true); // Test-only isolated rate-limit identity.
let testIp='198.18.0.1';beforeEach(()=>{testIp=`198.18.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*254)+1}`;});
const phoneBase=randomInt(10000000,99999990),mobile=(n:number)=>`09${phoneBase+n}`;
const post=(path:string,body:object,ctx?:AuthContext)=>{const r=request(app).post('/api/auth'+path).set('Origin',settings.appOrigin).set('X-Forwarded-For',testIp);if(ctx)r.set('Cookie',`pl_session=${ctx.token}`).set('X-CSRF-Token',csrfFor(settings.key,ctx.token));return r.send(body);};
async function mails(email:string){const result=[];for(const row of await db.authMail.findMany({where:{payload:{not:''}}})){try{const payload=JSON.parse(decrypt(settings.key,row.payload,`mail:${row.id}`));if(payload.to===email)result.push({row,payload});}catch{}}return result;}
async function register(){const email=`contact-${randomUUID()}@example.test`;emails.push(email);expect((await post('/register',{email,password,name:'Owner tester',businessName:'Verified business',language:'ar'})).status).toBe(202);return email;}
async function emailCode(email:string){const r=await post('/email-code/request',{email});expect(r.status,r.text).toBe(202);const challenge=await db.verificationChallenge.findUniqueOrThrow({where:{tokenHash:digest(r.body.challenge)}});const message=(await mails(email)).find(m=>m.payload.verificationId===challenge.id)!;return {challenge:r.body.challenge,code:message.payload.text.match(/\b\d{6}\b/)[0],id:challenge.id};}
async function verifiedEmail(){const email=await register(),code=await emailCode(email);expect((await post('/email-code/confirm',codeBody(code))).status).toBe(200);return {email,ctx:await auth.login(email,password)};}
const codeBody=(c:{challenge:string;code:string})=>({challenge:c.challenge,code:c.code});
async function phoneCode(ctx:AuthContext,phone:string){const r=await post('/phone-code/request',{phone},ctx);expect(r.status,r.text).toBe(202);const row=await db.smsOutbox.findFirstOrThrow({where:{challenge:{tokenHash:digest(r.body.challenge)}}});const payload=JSON.parse(decrypt(settings.key,row.payload,`sms:${row.id}`));return {challenge:r.body.challenge,code:payload.code,id:row.id};}
beforeAll(()=>{for(const [k,v] of Object.entries({SMTP_HOST:'smtp.example.test',SMTP_PORT:'587',SMTP_USER:'test',SMTP_PASSWORD:'test',MAIL_FROM:'test@example.test',MSGPLUS_API_KEY:'test',MSGPLUS_SENDER_NAME:'ProfitLens',MSGPLUS_TEMPLATE_ID:'1'}))vi.stubEnv(k,v);});
afterAll(async()=>{
 for(const email of emails)for(const m of await mails(email))await db.authMail.delete({where:{id:m.row.id}});
 const users=await db.authUser.findMany({where:{email:{in:emails}}}),ids=users.map(u=>u.id),members=await db.membership.findMany({where:{userId:{in:ids}}});
 await db.authAudit.deleteMany({where:{userId:{in:ids}}});await db.business.deleteMany({where:{id:{in:members.map(m=>m.businessId)}}});await db.authUser.deleteMany({where:{id:{in:ids}}});await db.$disconnect();vi.unstubAllEnvs();
});
it('requires email then Syrian phone, welcomes once, and leaves owner MFA optional',async()=>{
 const email=await register();expect((await post('/login',{email,password})).body.error.code).toBe('EMAIL_UNVERIFIED');const code=await emailCode(email);expect((await post('/email-code/confirm',codeBody(code))).status).toBe(200);expect((await post('/email-code/confirm',codeBody(code))).status).toBe(400);
 const ctx=await auth.login(email,password);expect(auth.stage(ctx)).toBe('phone_verification_required');expect((await mails(email)).filter(m=>m.payload.subject.includes('أهلاً')).length).toBe(0);
 expect((await request(app).get('/api/businesses').set('Cookie',`pl_session=${ctx.token}`)).status).toBe(403);
 expect((await post('/phone-code/request',{phone:'+012345678'},ctx)).status).toBe(422);
 expect((await request(app).post('/api/auth/phone-code/request').set('Origin',settings.appOrigin).set('Cookie',`pl_session=${ctx.token}`).send({phone:mobile(1)})).status).toBe(403);
 const phone=await phoneCode(ctx,mobile(1)),results=await Promise.all([post('/phone-code/confirm',codeBody(phone),ctx),post('/phone-code/confirm',codeBody(phone),ctx)]);expect(results.map(r=>r.status).sort()).toEqual([200,400]);expect(results.find(r=>r.status===200)!.body).toMatchObject({stage:'authenticated',mfaEnabled:false,mfaMandatory:false});
 const current=await auth.authenticate(ctx.token);expect((await request(app).get('/api/businesses').set('Cookie',`pl_session=${current.token}`)).status).toBe(200);const member=await db.membership.findFirstOrThrow({where:{userId:ctx.user.id}});expect((await request(app).get(`/api/billing/businesses/${member.businessId}`).set('Cookie',`pl_session=${ctx.token}`)).status).toBe(200);
 expect((await mails(email)).filter(m=>m.payload.subject.includes('أهلاً')).length).toBe(1);expect((await db.authUser.findUniqueOrThrow({where:{email}})).phone).toBe('+963'+mobile(1).slice(1));
});
it('limits guesses durably and invalidates superseded/expired email codes',async()=>{
 const email=await register(),a=await emailCode(email),b=await emailCode(email);expect((await post('/email-code/confirm',codeBody(a))).status).toBe(400);
 const wrong=b.code==='000000'?'000001':'000000';for(let i=0;i<5;i++)expect((await post('/email-code/confirm',{challenge:b.challenge,code:wrong})).status).toBe(400);
 expect((await db.verificationChallenge.findUniqueOrThrow({where:{id:b.id}})).attempts).toBe(5);expect((await post('/email-code/confirm',codeBody(b))).status).toBe(400);
 const c=await emailCode(email);await db.verificationChallenge.update({where:{id:c.id},data:{expiresAt:new Date(0)}});expect((await post('/email-code/confirm',codeBody(c))).status).toBe(400);expect((await post('/email-code/request',{email})).status).toBe(429);
});
it('protects phone codes from other sessions and duplicate verified-number claims',async()=>{
 const a=await verifiedEmail(),b=await verifiedEmail(),phone=await phoneCode(a.ctx,mobile(2));expect((await post('/phone-code/confirm',codeBody(phone),b.ctx)).status).toBe(400);expect((await post('/phone-code/confirm',codeBody(phone),a.ctx)).status).toBe(200);
 const duplicate=await phoneCode(b.ctx,mobile(2));expect((await post('/phone-code/confirm',codeBody(duplicate),b.ctx)).status).toBe(400);expect((await post('/phone-code/request',{phone:mobile(3)},b.ctx)).status).toBe(429);
});
it('SMS worker captures real generated code, retries safely, and skips expired requests',async()=>{
 const a=await verifiedEmail(),phone=await phoneCode(a.ctx,mobile(4));await db.smsOutbox.update({where:{id:phone.id},data:{availableAt:new Date(0)}});
 expect((await deliverSmsBatch(db,settings,async()=>{throw new Error('provider unavailable');},1)).failed).toBe(1);expect((await db.smsOutbox.findUniqueOrThrow({where:{id:phone.id}})).deliveredAt).toBeNull();
 await db.smsOutbox.update({where:{id:phone.id},data:{availableAt:new Date(0)}});const captured:any[]=[];expect((await deliverSmsBatch(db,settings,async p=>{captured.push(p);},1)).accepted).toBe(1);expect(captured[0]).toMatchObject({phone:'+963'+mobile(4).slice(1),code:phone.code});
 const b=await verifiedEmail(),expired=await phoneCode(b.ctx,mobile(5));const row=await db.smsOutbox.findUniqueOrThrow({where:{id:expired.id}});await db.verificationChallenge.update({where:{id:row.challengeId},data:{expiresAt:new Date(0)}});await db.smsOutbox.update({where:{id:expired.id},data:{availableAt:new Date(0)}});expect((await deliverSmsBatch(db,settings,async()=>{throw new Error('must not send');},1)).accepted).toBe(0);
});
it('fails safely without configured providers and does not force platform MFA enrollment',async()=>{
 const a=await verifiedEmail();vi.stubEnv('MSGPLUS_API_KEY','');expect((await post('/phone-code/request',{phone:mobile(6)},a.ctx)).body.error.code).toBe('SMS_UNAVAILABLE');vi.stubEnv('MSGPLUS_API_KEY','test');
 const email=await register();vi.stubEnv('SMTP_HOST','');expect((await post('/email-code/request',{email})).body.error.code).toBe('EMAIL_UNAVAILABLE');vi.stubEnv('SMTP_HOST','smtp.example.test');
 await db.authUser.update({where:{id:a.ctx.user.id},data:{platformRole:'SUPER_ADMIN'}});expect(auth.stage(await auth.login(a.email,password))).toBe('phone_verification_required');
});
it('keeps registration phone encrypted, prefills only its owner, and clears it after verification',async()=>{
 const email=`contact-${randomUUID()}@example.test`;emails.push(email);
 const body={email,password,name:'Phone owner',businessName:'Phone business',phone:mobile(7)};
 expect((await post('/register',{...body,phone:'+012345678'})).status).toBe(422);
 expect((await post('/register',body)).status).toBe(202);
 const user=await db.authUser.findUniqueOrThrow({where:{email}});
 expect(user.phone).toBeNull();expect(user.phoneVerifiedAt).toBeNull();expect(user.pendingPhone).not.toContain(mobile(7));
 const code=await emailCode(email);expect((await post('/email-code/confirm',codeBody(code))).status).toBe(200);
 const ctx=await auth.login(email,password),session=await auth.sessionResult(ctx);
 expect(session.pendingPhone).toBe('+963'+mobile(7).slice(1));expect(session.user).not.toHaveProperty('phone');
 const challenge=await phoneCode(ctx,session.pendingPhone!);expect((await post('/phone-code/confirm',codeBody(challenge),ctx)).status).toBe(200);
 expect((await db.authUser.findUniqueOrThrow({where:{email}})).pendingPhone).toBeNull();
 expect(await auth.sessionResult(await auth.authenticate(ctx.token))).not.toHaveProperty('pendingPhone');
});

it('preserves an international registration number through OTP verification',async()=>{
 const email=`international-${randomUUID()}@example.test`;emails.push(email);const phone='+9715'+String(randomInt(10000000,99999999));
 expect((await post('/register',{email,password,name:'International owner',businessName:'Global shop',phone})).status).toBe(202);
 const code=await emailCode(email);expect((await post('/email-code/confirm',codeBody(code))).status).toBe(200);
 const ctx=await auth.login(email,password);expect((await auth.sessionResult(ctx)).pendingPhone).toBe(phone);
 const challenge=await phoneCode(ctx,phone);expect((await post('/phone-code/confirm',codeBody(challenge),ctx)).status).toBe(200);
 const user=await db.authUser.findUniqueOrThrow({where:{email}});expect(user.phone).toBe(phone);expect(user.phoneVerifiedAt).not.toBeNull();expect(user.pendingPhone).toBeNull();
 expect(auth.stage(await auth.login(email,password))).toBe('authenticated');
});
