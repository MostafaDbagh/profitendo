import { ApiError } from '../errors.js';
export const scaled=(value:string)=>{const sign=value.startsWith('-')?-1n:1n;const [whole,fraction='']=value.replace(/^-/,'').split('.');return sign*(BigInt(whole!)*10000n+BigInt(fraction.padEnd(4,'0')));};
export function fixed(value:bigint,places=4){const scale=10n**BigInt(places),sign=value<0n?'-':'';const abs=value<0n?-value:value;return `${sign}${abs/scale}.${String(abs%scale).padStart(places,'0')}`;}
export function quantity(value:bigint){if(value<0n)throw new ApiError(409,'INSUFFICIENT_STOCK','Insufficient available stock');if(value>999999999999999999n)throw new ApiError(422,'QUANTITY_OVERFLOW','Quantity exceeds supported limit');return fixed(value);}
