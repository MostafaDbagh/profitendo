import { describe, expect, it } from 'vitest';
import { exclusiveTax } from '../src/sales/tax.js';
describe('exclusive tax arithmetic', () => {
  it('adds tax to the discounted base and supports exempt items', () => {
    expect(exclusiveTax('90', '5', 2)).toBe('4.5000');
    expect(exclusiveTax('90', '0', 2)).toBe('0.0000');
  });
  it('rounds half-up at currency precision without floating point', () => {
    expect(exclusiveTax('0.10', '5', 2)).toBe('0.0100');
    expect(exclusiveTax('0.09', '5', 2)).toBe('0.0000');
    expect(exclusiveTax('101', '5', 0)).toBe('5.0000');
    expect(exclusiveTax('100', '2.125', 3)).toBe('2.1250');
  });
  it('rejects invalid configuration and negative taxable bases', () => {
    for (const rate of ['-1', '101', 'NaN', '1e2', '100.0001']) expect(() => exclusiveTax('1', rate, 2)).toThrow();
    expect(() => exclusiveTax('-1', '5', 2)).toThrow();
  });
});
