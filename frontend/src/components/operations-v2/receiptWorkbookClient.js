export function readReceiptWorkbook(buffer){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./receiptWorkbook.worker.js',import.meta.url));
  const finish=(error,result)=>{clearTimeout(timer);worker.terminate();error?reject(Error(error)):resolve(result);};
  const timer=setTimeout(()=>finish('WORKBOOK'),10000);
  worker.onmessage=({data})=>finish(data.error,data.sheets);
  worker.onerror=()=>finish('WORKBOOK');worker.postMessage(buffer,[buffer]);
 });
}
