import { expect, it } from 'vitest';
import { productSchema, patchSchema } from '../src/catalogue/contracts.js';
import { baseUnits } from '../src/catalogue/references.js';

const product = { name: 'Ground coffee', sku: 'COFFEE-01', unit: 'GRAM', purchasePrice: '0.1250' };
it('accepts grams and defaults optional product fields', () => {
  expect(baseUnits).toContain('GRAM');
  expect(productSchema.parse(product)).toMatchObject({ category: '', sellingPrice: '0', minimumStock: '0' });
});
it('requires purchase cost while accepting an explicit zero', () => {
  const { purchasePrice, ...withoutCost } = product;
  expect(productSchema.safeParse(withoutCost).success).toBe(false);
  expect(productSchema.safeParse({ ...product, purchasePrice: '' }).success).toBe(false);
  expect(productSchema.safeParse({ ...product, purchasePrice: '0' }).success).toBe(true);
});
it('still validates supplied optional amounts and permits unrelated partial updates', () => {
  for (const change of [{ sellingPrice: '-1' }, { minimumStock: 'bad' }]) {
    expect(productSchema.safeParse({ ...product, ...change }).success).toBe(false);
  }
  expect(patchSchema.safeParse({ revision: 0, category: '' }).success).toBe(true);
});
