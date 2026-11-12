import { ApiError } from '../errors.js';
import { checked } from './money.js';
import { scaled } from '../operations/decimal.js';

// Tax-exclusive prices. Rates are explicitly configured, never inferred from
// currency or country. Calculate on each discounted line and round half-up once.
export function exclusiveTax(net: string, rate: string, digits: number): string {
  if (!/^(0|[1-9]\d?)(\.\d{1,4})?$|^100(?:\.0{1,4})?$/.test(rate) || !Number.isInteger(digits) || digits < 0 || digits > 4) {
    throw new ApiError(422, 'INVALID_TAX_RATE', 'Tax rate must be between 0 and 100 percent');
  }
  const amount = scaled(net), percentage = scaled(rate);
  if (amount < 0n) throw new ApiError(422, 'INVALID_TAX_BASE', 'Tax base must be nonnegative');
  const quantum = 10n ** BigInt(4 - digits);
  const divisor = 1000000n * quantum;
  return checked(((amount * percentage + divisor / 2n) / divisor) * quantum);
}
