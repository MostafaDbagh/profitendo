const { parentPort, workerData } = require('node:worker_threads');
const Excel = require('exceljs');
const yauzl = require('yauzl');
// Parsing runs off the request thread, under a memory limit and parent timeout.
async function inspectZip(buffer) {
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, {lazyEntries:true, validateEntrySizes:true}, (error,zip) => {
      if(error) return reject(error);
      let entries=0,declared=0,actual=0;const names=new Set();
      const fail=()=>{zip.close();reject(new Error('INVALID_WORKBOOK'));};
      zip.on('error',fail);zip.on('end',resolve);
      zip.on('entry',entry=>{
        const name=entry.fileName;
        declared+=entry.uncompressedSize;
        if(++entries>100 || declared>8*1024*1024 || names.has(name) || entry.isEncrypted()
          || /vbaProject|externalLinks|embeddings|^xl\/media\//i.test(name)) return fail();
        names.add(name);
        if(name.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entry,(error,stream)=>{
          if(error) return fail();
          stream.on('error',fail);
          stream.on('data',chunk=>{actual+=chunk.length;if(actual>8*1024*1024){stream.destroy();fail();}});
          stream.on('end',()=>zip.readEntry());
        });
      });zip.readEntry();
    });
  });
}
(async()=>{
  const buffer=Buffer.from(workerData);await inspectZip(buffer);
  const workbook=new Excel.Workbook();await workbook.xlsx.load(buffer);
  if(workbook.worksheets.length!==1)throw new Error('ONE_SHEET_REQUIRED');
  const sheet=workbook.worksheets[0];
  if(sheet.rowCount>501 || sheet.columnCount>12 || sheet.model.merges.length)throw new Error('WORKBOOK_LIMIT');
  const rows=[];
  for(let n=1;n<=sheet.rowCount;n++){
    const values=[];let invalid=false;
    for(let c=1;c<=12;c++){
      const value=sheet.getRow(n).getCell(c).value;
      if(value===null || value===undefined)values.push('');
      else if(typeof value==='string' && value.length<=2600)values.push(value.trim());
      else if(typeof value==='number' && Number.isFinite(value))values.push(value);
      else if(typeof value==='boolean')values.push(value?'true':'false');
      else {invalid=true;values.push('');} // No formulas, cached results, links, dates or rich text.
    }
    if(n===1 || invalid || values.some(v=>v!==''))rows.push({row:n,values,invalid});
  }
  parentPort.postMessage({rows});
})().catch(()=>parentPort.postMessage({error:'INVALID_WORKBOOK'}));
