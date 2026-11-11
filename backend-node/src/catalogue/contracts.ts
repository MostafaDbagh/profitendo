import { z } from 'zod';
// Decimal strings prevent binary floating-point rounding and preserve scanner zeros.
export const decimal = z.string().regex(/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/);
export const barcode = z.string().regex(/^[!-~]{1,128}$/);
const fields = {
  name:z.string().trim().min(2).max(160), category:z.string().trim().max(80),
  subcategory:z.string().trim().max(80), brand:z.string().trim().max(80),
  description:z.string().trim().max(2000), purchasePrice:decimal, sellingPrice:decimal,
  minimumStock:decimal, active:z.boolean(),
  barcodes:z.array(barcode).max(20).refine(values=>new Set(values).size===values.length),
};
export const productSchema=z.object({...fields,
  sku:z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,59}$/),
  unit:z.enum(['PIECE','BOX','CARTON','KG','LITRE','METRE']),
  category:fields.category.default(''),subcategory:fields.subcategory.default(''),
  brand:fields.brand.default(''),description:fields.description.default(''),
  minimumStock:decimal.default('0'),active:z.boolean().default(true),barcodes:fields.barcodes.default([]),
}).strict();
export const patchSchema=z.object(fields).partial().extend({revision:z.number().int().nonnegative()}).strict().refine(value=>Object.keys(value).length>1);
export type ProductInput=z.infer<typeof productSchema>;
export type ProductPatch=z.infer<typeof patchSchema>;
