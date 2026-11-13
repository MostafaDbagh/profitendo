import {it,expect,vi} from 'vitest';
import {normalizeSyrianMobile,normalizePhone,readSmsSettings,sendSms} from '../src/auth/sms-settings.js';
it('normalizes Syrian mobile formats and rejects other destinations',()=>{
 for(const phone of ['0941234567','+963941234567','00963941234567','963941234567','٩٤١٢٣٤٥٦٧','۰۹۴۱۲۳۴۵۶۷','(094) 123-4567'])expect(normalizeSyrianMobile(phone)).toBe('+963941234567');
 for(const phone of ['+971501234567','+963111234567','094123456','09412345678','abc0941234567',''])expect(normalizeSyrianMobile(phone)).toBeNull();
});
it('requires explicit approved sender/template and never embeds another app credentials',()=>{expect(readSmsSettings({})).toBeNull();expect(()=>readSmsSettings({NODE_ENV:'production'})).toThrow();expect(()=>readSmsSettings({MSGPLUS_API_KEY:'secret'})).toThrow();});
it('uses official MsgPlus HTTPS contract with timeout, template vars and no redirects',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({success:true,sms_log_id:12}),{status:202}));
 const settings=readSmsSettings({MSGPLUS_API_KEY:'test-secret',MSGPLUS_SENDER_NAME:'ProfitLens',MSGPLUS_TEMPLATE_ID:'1'})!;
 await sendSms(settings,{phone:'0941234567',code:'123456',name:'Tester'},fetcher);
 const [url,options]=fetcher.mock.calls[0]!;expect(url).toBe('https://sms.msgplus.tech/api/v1/send');expect(options.redirect).toBe('error');expect(options.headers.Authorization).toBe('Bearer test-secret');expect(options.headers['X-Timestamp']).toMatch(/^\d+$/);expect(JSON.parse(options.body)).toEqual({sender_name:'ProfitLens',template_id:1,numbers:['963941234567'],vars:{code:'123456'}});
 await sendSms({...settings,MSGPLUS_VARIABLE_STYLE:'P3'},{phone:'0941234567',code:'123456',name:'Tester'},fetcher);expect(JSON.parse(fetcher.mock.calls[1]![1].body).vars).toEqual({P1:'Tester',P2:'ProfitLens',P3:'123456'});
});
it('fails closed on provider failures or malformed acceptance',async()=>{
 const s=readSmsSettings({MSGPLUS_API_KEY:'test-secret',MSGPLUS_SENDER_NAME:'ProfitLens',MSGPLUS_TEMPLATE_ID:'1'})!;
 for(const response of [new Response('{}',{status:202}),new Response('{"success":false}',{status:202}),new Response('private provider error',{status:403})])await expect(sendSms(s,{phone:'0941234567',code:'123456',name:'Tester'},vi.fn().mockResolvedValue(response))).rejects.toThrow('SMS provider did not accept');
});

it('accepts international country codes without a fixed country allowlist',async()=>{
 const phones=['+971501234567','+966501234567','+96892123456','+962791234567','+9613123456','+97455123456','+963941234567','+447700900123','+14155552671'];
 const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({sms_log_id:14}),{status:202}));
 const settings=readSmsSettings({MSGPLUS_API_KEY:'test',MSGPLUS_SENDER_NAME:'ProfitLens',MSGPLUS_TEMPLATE_ID:'1'})!;
 for(const phone of phones){expect(normalizePhone(phone)).toBe(phone);await sendSms(settings,{phone,code:'123456',name:'Tester'},fetcher);expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).numbers).toEqual([phone.slice(1)]);}
 expect(normalizePhone('+٩٧١ (٥٠) ١٢٣-٤٥٦٧')).toBe('+971501234567');expect(normalizePhone('00971501234567')).toBe('+971501234567');
 for(const phone of ['+012345678','+123','+1234567890123456','+971abc123456','+971+501234567'])expect(normalizePhone(phone)).toBeNull();
});
