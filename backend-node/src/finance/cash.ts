import type {Tx} from '../auth/service.js';
import {fail} from '../workflows/shared.js';
export function businessDay(at:Date,timezone:string){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}
// Sales cash, money entries, closing and timezone edits share this business lock.
// This serializes posting against closing and prevents late cash in a closed day.
export async function lockCash(tx:Tx,bid:string,locationId:string,timezone:string){
 await tx.$queryRaw`SELECT id FROM businesses WHERE id=${bid}::uuid FOR UPDATE`;
 const at=new Date(),day=businessDay(at,timezone);
 if(await tx.cashClose.findUnique({where:{businessId_locationId_day:{businessId:bid,locationId,day}}}))fail('CASH_DAY_CLOSED');return {day,at};
}
