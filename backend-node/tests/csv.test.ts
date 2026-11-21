import {it,expect} from 'vitest';
import {parseCsv} from '../src/catalogue/csv.js';
import {columns} from '../src/catalogue/workbook.js';
const csv=(body:string)=>Buffer.from('\uFEFF'+columns.join(',')+'\r\n'+body);
it('preserves Arabic, quoted commas, doubled quotes, multiline cells and leading zeros',()=>{
 const rows=parseCsv(csv('001,"حليب, ""طازج""",LITRE,1.20,2.50,0,,,,"line 1\nline 2","00123\n00456",true\r\n'));
 expect(rows[1]).toEqual({row:2,invalid:false,values:['001','حليب, "طازج"','LITRE','1.20','2.50','0','','','','line 1\nline 2','00123\n00456','true']});
});
it('rejects malformed quoting, invalid UTF-8, oversized cells/files and excess rows',()=>{
 for(const input of [csv('"unclosed'),csv('"closed"junk'),Buffer.from([255,254]),Buffer.alloc(1024*1024+1),csv('a'.repeat(2601)),csv(('x,'.repeat(11)+'true\n').repeat(501))])expect(()=>parseCsv(input)).toThrow();
});
it('flags missing columns and rejects extra header columns without silently dropping data',()=>{
 expect(()=>parseCsv(Buffer.from('sku,name\na,b'))).toThrow(expect.objectContaining({code:'IMPORT_HEADERS'}));
 expect(()=>parseCsv(Buffer.from(columns.join(',')+',unexpected\n'))).toThrow(expect.objectContaining({code:'IMPORT_HEADERS'}));
 expect(parseCsv(csv('sku,name'))[1]!.invalid).toBe(true);
});
it('accepts exactly 500 data rows and keeps formula-like text inert',()=>{
 const row='001,=SUM(A1),PIECE,1,2,0,,,,,,true';
 expect(parseCsv(csv(Array(500).fill(row).join('\n')))).toHaveLength(501);
 expect(parseCsv(csv(row))[1]!.values[1]).toBe('=SUM(A1)');
});
