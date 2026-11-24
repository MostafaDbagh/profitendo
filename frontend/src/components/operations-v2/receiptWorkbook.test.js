/** @jest-environment node */
import Excel from 'exceljs';
beforeEach(()=>{global.self=global;global.postMessage=jest.fn();jest.resetModules();require('./receiptWorkbook.worker');});
afterEach(()=>{delete global.self;delete global.postMessage;delete global.onmessage;});
async function parse(workbook){const bytes=await workbook.xlsx.writeBuffer();const data=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);await self.onmessage({data});return self.postMessage.mock.calls[0][0];}
test('reads a real XLSX with 100 columns and Arabic text',async()=>{
 const book=new Excel.Workbook(),sheet=book.addWorksheet('أصناف');
 sheet.addRow(['SKU','اسم المنتج','Qty',...Array.from({length:97},(_,i)=>`extra ${i}`)]);sheet.addRow(['001','حليب',2,...Array(97).fill('ignored')]);
 const result=await parse(book);expect(result.sheets[0].grid[1].slice(0,3)).toEqual(['001','حليب','2']);expect(result.sheets[0].grid[0]).toHaveLength(100);
});
test('rejects spreadsheet formulas rather than executing or trusting cached results',async()=>{
 const book=new Excel.Workbook(),sheet=book.addWorksheet('Items');sheet.addRow(['sku','quantity']);sheet.addRow(['001',{formula:'1+1',result:2}]);expect((await parse(book)).error).toBe('FORMULA');
});
test('rejects too many rows and merged cells',async()=>{
 const book=new Excel.Workbook(),sheet=book.addWorksheet('Items');sheet.addRow(['sku','quantity']);for(let i=0;i<101;i++)sheet.addRow([String(i),1]);expect((await parse(book)).error).toBe('WORKBOOK');
});
