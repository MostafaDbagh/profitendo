/* eslint-env worker */
import Excel from 'exceljs';
self.onmessage=async({data})=>{
 try{
  // Bound declared expansion before the XLSX reader inflates the archive.
  const bytes=new Uint8Array(data),view=new DataView(data);let expanded=0,entries=0;
  for(let i=0;i+46<=bytes.length;i++)if(view.getUint32(i,true)===0x02014b50){
   expanded+=view.getUint32(i+24,true);entries++;
   const length=view.getUint16(i+28,true),name=new TextDecoder().decode(bytes.slice(i+46,i+46+length));
   if(expanded>8*1024*1024||entries>200||/vbaProject|externalLinks|embeddings/i.test(name))throw Error('WORKBOOK');
  }
  if(!entries)throw Error('WORKBOOK');
  const workbook=new Excel.Workbook();await workbook.xlsx.load(data);
  if(!workbook.worksheets.length||workbook.worksheets.length>10)throw Error('WORKBOOK');
  const sheets=workbook.worksheets.map(sheet=>{
   if(sheet.rowCount>101||sheet.columnCount>100||sheet.model.merges.length)throw Error('WORKBOOK');
   const grid=[];
   for(let n=1;n<=sheet.rowCount;n++){
    const row=[];
    for(let c=1;c<=sheet.columnCount;c++){
     const cell=sheet.getRow(n).getCell(c),value=cell.value;
     if(value==null)row.push('');
     else if(typeof value==='string'&&value.length<=2600)row.push(value);
     else if(typeof value==='number'&&Number.isFinite(value))row.push(cell.text);
     else if(typeof value==='boolean')row.push(String(value));
     else throw Error('FORMULA');
    }
    if(row.some(v=>v.trim()))grid.push(row);
   }
   if(grid.length<2)throw Error('WORKBOOK');return {name:sheet.name,grid};
  });
  self.postMessage({sheets});
 }catch(error){self.postMessage({error:error.message==='FORMULA'?'FORMULA':'WORKBOOK'});}
};
