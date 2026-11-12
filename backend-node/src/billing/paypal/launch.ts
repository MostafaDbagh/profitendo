import { z } from 'zod';
import { providerPlanId } from './contracts.js';
export function checkoutConfiguration(env:NodeJS.ProcessEnv=process.env){
 const enabled=env.B2B_CHECKOUT_ENABLED==='true';
 const bindings=z.record(z.string(),providerPlanId).parse(JSON.parse(env.B2B_PAYPAL_PLAN_BINDINGS||'{}'));
 if(enabled&&(!Object.keys(bindings).length||env.B2B_PRICING_APPROVED!=='true'||env.B2B_SANDBOX_VERIFIED!=='true'))throw new Error('Checkout requires approved pricing, verified sandbox and plan bindings');
 return {enabled,bindings};
}
