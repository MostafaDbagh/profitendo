import { it, expect } from 'vitest';
import { PayPalClient } from '../src/billing/paypal/client.js';
import { readPayPalSettings } from '../src/billing/paypal/settings.js';
import { assertBinding, assertPlanTerms, minorUnits, type SubscriptionSnapshot, type PayPalEvent } from '../src/billing/paypal/contracts.js';
const env = { B2B_PAYPAL_MODE:'sandbox', B2B_PAYPAL_CLIENT_ID:'test-client', B2B_PAYPAL_CLIENT_SECRET:'test-secret', B2B_PAYPAL_WEBHOOK_ID:'test-webhook' };
const settings=readPayPalSettings(env)!,pid=`P-${'A'.repeat(24)}`,sid='I-TEST123456',intent='8ac8ae27-f871-47f2-8d70-e38b0aed295c';
const plan={id:pid,status:'ACTIVE',quantity_supported:false,billing_cycles:[{tenure_type:'REGULAR',sequence:1,total_cycles:0,frequency:{interval_unit:'MONTH',interval_count:1},pricing_scheme:{fixed_price:{currency_code:'USD',value:'29.00'}}}],payment_preferences:{setup_fee:{value:'0.00',currency_code:'USD'}}};
const snapshot:SubscriptionSnapshot={id:sid,plan_id:pid,custom_id:intent,status:'APPROVAL_PENDING',status_update_time:'2026-11-11T12:00:00Z',quantity:'1',plan_overridden:false,links:[{rel:'approve',href:'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=EXAMPLE'}]};
const event:PayPalEvent={id:'EVENT-TEST',event_type:'BILLING.SUBSCRIPTION.CREATED',create_time:'2026-11-11T12:00:00Z',resource:{id:sid}};
const headers={'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/TEST','paypal-transmission-id':'TRANSMISSION-TEST','paypal-transmission-sig':'YWJjZA==','paypal-transmission-time':'2026-11-11T12:00:00Z'};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function mock(reply:(path:string,init:RequestInit)=>Response|Promise<Response>) {
 const calls:{url:string;init:RequestInit}[]=[];
 const transport:typeof fetch=async(input,init={})=>{const url=String(input);calls.push({url,init});return reply(new URL(url).pathname,init);};
 return {client:new PayPalClient(settings,transport),calls};
}
const token={access_token:'TEST-ACCESS-TOKEN',expires_in:3600,token_type:'Bearer'};
it('keeps B2B configuration separate and rejects partial/invalid settings without secrets',()=>{
 expect(readPayPalSettings({PAYPAL_CLIENT_ID:'legacy',PAYPAL_CLIENT_SECRET:'legacy-secret'})).toBeNull();
 expect(()=>readPayPalSettings({B2B_PAYPAL_CLIENT_SECRET:'do-not-expose'})).toThrow('Configure B2B');
 try{readPayPalSettings({...env,B2B_PAYPAL_MODE:'arbitrary-host'});}catch(e){expect(String(e)).not.toContain('test-secret');}
 expect(settings.baseUrl).toBe('https://api-m.sandbox.paypal.com');
 const live=readPayPalSettings({...env,B2B_PAYPAL_MODE:'live'})!;expect(live.scope).not.toBe(settings.scope);expect(live.baseUrl).toBe('https://api-m.paypal.com');
 expect(readPayPalSettings({...env,B2B_PAYPAL_CLIENT_SECRET:'rotated'})!.scope).toBe(settings.scope);
});
it('caches OAuth and coalesces concurrent refreshes',async()=>{
 const {client,calls}=mock(path=>response(path.includes('oauth2')?token:plan));
 await Promise.all([client.getPlan(pid),client.getPlan(pid),client.getPlan(pid)]);
 expect(calls.filter(c=>c.url.includes('oauth2'))).toHaveLength(1);
 expect(calls.every(c=>c.url.startsWith(settings.baseUrl)&&c.init.redirect==='error'&&c.init.signal)).toBe(true);
 expect(calls[0]!.init.body).toBe('grant_type=client_credentials');
});
it('uses a persistent request ID, custom checkout binding and server return URLs',async()=>{
 const {client,calls}=mock(path=>response(path.includes('oauth2')?token:path.endsWith('/subscriptions')?{id:sid}:snapshot));
 const result=await client.createSubscription(pid,intent,'https://app.example.test');
 expect(result).toEqual(snapshot);
 const call=calls.find(c=>new URL(c.url).pathname.endsWith('/subscriptions'))!;
 expect((call.init.headers as Record<string,string>)['PayPal-Request-Id']).toBe(intent);
 expect(JSON.parse(String(call.init.body))).toMatchObject({custom_id:intent,plan_id:pid,quantity:'1',application_context:{return_url:'https://app.example.test/business-v2?billing=return',cancel_url:'https://app.example.test/business-v2?billing=cancel',shipping_preference:'NO_SHIPPING'}});
 expect(calls.some(c=>c.url.endsWith(sid))).toBe(true);
});
it('rejects unsafe identifiers before sending requests',async()=>{
 const {client,calls}=mock(()=>response(token));
 await expect(client.getSubscription('../oauth2/token')).rejects.toThrow();await expect(client.getPlan('https://attacker.test')).rejects.toThrow();expect(calls).toHaveLength(0);
});
it('sanitizes upstream failures and malformed or oversized responses',async()=>{
 for(const reply of [()=>response({private:'SECRET-PROVIDER-DETAIL'},500),()=>new Response('not JSON'),()=>response({payload:'x'.repeat(1024*1024+1)})]){
  const {client}=mock(reply);await expect(client.getPlan(pid)).rejects.toMatchObject({code:'PAYMENT_PROVIDER_UNAVAILABLE'});
  try{await client.getPlan(pid);}catch(e){expect(String(e)).not.toContain('SECRET-PROVIDER-DETAIL');}
 }
 const {client}=mock(()=>{throw new Error('SECRET-NETWORK-DETAIL');});await expect(client.getPlan(pid)).rejects.toMatchObject({code:'PAYMENT_PROVIDER_UNAVAILABLE'});
});
it('clears a rejected token so a later retry can authenticate again',async()=>{
 let requests=0;const {client,calls}=mock(path=>path.includes('oauth2')?response(token):++requests===1?response({},401):response(plan));
 await expect(client.getPlan(pid)).rejects.toThrow();await client.getPlan(pid);expect(calls.filter(c=>c.url.includes('oauth2'))).toHaveLength(2);
});
it('verifies webhook signatures using the configured webhook and fixed provider endpoint',async()=>{
 const {client,calls}=mock(path=>response(path.includes('oauth2')?token:{verification_status:'SUCCESS'}));
 await client.verifyWebhook(headers,event);
 const sent=JSON.parse(String(calls[1]!.init.body));expect(sent).toMatchObject({webhook_id:'test-webhook',webhook_event:event,transmission_id:'TRANSMISSION-TEST'});
 expect(calls[1]!.url).toBe(`${settings.baseUrl}/v1/notifications/verify-webhook-signature`);
});
it('rejects bad/missing signature headers and foreign certificate URLs',async()=>{
 const {client,calls}=mock(()=>response(token));
 for(const h of [{},{...headers,'paypal-cert-url':'http://127.0.0.1/private'},{...headers,'paypal-cert-url':'https://api.paypal.com.evil.test/v1/notifications/certs/test'},{...headers,'paypal-auth-algo':'none'}])await expect(client.verifyWebhook(h,event)).rejects.toMatchObject({code:'INVALID_WEBHOOK_SIGNATURE'});
 expect(calls).toHaveLength(0);
 const bad=mock(path=>response(path.includes('oauth2')?token:{verification_status:'FAILURE'}));await expect(bad.client.verifyWebhook(headers,event)).rejects.toMatchObject({code:'INVALID_WEBHOOK_SIGNATURE'});
});
it('accepts only PayPal approval URLs for the configured mode',()=>{
 const {client}=mock(()=>response(token));expect(client.approvalUrl(snapshot)).toContain('www.sandbox.paypal.com');
 for(const href of ['https://www.paypal.com/webapps/billing/subscriptions','https://evil.test/webapps/billing/subscriptions','https://www.sandbox.paypal.com@evil.test/webapps/billing/subscriptions','javascript:alert(1)','https://www.sandbox.paypal.com/other'])expect(()=>client.approvalUrl({...snapshot,links:[{rel:'approve',href}]})).toThrow();
});
it('enforces exact immutable plan terms and forbids trials, taxes and extra quantities',()=>{
 const local={priceMinor:2900,currency:'USD',interval:'MONTH'};expect(()=>assertPlanTerms(plan,local)).not.toThrow();
 for(const p of [{...plan,status:'INACTIVE'},{...plan,quantity_supported:true},{...plan,taxes:{percentage:'5'}},{...plan,payment_preferences:{setup_fee:{value:'1',currency_code:'USD'}}},{...plan,billing_cycles:[]},{...plan,billing_cycles:[...plan.billing_cycles,...plan.billing_cycles]}])expect(()=>assertPlanTerms(p,local)).toThrow();
 expect(()=>assertPlanTerms(plan,{...local,priceMinor:2901})).toThrow();expect(()=>assertPlanTerms(plan,{...local,currency:'EUR'})).toThrow();expect(()=>assertPlanTerms(plan,{...local,interval:'YEAR'})).toThrow();
 expect(()=>assertPlanTerms({...plan,status:'INACTIVE'},local,{allowInactive:true})).not.toThrow();
});
it('binds provider subscriptions to checkout and merchant plan, never payer-supplied claims',()=>{
 const intentRow={id:intent,providerPlanId:pid,providerSubscriptionId:sid};expect(()=>assertBinding(snapshot,intentRow)).not.toThrow();
 for(const change of [{custom_id:'foreign'},{plan_id:`P-${'B'.repeat(24)}`},{id:'I-FOREIGN'},{quantity:'2'},{plan_overridden:true},{shipping_amount:{value:'1.00',currency_code:'USD'}}])expect(()=>assertBinding({...snapshot,...change},intentRow)).toThrow();
});
it('parses minor units exactly and rejects rounding, scientific notation and negatives',()=>{
 expect(minorUnits('29.99')).toBe(2999);expect(minorUnits('0.01')).toBe(1);expect(minorUnits('29')).toBe(2900);
 for(const value of ['1.001','-1','1e3','NaN',' 1',1.5,'01.00'])expect(()=>minorUnits(value)).toThrow();
});
it('cancels only a validated subscription and accepts the documented empty 204 response',async()=>{
 const {client,calls}=mock(path=>path.includes('oauth2')?response(token):new Response(null,{status:204}));
 await client.cancelSubscription(sid);
 expect(calls[1]!.url).toBe(`${settings.baseUrl}/v1/billing/subscriptions/${sid}/cancel`);
 expect(calls[1]!.init.method).toBe('POST');
 expect(JSON.parse(String(calls[1]!.init.body)).reason).toBe('Cancellation requested by the business owner');
 await expect(client.cancelSubscription('../other')).rejects.toThrow();expect(calls).toHaveLength(2);
 const unexpected=mock(path=>response(path.includes('oauth2')?token:{}));
 await expect(unexpected.client.cancelSubscription(sid)).rejects.toMatchObject({code:'PAYMENT_PROVIDER_UNAVAILABLE'});
});
