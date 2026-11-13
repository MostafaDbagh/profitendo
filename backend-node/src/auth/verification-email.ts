export function verificationEmail(language: string, code: string) {
  if (language === 'ar') return {
    subject: 'أكّد بريدك الإلكتروني لإكمال إنشاء حساب ProfitLens',
    text: `مرحباً بك في ProfitLens،\n\nلإكمال إنشاء حساب نشاطك التجاري وإدارة متاجرك ومستودعاتك ومنتجاتك وفريقك، أدخل رمز التحقق التالي في صفحة التحقق من البريد الإلكتروني:\n\n${code}\n\nتنتهي صلاحية الرمز خلال 5 دقائق، ويمكن استخدامه مرة واحدة فقط.\nلا تشارك الرمز مع أي شخص؛ لن يطلبه منك فريق ProfitLens.\n\nبعد التحقق، تابع الخطوات الظاهرة في التطبيق للوصول إلى لوحة التحكم.\nإذا لم تطلب إنشاء هذا الحساب، يمكنك تجاهل هذه الرسالة.\n\nهذه رسالة آلية من ProfitLens. يُرجى عدم الرد عليها.`,
  };
  return {
    subject: 'Verify your email to finish creating your ProfitLens account',
    text: `Welcome to ProfitLens,\n\nTo finish setting up your business account and manage your stores, warehouses, products and team, enter this verification code on the email verification screen:\n\n${code}\n\nThis code expires in 5 minutes and can only be used once.\nKeep it private. The ProfitLens team will never ask you to share this code.\n\nAfter verification, follow any remaining steps in the app to reach your dashboard.\nIf you did not request this account, you can ignore this email.\n\nThis is an automated message from ProfitLens. Please do not reply.`,
  };
}
