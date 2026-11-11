import { Worker } from 'node:worker_threads';
import Excel from 'exceljs';
import { ApiError } from '../errors.js';
export const columns=['sku','name','unit','purchasePrice','sellingPrice','minimumStock','category','subcategory','brand','description','barcodes','active'] as const;
export type WorkbookRow={row:number;values:(string|number)[];invalid:boolean};
let running=0;
export async function parseWorkbook(buffer:Buffer):Promise<WorkbookRow[]> {
  if(buffer.length>1024*1024 || buffer.length<4)throw new ApiError(422,'INVALID_WORKBOOK','Use an XLSX workbook of at most 1 MB');
  if(running>=2)throw new ApiError(429,'IMPORT_BUSY','Another workbook is being processed. Try again');
  running++;
  try{return await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./xlsx-worker.cjs',import.meta.url),{workerData:buffer,resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:16}});
    let settled=false;
    const finish=async(rows?:WorkbookRow[])=>{if(settled)return;settled=true;clearTimeout(timer);await worker.terminate();if(rows)resolve(rows);else reject(new ApiError(422,'INVALID_WORKBOOK','Workbook could not be read within the allowed limits'));};
    const timer=setTimeout(()=>finish(),8000);
    worker.once('message',message=>finish(message.error?undefined:message.rows));worker.once('error',()=>finish());worker.once('exit',()=>finish());
  });}finally{running--;}
}
export async function importTemplate(){
  const workbook=new Excel.Workbook(),sheet=workbook.addWorksheet('Products');
  sheet.addRow([...columns]);sheet.getRow(1).font={bold:true};
  columns.forEach((_v,i)=>{const column=sheet.getColumn(i+1);column.width=22;column.numFmt='@';});
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}
