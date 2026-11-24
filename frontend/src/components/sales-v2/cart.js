import {formatQuantity} from '../../lib/quantity';
import {percentageRow} from './discount';

const factor = 10000n;
export function decimal(value) {
  if (!/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(String(value))) return null;
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * factor + BigInt(fraction.padEnd(4, '0'));
}
export function fixed(value) {
  return `${value / factor}.${String(value % factor).padStart(4, '0')}`;
}
export const emptyLine = () => ({key:crypto.randomUUID(), productId:'', name:'', quantity:'1', packs:[], packId:null, unitPrice:'0', discountPercent:'0', discountReason:''});
export function existingLine(line) {
  const packs = [...(line.availablePacks ?? line.packs ?? [])];
  if (line.packId && !packs.some(pack => pack.id === line.packId)) {
    packs.push({id:line.packId, name:line.packName, baseQuantity:line.factor});
  }
  return percentageRow({...line, key:line.key ?? crypto.randomUUID(), quantity:formatQuantity(line.quantity), packs});
}
const packFactor = row => decimal(row.packs.find(p => p.id === row.packId)?.baseQuantity ?? '1');
export function addProduct(rows, product, targetKey) {
  const same = rows.find(row => row.productId === product.id && !row.packId);
  const target = targetKey ? rows.find(row => row.key === targetKey) : rows.find(row => !row.productId);
  const quantity = same ? decimal(same.quantity) : 0n;
  if (quantity === null) throw new Error('INVALID_QUANTITY');
  const baseToAdd = same && targetKey && same.key === targetKey ? 0n : factor;
  const otherUnits = rows.filter(row => row.productId === product.id && row !== same && row !== target)
    .reduce((sum,row) => sum + (decimal(row.quantity) ?? 0n) * packFactor(row), 0n);
  if ((quantity + baseToAdd) * factor + otherUnits > decimal(product.available) * factor) throw new Error('INSUFFICIENT_STOCK');
  if (same) {
    return rows.filter(row => !targetKey || row !== target || row === same).map(row => row === same
      ? {...row, available:product.available, quantity:formatQuantity(fixed(quantity + baseToAdd)), ...(baseToAdd ? {legacyDiscount:undefined} : {})}
      : row);
  }
  if (!target && rows.length >= 100) throw new Error('VALIDATION_ERROR');
  const line = {...emptyLine(), ...(target ? {key:target.key} : {}), productId:product.id, name:product.name, sku:product.sku,
    unit:product.unit, packs:product.packs ?? [], unitPrice:product.sellingPrice, available:product.available};
  return target ? rows.map(row => row === target ? line : row) : [...rows, line];
}

// Preview the same per-line, half-up currency rounding used in SalesService.price.
// The server quote is checked again before any payment is posted.
export function cartSummary(rows, business) {
  const currency = business.baseCurrency;
  const currencyDigits = new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
  const quantum = 10n ** BigInt(4 - currencyDigits);
  const round = (numerator, denominator) => ((numerator + denominator * quantum / 2n) / (denominator * quantum)) * quantum;
  const taxRate = decimal(business.countryCode === 'SY' ? '0' : business.salesTaxRate ?? '0');
  let subtotal = 0n, discount = 0n, tax = 0n, valid = true;
  const lines = new Map(), requested = new Map(), available = new Map();
  for (const row of rows.filter(r => r.productId)) {
    const qty = decimal(row.quantity), price = decimal(row.unitPrice), pack = packFactor(row);
    const rate = decimal(row.discountPercent || '0');
    if (!qty || !pack || price === null || rate === null || rate > 100n * factor || qty * pack % factor !== 0n) { valid = false; continue; }
    const units = qty * pack / factor;
    requested.set(row.productId, (requested.get(row.productId) ?? 0n) + units);
    if (row.available != null) available.set(row.productId, decimal(row.available));
    const gross = round(units * price, factor);
    const reduction = row.legacyDiscount != null ? decimal(row.legacyDiscount) : round(gross * rate, 100n * factor);
    if (reduction === null || reduction > gross) { valid = false; continue; }
    const lineTax = round((gross - reduction) * taxRate, 100n * factor);
    lines.set(row.key, fixed(gross - reduction + lineTax));
    subtotal += gross; discount += reduction; tax += lineTax;
  }
  const shortStock = new Set([...requested].filter(([id,count]) => available.has(id) && count > available.get(id)).map(([id]) => id));
  return {currency, currencyDigits, subtotal:fixed(subtotal), discount:fixed(discount), tax:fixed(tax), total:fixed(subtotal - discount + tax),
    valid:valid && !shortStock.size && lines.size > 0, lines, shortStock};
}
