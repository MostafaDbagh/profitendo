import {randomUUID} from 'node:crypto';
import type {AuthService,Tx} from './service.js';
import {encrypt} from './crypto.js';
export async function queueWelcome(auth:AuthService,tx:Tx,userId:string){
 const policy=await auth.policy(tx);
 if(!policy.welcomeEnabled)return;
 const user=await tx.authUser.findUniqueOrThrow({where:{id:userId}});
 if(user.welcomeQueuedAt||!user.emailVerifiedAt||user.disabledAt)return;
 const owner=await tx.membership.findFirst({where:{userId,role:'OWNER',disabledAt:null},include:{business:true}});
 if(owner&&policy.ownerPhoneRequired&&!user.phoneVerifiedAt)return;
 const reserved=await tx.authUser.updateMany({where:{id:userId,welcomeQueuedAt:null},data:{welcomeQueuedAt:new Date()}});if(!reserved.count)return;
 const ar=user.language==='ar',subject=ar?'أهلاً بك في ProfitLens':'Welcome to ProfitLens';
 const steps=owner?(ar?'ابدأ بتفعيل الفترة التجريبية أو الاشتراك، ثم أضف متجرك أو مستودعك والمنتجات وفريق العمل.':'Start your trial or subscription, then add your shop or warehouse, products and team.'):(ar?'تم تجهيز حسابك. سجّل الدخول للوصول إلى الأنشطة التي تمت دعوتك إليها.':'Your account is ready. Sign in to access the businesses you have been invited to.');
 const text=`${subject}\n\n${user.name}\n${owner?.business.name??''}\n\n${steps}\n\n${auth.settings.appOrigin}/auth-v2\n\n${ar?'يمكنك تفعيل تطبيق المصادقة من أمان الحساب لحماية إضافية.':'You can enable an authenticator app in Account security for extra protection.'}`;
 const id=randomUUID();await tx.authMail.create({data:{id,payload:encrypt(auth.settings.key,JSON.stringify({to:user.email,subject,text,kind:'WELCOME'}),`mail:${id}`)}});
}
