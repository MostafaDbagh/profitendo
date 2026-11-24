export async function readReceiptWorkbook(buffer){
 const {readReceiptWorkbook:read}=await import('./receiptWorkbookClient');
 return read(buffer);
}
