import { expect, it } from 'vitest';
import { productExportCsv } from '../src/catalogue/export.js';
it('localizes Arabic headers, standard units and flags while preserving product data', () => {
  expect(productExportCsv(['name','sku','unit','sellingPrice','lowStock'], [{name:'Coffee',sku:'00123',unit:'GRAM',sellingPrice:'2.5000',lowStock:true}], 'ar'))
    .toBe('"اسم المنتج","رمز الصنف","الوحدة","سعر البيع","مخزون منخفض"\r\n"Coffee","00123","غرام","2.5000","نعم"');
});
it('uses English by default and keeps custom units and CSV escaping', () => {
  expect(productExportCsv(['name','unit','lowStock'], [{name:'a,"b"',unit:'CUSTOM',lowStock:false}]))
    .toBe('"Product name","Unit","Low stock"\r\n"a,""b""","CUSTOM","No"');
});
it('exports only authorized columns and preserves formula protection', () => {
  const csv = productExportCsv(['name'], [{name:'=1+1',purchasePrice:'99'}], 'ar');
  expect(csv).toContain("'=1+1");
  expect(csv).not.toContain('99');
});
