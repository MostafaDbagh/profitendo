import {randomInt,randomUUID,createHmac} from 'node:crypto';
import type {AuthService,AuthContext} from './service.js';
import {digest,encrypt,decrypt,randomToken,equal} from './crypto.js';
import {ApiError} from '../errors.js';
import {emailConfigured} from './mail-settings.js';
import {normalizeSyrianMobile,smsConfigured} from './sms-settings.js';
import {queueWelcome} from './welcome.js';
const invalid=()=>new ApiError(400,'INVALID_OTP','The code is incorrect or expired');
export class ContactVerification{
 constructor(readonly auth:AuthService){}
 private codeHash(token:string,code:string){return createHmac('sha256',this.auth.settings.key).update(`verify:${token}:${code}`).digest('hex');}
 async requestEmail(email:string){
  if(!this.auth.settings.mockOtp&&!emailConfigured(process.env))throw new ApiError(503,'EMAIL_UNAVAILABLE','Email verification is not configured');
  const user=await this.auth.db.authUser.findUnique({where:{email}});
  if(!user||user.disabledAt||user.emailVerifiedAt)return {challenge:randomToken(),expiresIn:300};
  return this.issue(user.id,'EMAIL',email);
 }
 async requestPhone(ctx:AuthContext,raw:string){
  if(ctx.mfaRequired&&!ctx.session.mfaVerified)throw new ApiError(403,'MFA_REQUIRED','Complete MFA first');
  const phone=normalizeSyrianMobile(raw);if(!phone)throw new ApiError(422,'INVALID_PHONE','Enter a Syrian mobile number');
  if(!this.auth.settings.mockOtp&&!smsConfigured(process.env))throw new ApiError(503,'SMS_UNAVAILABLE','Phone verification is not configured');
  await this.auth.limit('phone-number-day',phone,5,86400);await this.auth.limit('phone-owner-day',ctx.user.id,5,86400);await this.auth.limit('phone-owner-minute',ctx.user.id,1,60);
  return this.issue(ctx.user.id,'PHONE',phone,ctx);
 }
 private async issue(userId:string,channel:'EMAIL'|'PHONE',destination:string,ctx?:AuthContext){
  const token=randomToken(),code=this.auth.settings.mockOtp?'123456':String(randomInt(0,1000000)).padStart(6,'0');
  await this.auth.transaction(async tx=>{
   const user=ctx?(await this.auth.assertSession(tx,ctx)).user:await this.auth.lockUser(tx,userId);
   if(channel==='EMAIL'&&(user.email!==destination||user.emailVerifiedAt))return;
   if(channel==='PHONE'&&user.phoneVerifiedAt)throw new ApiError(409,'PHONE_ALREADY_VERIFIED','Phone is already verified');
   await tx.verificationChallenge.updateMany({where:{userId,channel,usedAt:null},data:{usedAt:new Date()}});
   const id=randomUUID();await tx.verificationChallenge.create({data:{id,userId,channel,tokenHash:digest(token),destination:encrypt(this.auth.settings.key,destination,`contact:${id}`),codeHash:this.codeHash(token,code),expiresAt:new Date(Date.now()+300000)}});
   if(!this.auth.settings.mockOtp){
    const messageId=randomUUID();
    if(channel==='EMAIL'){
     const ar=user.language==='ar',subject=ar?'رمز التحقق من بريدك في ProfitLens':'Your ProfitLens email verification code';
     await tx.authMail.create({data:{id:messageId,payload:encrypt(this.auth.settings.key,JSON.stringify({verificationId:id,to:destination,subject,text:`${subject}\n\n${code}\n\n${ar?'صالح لمدة 5 دقائق. لا تشارك الرمز مع أي شخص.':'Valid for 5 minutes. Do not share this code.'}`}),`mail:${messageId}`)}});
    }else await tx.smsOutbox.create({data:{id:messageId,challengeId:id,payload:encrypt(this.auth.settings.key,JSON.stringify({phone:destination,code,name:user.name}),`sms:${messageId}`)}});
   }
   await this.auth.audit(tx,`${channel.toLowerCase()}_code.requested`,userId);
  });return {challenge:token,expiresIn:300};
 }
 async confirm(token:string,code:string,channel:'EMAIL'|'PHONE',ctx?:AuthContext){
  if(channel==='PHONE'&&(!ctx||(ctx.mfaRequired&&!ctx.session.mfaVerified)))throw invalid();
  const outcome=await this.auth.transaction(async tx=>{
   const found=await tx.verificationChallenge.findUnique({where:{tokenHash:digest(token)}});
   if(!found||found.channel!==channel||(ctx&&found.userId!==ctx.user.id))return false;
   const user=ctx?(await this.auth.assertSession(tx,ctx)).user:await this.auth.lockUser(tx,found.userId);
   const row=await tx.verificationChallenge.findUniqueOrThrow({where:{id:found.id}});
   if(row.usedAt||row.expiresAt<=new Date()||row.attempts>=5)return false;
   if(!equal(row.codeHash,this.codeHash(token,code))){await tx.verificationChallenge.update({where:{id:row.id},data:{attempts:{increment:1},...(row.attempts>=4?{usedAt:new Date()}: {})}});return false;}
   const destination=decrypt(this.auth.settings.key,row.destination,`contact:${row.id}`);
   if(channel==='EMAIL'&&(user.email!==destination||user.emailVerifiedAt))return false;
   if(channel==='PHONE'){
    if(user.phoneVerifiedAt)return false;
    const taken=await tx.authUser.findUnique({where:{phone:destination}});if(taken&&taken.id!==user.id)return false;
   }
   await tx.verificationChallenge.update({where:{id:row.id},data:{usedAt:new Date()}});
   await tx.authUser.update({where:{id:user.id},data:channel==='EMAIL'?{emailVerifiedAt:new Date()}:{phone:destination,phoneVerifiedAt:new Date()}});
   if(channel==='EMAIL')await tx.authToken.updateMany({where:{userId:user.id,kind:'VERIFY_EMAIL',usedAt:null},data:{usedAt:new Date()}});
   await queueWelcome(this.auth,tx,user.id);await this.auth.audit(tx,`${channel.toLowerCase()}.verified`,user.id);return true;
  }).catch(e=>{if(e.code==='P2002')return false;throw e;});
  if(!outcome)throw invalid();return {verified:true};
 }
}
