import { expect, it } from 'vitest';
import Excel from 'exceljs';
import { importTemplate, parseWorkbook, templateColumns, validImportHeaders, importHeaderMap, importDecimal } from '../src/catalogue/workbook.js';
import { parseCsv } from '../src/catalogue/csv.js';

it.each(['ar','en'])('round-trips the %s template with localized headers and sheet direction', async lang => {
  const bytes = Buffer.from(await importTemplate(lang), 'base64');
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(bytes as never);
  const sheet = workbook.worksheets[0]!;
  expect(sheet.name).toBe(lang === 'ar' ? 'المنتجات' : 'Products');
  expect(sheet.views[0]?.rightToLeft).toBe(lang === 'ar');
  const rows = await parseWorkbook(bytes);
  expect(rows[0]!.values).toEqual([...templateColumns(lang)]);
  expect(validImportHeaders(rows[0]!.values)).toBe(true);
  const csv = parseCsv(Buffer.from('\uFEFF'+templateColumns(lang).join(',')+'\r\n'));
  expect(validImportHeaders(csv[0]!.values)).toBe(true);
});
it('accepts reordered headers and rejects unknown headers', () => {
  expect(validImportHeaders([...templateColumns('ar')].reverse())).toBe(true);
  expect(validImportHeaders(['unknown'])).toBe(false);
});

it('maps common bilingual headings exactly without confusing purchase and sale prices',()=>{
 expect(importHeaderMap([' Product_Name ','وَحْدَة القياس','سعر الشراء','Sale Price','رمز المنتج / SKU'])).toEqual(['name','unit','purchasePrice','sellingPrice','sku']);
 expect(importHeaderMap(['name','unit','purchasePrice','سعر الشراء'])).toBeNull();
 expect(importHeaderMap(['name','unit','purchasePrice','الكمية الابتدائية'])).toBeNull();
});
it.each([['١٬٢٣٤٫٥٦','1234.56'],['۱۲۳٫۴۵','123.45'],['1,234.50','1234.50'],['1,25','1,25'],['','']])('normalizes unambiguous decimal %s', (input,expected)=>expect(importDecimal(input!)).toBe(expected));

it.each(['merged','formula','hyperlink','date','empty'] as const)('handles %s XLSX content safely',async kind=>{
 const book=new Excel.Workbook(),sheet=book.addWorksheet('Products');sheet.addRow(['name','unit','purchasePrice']);
 if(kind==='merged')sheet.mergeCells('A1:B1');
 else if(kind!=='empty')sheet.addRow(['Safe product','PIECE',kind==='formula'?{formula:'1+1',result:2}:kind==='hyperlink'?{text:'2',hyperlink:'https://example.test'}:new Date()]);
 const bytes=Buffer.from(await book.xlsx.writeBuffer());
 if(kind==='merged')await expect(parseWorkbook(bytes)).rejects.toMatchObject({code:'INVALID_WORKBOOK'});
 else {const rows=await parseWorkbook(bytes);if(kind==='empty')expect(rows).toHaveLength(1);else expect(rows[1]!.invalid).toBe(true);}
});

it('limits concurrent XLSX workers and releases capacity after parsing',async()=>{
 const bytes=Buffer.from(await importTemplate('en'),'base64');
 const results=await Promise.allSettled([parseWorkbook(bytes),parseWorkbook(bytes),parseWorkbook(bytes)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2);
 expect(results[2]).toMatchObject({status:'rejected',reason:{code:'IMPORT_BUSY'}});
 await expect(parseWorkbook(Buffer.from('broken zip'))).rejects.toMatchObject({code:'INVALID_WORKBOOK'});
 await expect(parseWorkbook(bytes)).resolves.toHaveLength(1);
});
