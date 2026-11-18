import { percentageRow, discountPayload } from './discount';
test('preserves a legacy money discount without reinterpreting it as a percentage',()=>{
 const row=percentageRow({gross:'40',discount:'5'});
 expect(row.discountPercent).toBe('12.5000');expect(discountPayload(row)).toEqual({discount:'5'});
});
test('restores percentage drafts and calculates the equivalent rate for old pack drafts',()=>{
 const row={discountPercent:'10',quantity:'2'};expect(percentageRow(row)).toBe(row);
 expect(discountPayload(row)).toEqual({discountPercent:'10'});
 const legacy=percentageRow({quantity:'2',unitPrice:'10',packId:'pack',packs:[{id:'pack',baseQuantity:'4'}],discount:'20'});
 expect(legacy.discountPercent).toBe('25.0000');expect(discountPayload(legacy)).toEqual({discount:'20'});
});
