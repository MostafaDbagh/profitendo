import type {Tx} from '../auth/service.js';
import {ApiError} from '../errors.js';
import {fixed,scaled} from './decimal.js';
import {checked} from '../sales/money.js';
export type CostSlice={quantity:string;unitCost:string;acquiredAt:string;originId:string;originOrder?:string;amount?:string};
const fail=()=>{throw new ApiError(409,'FIFO_REVIEW_REQUIRED','Review stock valuation before continuing');};
export function costOf(layers:CostSlice[],digits:number){
 const raw=layers.filter(l=>l.amount===undefined).reduce((sum,l)=>sum+scaled(l.quantity)*scaled(l.unitCost),0n),step=10n**BigInt(8-digits);
 return checked(layers.reduce((sum,l)=>sum+(l.amount===undefined?0n:scaled(l.amount)),0n)+((raw+step/2n)/step)*10n**BigInt(4-digits));
}
// Allocate the rounded original value cumulatively; splitting a layer must never
// create or destroy a cent, including through repeated returns and transfers.
function allocated(total:string,quantity:string,offset:bigint,amount:bigint,digits:number){
 const step=10n**BigInt(4-digits),units=scaled(total)/step,q=scaled(quantity);
 const prefix=(n:bigint)=>(units*n*2n+q)/(2n*q);
 return checked((prefix(offset+amount)-prefix(offset))*step);
}
export function sliceCosts(layers:CostSlice[],offset:bigint,amount:bigint,digits:number){
 const result:CostSlice[]=[];let skip=offset,left=amount;
 for(const l of layers){const q=scaled(l.quantity);if(skip>=q){skip-=q;continue;}const take=left<q-skip?left:q-skip;if(take>0n)result.push({...l,quantity:fixed(take),amount:allocated(l.amount??costOf([l],digits),l.quantity,skip,take,digits)});left-=take;skip=0n;if(!left)break;}
 if(left||amount<0n||offset<0n)fail();return result;
}
export function sliceCostAmount(layers:CostSlice[],offset:bigint,amount:bigint,digits:number){return costOf(sliceCosts(layers,offset,amount,digits),digits);}
export async function addLayers(tx:Tx,key:{businessId:string;locationId:string;productId:string},layers:CostSlice[],digits:number){
 for(const l of layers){const totalCost=costOf([l],digits);await tx.fifoLayer.create({data:{...key,quantity:l.quantity,remaining:l.quantity,totalCost,remainingCost:totalCost,unitCost:l.unitCost,acquiredAt:new Date(l.acquiredAt),originId:l.originId,...(l.originOrder?{originOrder:BigInt(l.originOrder)}:{})}});}
}
export async function takeLayers(tx:Tx,key:{businessId:string;locationId:string;productId:string},amount:bigint,digits:number){
 const layers=await tx.fifoLayer.findMany({where:{...key,remaining:{gt:0}},orderBy:[{acquiredAt:'asc'},{originOrder:'asc'},{id:'asc'}]});let left=amount;const slices:CostSlice[]=[];
 for(const l of layers){if(!left)break;const remaining=scaled(l.remaining.toFixed(4)),take=left<remaining?left:remaining,cost=allocated(l.totalCost.toFixed(4),l.quantity.toFixed(4),scaled(l.quantity.toFixed(4))-remaining,take,digits);slices.push({quantity:fixed(take),unitCost:l.unitCost.toFixed(4),acquiredAt:l.acquiredAt.toISOString(),originId:l.originId,originOrder:l.originOrder.toString(),amount:cost});await tx.fifoLayer.update({where:{id:l.id},data:{remaining:fixed(remaining-take),remainingCost:fixed(scaled(l.remainingCost.toFixed(4))-scaled(cost))}});left-=take;}
 if(left)fail();return slices;
}
export async function originalLayers(tx:Tx,businessId:string,type:string,sourceLineId:string){
 const movement=await tx.stockMovement.findUnique({where:{businessId_type_sourceLineId:{businessId,type,sourceLineId}}});
 return movement?.costLayers as CostSlice[]|null|undefined;
}
