import {readCsvGrid,detectMapping,mappedRows,inspectRows,canApply,readyLines} from './receiptImport';
const product={id:'p',sku:'001',name:'Milk',unit:'LITRE',active:true,purchasePrice:'3'};
test('100 columns use supported fields and ignore every extra column',()=>{
 const headers=['اسم المنتج','الكمية','رمز الصنف',...Array.from({length:97},(_,i)=>`Extra ${i}`)];
 const grid=readCsvGrid(headers.join(',')+'\n'+['Milk','٢','001',...Array(97).fill('anything')].join(','));
 const mapping=detectMapping(grid[0]);expect(mapping.filter(Boolean)).toEqual(['name','quantity','sku']);
 expect(mappedRows(grid,mapping,true)[0]).toMatchObject({name:'Milk',quantity:'٢',sku:'001'});
});
test.each([',',';','\t'])('reads delimiter %j and quoted values',sep=>{
 const grid=readCsvGrid(`SKU${sep}Product name${sep}Qty\n001${sep}"Milk, fresh"${sep}1.25`);
 expect(mappedRows(grid,detectMapping(grid[0]),false)[0]).toMatchObject({name:'Milk, fresh',quantity:'1.25',sku:'001'});
});
test('requires quantity and identity mappings, rejects duplicate destinations',()=>{
 expect(()=>mappedRows([['a','b'],['1','2']],['sku','sku'],true)).toThrow('MAPPING');
 expect(()=>mappedRows([['a'],['1']],['quantity'],true)).toThrow('MAPPING');
});
test('unknown fields are not included and cost fields cannot bypass permission',()=>{
 expect(()=>mappedRows([['a','b','c'],['001','1','2']],['sku','quantity','unitCost'],false)).toThrow('MAPPING');
});
test('matches exact SKU, normalizes Arabic decimals and confirms only ready rows',async()=>{
 const api=jest.fn().mockResolvedValue({product});
 const rows=await inspectRows([{sku:'001',quantity:'٢٫٥',unit:'لتر',unitCost:'٩٠'}],api,'/businesses/b',[],true);
 expect(rows[0]).toMatchObject({status:'READY',quantity:'2.5',unitCost:'90'});expect(canApply(rows)).toBe(true);expect(readyLines(rows)[0].productId).toBe('p');
});
test('missing and ambiguous names block confirmation; no writes',async()=>{
 const api=jest.fn().mockResolvedValue({items:[product,{...product,id:'q'}],total:2,pageSize:25});
 const rows=await inspectRows([{name:'Milk',quantity:'1'}],api,'/businesses/b',[],false);
 expect(rows[0].status).toBe('AMBIGUOUS');expect(canApply(rows)).toBe(false);expect(api.mock.calls.every(call=>call.length===1)).toBe(true);
});
test('duplicate matches, wrong units and existing draft conflicts remain visible',async()=>{
 const api=jest.fn().mockResolvedValue({product});
 const rows=await inspectRows([{sku:'001',quantity:'1'},{sku:'001',quantity:'2'},{sku:'001',quantity:'1',unit:'BOX'}],api,'/businesses/b',[],false);
 expect(rows.map(r=>r.status)).toEqual(['READY','DUPLICATE','UNIT']);
 const conflict=await inspectRows([{sku:'001',quantity:'2'}],api,'/businesses/b',[{productId:'p',quantity:'1'}],false);expect(conflict[0].status).toBe('CONFLICT');
});
test('excluded rows do not lookup or import; repeated existing lines are skipped',async()=>{
 const api=jest.fn().mockResolvedValue({product});
 const rows=await inspectRows([{sku:'x',skip:true},{sku:'001',quantity:'1.0000',unitCost:'3'}],api,'/businesses/b',[{productId:'p',quantity:'1',unitCost:'3.0000'}],true);
 expect(rows.map(r=>r.status)).toEqual(['SKIPPED','EXISTS']);expect(readyLines(rows)).toEqual([]);expect(api).toHaveBeenCalledTimes(1);
});
test('manual matches are fetched again and inactive products rejected',async()=>{
 const api=jest.fn().mockResolvedValue({...product,active:false});
 const rows=await inspectRows([{product,sku:'001',quantity:'1'}],api,'/businesses/b',[],true);
 expect(api).toHaveBeenCalledWith('/businesses/b/products/p');expect(rows[0].status).toBe('MISSING');
});
