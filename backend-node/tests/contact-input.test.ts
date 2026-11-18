import {it,expect} from 'vitest';
import {contactText} from '../src/support/router.js';
it('normalizes contact text without destroying Arabic or interpreting HTML',()=>{
 expect(contactText(2,5000).parse('  مرحباً\r\nرسالة  ')).toBe('مرحباً\nرسالة');
 expect(contactText(2,5000).parse('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
 for(const value of ['\u0000hello','\u0007hello','  ','a'.repeat(5001)])expect(contactText(2,5000).safeParse(value).success).toBe(false);
});
