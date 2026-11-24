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
test.each(['ar','en'])('exports names and units and reimports in either language (%s)',lang=>{
 const csv=receiptCsv([{sku:'0001',name:'حليب، طازج',unit:'LITRE',quantity:'2',unitCost:'90'}],true,lang);
 expect(csv).toContain('حليب، طازج');
 expect(csv).toContain(lang==='ar'?'اسم المنتج':'name');
 expect(csv).toContain(lang==='ar'?'لتر':'LITRE');
 expect(parseReceiptCsv(csv,true)).toEqual([{sku:'0001',quantity:'2',unitCost:'90'}]);
});
test('accepts reordered Arabic columns and preserves cost restrictions',()=>{
 expect(parseReceiptCsv('اسم المنتج,الكمية,رمز الصنف\nحليب,2,001',false)).toEqual([{sku:'001',quantity:'2'}]);
 expect(()=>parseReceiptCsv('رمز الصنف,الكمية,تكلفة الوحدة\n001,2,90',false)).toThrow('HEADERS');
 expect(()=>parseReceiptCsv('sku,رمز الصنف,quantity\n001,001,2',false)).toThrow('HEADERS');
});
test('reports the supplied unknown SKU without creating products or partial rows',async()=>{
 const rows=parseReceiptCsv('sku,quantity,unit_cost\nMILK-001,1,90\nsafi,2,100',true);
 const api=jest.fn().mockResolvedValueOnce({product:{id:'p',sku:'MILK-001',name:'Milk'}}).mockRejectedValueOnce(new Error('PRODUCT_NOT_FOUND'));
 await expect(resolveReceiptRows(rows,api,'/businesses/b',[],true)).rejects.toThrow('PRODUCT:3:safi');
 expect(api.mock.calls.every(args=>args.length===1)).toBe(true);
});
