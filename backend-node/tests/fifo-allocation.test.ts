import {it,expect} from 'vitest';
import {costOf,sliceCosts,sliceCostAmount,type CostSlice} from '../src/operations/fifo.js';
import {fixed,scaled} from '../src/operations/decimal.js';
it('conserves quantity and original value over 6,000 deterministic split/transfer/return cases',()=>{
 let seed=20261116;const random=(max:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
 for(const digits of [0,2,3])for(let scenario=0;scenario<2000;scenario++){
  const layers:CostSlice[]=Array.from({length:1+random(5)},(_,i)=>{const layer={quantity:fixed(BigInt(1+random(100000))),unitCost:fixed(BigInt(random(1000000))),acquiredAt:'2026-11-16T00:00:00.000Z',originId:String(i)};return {...layer,amount:costOf([layer],digits)};});
  const original=scaled(costOf(layers,digits)),quantity=layers.reduce((n,l)=>n+scaled(l.quantity),0n);let offset=0n,cost=0n;
  while(offset<quantity){const amount=BigInt(1+random(Number(quantity-offset))),portion=sliceCosts(layers,offset,amount,digits);expect(portion.reduce((n,l)=>n+scaled(l.quantity),0n)).toBe(amount);
   const value=scaled(sliceCostAmount(layers,offset,amount,digits));expect(value).toBeGreaterThanOrEqual(0n);cost+=value;
   // A received transfer can itself be returned/sold in multiple pieces.
   const split=amount/2n;expect(scaled(sliceCostAmount(portion,0n,split,digits))+scaled(sliceCostAmount(portion,split,amount-split,digits))).toBe(value);offset+=amount;
  }
  expect(cost).toBe(original);
 }
});
it('rejects excessive or negative allocation without producing a usable cost',()=>{
 const layers=[{quantity:'1',unitCost:'2',amount:'2.0000',acquiredAt:'2026-11-16T00:00:00.000Z',originId:'test'}];
 for(const [offset,amount] of [[0n,10001n],[-1n,1n],[0n,-1n],[10001n,1n]] as const)expect(()=>sliceCosts(layers,offset,amount,2)).toThrow();
});
