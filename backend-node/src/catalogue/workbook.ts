import { exportHeaders, exportUnits } from './export.js';
import { Worker } from 'node:worker_threads';
import Excel from 'exceljs';
import { ApiError } from '../errors.js';
export const columns=['sku','name','unit','purchasePrice','sellingPrice','minimumStock','category','subcategory','brand','description','barcodes','active'] as const;
export const arabicColumns=['رمز الصنف','اسم المنتج','الوحدة','تكلفة الشراء','سعر البيع','حد تنبيه المخزون','الفئة','الفئة الفرعية','العلامة التجارية','الوصف','الباركودات','نشط'] as const;
export const templateColumns=(lang:string='en')=>lang==='ar'?arabicColumns:columns;
export const validImportHeaders=(values:(string|number)[])=>importHeaderMap(values)!==null;
export type WorkbookRow={row:number;values:(string|number)[];invalid:boolean};
let running=0;
export async function parseWorkbook(buffer:Buffer):Promise<WorkbookRow[]> {
  if(buffer.length>1024*1024 || buffer.length<4)throw new ApiError(422,'INVALID_WORKBOOK','Use an XLSX workbook of at most 1 MB');
  if(running>=2)throw new ApiError(429,'IMPORT_BUSY','Another workbook is being processed. Try again');
  running++;
  try{return await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./xlsx-worker.cjs',import.meta.url),{workerData:buffer,resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:16}});
    let settled=false;
    const finish=async(rows?:WorkbookRow[],code='INVALID_WORKBOOK')=>{if(settled)return;settled=true;clearTimeout(timer);await worker.terminate();if(rows)resolve(rows);else reject(new ApiError(422,code,'Workbook could not be read within the allowed limits'));};
    const timer=setTimeout(()=>finish(),8000);
    worker.once('message',message=>finish(message.error?undefined:message.rows,message.error==='IMPORT_HEADERS'?'IMPORT_HEADERS':'INVALID_WORKBOOK'));worker.once('error',()=>finish());worker.once('exit',()=>finish());
  });}finally{running--;}
}
export async function importTemplate(lang:string='en'){
  const workbook=new Excel.Workbook(),sheet=workbook.addWorksheet(lang==='ar'?'المنتجات':'Products', {views:[{rightToLeft:lang==='ar'}]});
  sheet.addRow([...templateColumns(lang)]);sheet.getRow(1).font={bold:true};
  columns.forEach((_v,i)=>{const column=sheet.getColumn(i+1);column.width=22;column.numFmt='@';});
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

const normalizeHeader=(value:string|number)=>String(value).normalize('NFKC').replace(/[\u200e\u200f\u061c\ufeff]/g,'').trim().toLowerCase().replace(/[\s_-]+/g,'');
export function importHeaderMap(values:(string|number)[]) {
  const keys=values.map(value=>Object.entries(exportHeaders).find(([key,labels])=>[key,...labels].some(label=>normalizeHeader(label)===normalizeHeader(value)))?.[0]);
  if(keys.some(key=>!key)||new Set(keys).size!==keys.length||!['name','unit','purchasePrice'].every(key=>keys.includes(key)))return null;
  return keys as string[];
}
export function importUnit(value:string|number) {
  if (typeof value !== 'string') return value;
  const code = value.normalize('NFKC').trim().toUpperCase();
  return Object.entries(exportUnits).find(([, labels]) =>
    labels.some(label => label.toUpperCase() === code)
  )?.[0] ?? code;
}
