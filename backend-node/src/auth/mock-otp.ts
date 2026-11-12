import { z } from 'zod';
import type { AuthService } from './service.js';
import { digest, randomToken } from './crypto.js';
import { ApiError } from '../errors.js';
export const otpCode=z.string().length(6).regex(/^[0-9]{6}$/);
export const otpPurpose=z.enum(['VERIFY_EMAIL','PASSWORD_RESET']);
type Purpose=z.infer<typeof otpPurpose>;
const hash=(challenge:string,purpose:Purpose)=>digest(`local-email-otp:${purpose}:${challenge}:123456`);
const invalid=()=>new ApiError(400,'INVALID_OTP','The code is incorrect or expired');
export class MockEmailOtp {
 constructor(readonly auth:AuthService){}
 enabled(){if(!this.auth.settings.mockOtp)throw new ApiError(404,'NOT_FOUND','Route not available');}
 async request(email:string,purpose:Purpose){
  this.enabled();const challenge=randomToken();
  await this.auth.transaction(async tx=>{
   const user=await tx.authUser.findUnique({where:{email}});
   if(!user||user.disabledAt||(purpose==='VERIFY_EMAIL'&&user.emailVerifiedAt))return;
   await this.auth.lockUser(tx,user.id);
   await tx.authToken.updateMany({where:{userId:user.id,kind:purpose,usedAt:null},data:{usedAt:new Date()}});
   await tx.authToken.create({data:{userId:user.id,kind:purpose,tokenHash:hash(challenge,purpose),expiresAt:new Date(Date.now()+10*60000)}});
   await this.auth.audit(tx,'mock_email_otp.requested',user.id);
  });
  // Same shape for unknown/disabled/verified accounts. No actual mail is queued.
  return {challenge,expiresIn:600};
 }
 async confirm(challenge:string,purpose:Purpose,code:string){
  this.enabled();if(!otpCode.safeParse(code).success||code!=='123456')throw invalid();
  return this.auth.transaction(async tx=>{
   const row=await tx.authToken.findUnique({where:{tokenHash:hash(challenge,purpose)}});
   if(!row||row.kind!==purpose||row.usedAt||row.expiresAt<=new Date())throw invalid();
   await this.auth.lockUser(tx,row.userId);
   const user=await tx.authUser.findUnique({where:{id:row.userId}});
   if(!user||user.disabledAt)throw invalid();
   const used=await tx.authToken.updateMany({where:{id:row.id,usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
   if(!used.count)throw invalid();
   if(purpose==='VERIFY_EMAIL'){
    await tx.authUser.update({where:{id:row.userId},data:{emailVerifiedAt:new Date()}});
    await this.auth.audit(tx,'mock_email_otp.verified',row.userId);return {verified:true};
   }
   const resetToken=randomToken();
   await tx.authToken.create({data:{userId:row.userId,kind:'PASSWORD_RESET',tokenHash:digest(resetToken),expiresAt:new Date(Date.now()+10*60000)}});
   await this.auth.audit(tx,'mock_email_otp.reset_authorized',row.userId);
   return {resetToken};
  });
 }
}
