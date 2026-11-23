import {parseReceiptCsv,receiptCsv,resolveReceiptRows} from './receiptCsvUtils';
test('round trips quoted SKUs, leading zeros and decimal quantities with BOM',()=>{
 const input=[{sku:'001,ABC',quantity:'1.25',unitCost:'2.50'}];
 expect(parseReceiptCsv('\uFEFF'+receiptCsv(input,true),true)).toEqual(input);
});
test.each(['sku,quantity\nA,0','sku,quantity\nA,-1','sku,quantity\nA,1\na,2','sku,quantity\n"A,1','sku,quantity\nA,1,2','sku,quantity\nA,1.23456','sku,quantity'])('rejects invalid files: %s',text=>expect(()=>parseReceiptCsv(text,false)).toThrow());
test('enforces row limit and cost permission shape',()=>{
 expect(()=>parseReceiptCsv('sku,quantity\n'+Array.from({length:101},(_,i)=>`A${i},1`).join('\n'),false)).toThrow();
 expect(()=>parseReceiptCsv('sku,quantity,unit_cost\nA,1,2',false)).toThrow();
});
test('resolves in selected business and rejects draft duplicates or barcode mismatches',async()=>{
 const api=jest.fn().mockResolvedValue({product:{id:'p',sku:'001',name:'Milk',unit:'LITRE'}});
 const rows=[{sku:'001',quantity:'2'}];
 expect(await resolveReceiptRows(rows,api,'/businesses/b',[])).toEqual([{productId:'p',sku:'001',name:'Milk',unit:'LITRE',quantity:'2',unitCost:''}]);
 expect(api).toHaveBeenCalledWith('/businesses/b/products/barcode?value=001');
 await expect(resolveReceiptRows(rows,api,'/businesses/b',[{productId:'p'}])).rejects.toThrow();
 await expect(resolveReceiptRows([{sku:'barcode',quantity:'1'}],api,'/businesses/b',[])).rejects.toThrow();
});
test('escapes spreadsheet formulas on export',()=>expect(receiptCsv([{sku:'=1+1',quantity:'1'}],false)).toContain('"\'=1+1"'));
