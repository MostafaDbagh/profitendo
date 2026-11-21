import { expect,it } from 'vitest';
import {productExportCsv} from '../src/catalogue/export.js';
import {parseCsv} from '../src/catalogue/csv.js';
import {importHeaderMap,importUnit} from '../src/catalogue/workbook.js';
it.each(['ar','en'] as const)('accepts exported %s columns and units including report columns',lang=>{
 const headers=['name','sku','unit','category','subcategory','brand','description','barcodes','active','minimumStock','sellingPrice','purchasePrice','saleCount','unitsSold','onHand','available','lowStock'];
 const csv=productExportCsv(headers,[{name:'Coffee',sku:'COFFEE',unit:'GRAM',purchasePrice:'1.2',barcodes:['00123'],active:true}],lang);
 const rows=parseCsv(Buffer.from(csv));
 expect(importHeaderMap(rows[0]!.values)).toEqual(headers);
 expect(importUnit(rows[1]!.values[2]!)).toBe('GRAM');
 expect(rows[1]!.values[7]).toBe('00123');
 expect(rows[1]!.invalid).toBe(false);
});
it('maps reordered, mixed-language headers with spacing and case differences',()=>{
 const rows=parseCsv(Buffer.from(' تكلفة الشراء ,UNIT,Product Name,رمز الصنف\n1.25,GRAM,Coffee,00123'));
 const headers=importHeaderMap(rows[0]!.values)!;
 expect(Object.fromEntries(headers.map((key,i)=>[key,rows[1]!.values[i]]))).toEqual({purchasePrice:'1.25',unit:'GRAM',name:'Coffee',sku:'00123'});
 expect(importHeaderMap(['purchase_price',' NAME ','unit'])).toEqual(['purchasePrice','name','unit']);
});
it('rejects duplicate semantic columns and missing required labels',()=>{
 expect(importHeaderMap(['name','اسم المنتج','unit','purchasePrice'])).toBeNull();
 expect(importHeaderMap(['name','unit'])).toBeNull();
});

it('accepts lowercase unit codes from edited exports',()=>{
 expect(importUnit('box')).toBe('BOX');
 expect(importUnit('custom_unit')).toBe('CUSTOM_UNIT');
 expect(importUnit('علبة')).toBe('BOX');
});
