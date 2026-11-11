import { ApiError } from '../errors.js';
import { scaled, fixed } from '../operations/decimal.js';
export function checked(value:bigint){if(value<0n||value>999999999999999999n)throw new ApiError(422,'MONEY_OVERFLOW','Amount exceeds supported limit');return fixed(value);}
export function exactMoney(value:string,digits:number){const amount=scaled(value);if(amount%(10n**BigInt(4-digits))!==0n)throw new ApiError(422,'MONEY_PRECISION','Use the currency decimal precision');checked(amount);return amount;}
export function lineGross(baseQuantity:string,price:string,digits:number){const raw=scaled(baseQuantity)*scaled(price),step=10n**BigInt(8-digits);return checked(((raw+step/2n)/step)*10n**BigInt(4-digits));}
export const currencyDigits=(currency:string)=>new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits!;
