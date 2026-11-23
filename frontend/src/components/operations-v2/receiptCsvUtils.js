// Strict CSV parsing keeps identifiers as text and rejects incomplete files atomically.
export function parseReceiptCsv(text, cost) {
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 const source=text.replace(/^\uFEFF/,'');
 for(let i=0;i<source.length;i++){
  const ch=source[i];
  if(quoted){if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
  if(ch==='"'&&!cell&&!closed){quoted=true;continue;}
  if(ch===','||ch==='\n'||ch==='\r'){
   row.push(cell);cell='';closed=false;
   if(ch!==','){if(row.some(v=>v.trim()))rows.push(row);row=[];if(ch==='\r'&&source[i+1]==='\n')i++;}
  }else{if(closed)throw new Error('CSV');cell+=ch;}
 }
 if(quoted)throw new Error('CSV');
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 const headers=rows.shift()?.map(v=>v.trim());
 if(!headers||headers.join(',')!==(cost?'sku,quantity,unit_cost':'sku,quantity')||!rows.length||rows.length>100)throw new Error('CSV');
 const seen=new Set();
 return rows.map((values,index)=>{
  const [sku,quantity,unitCost]=values.map(v=>v.trim());
  if(values.length!==headers.length||!sku||sku.length>128||seen.has(sku.toUpperCase())||! /^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(quantity)||Number(quantity)<=0||(cost&&! /^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(unitCost)))throw new Error(`ROW:${index+2}`);
  seen.add(sku.toUpperCase());return {sku,quantity,...(cost?{unitCost}:{})};
 });
}
export function csvCell(value){const text=String(value??'');return '"'+(/^[\s]*[=+\-@]/.test(text)?"'":'')+text.replaceAll('"','""')+'"';}
export function receiptCsv(lines,cost){return [(cost?['sku','quantity','unit_cost']:['sku','quantity']).join(','),...lines.map(l=>(cost?[l.sku,l.quantity,l.unitCost]:[l.sku,l.quantity]).map(csvCell).join(','))].join('\r\n');}
export async function resolveReceiptRows(rows,api,root,existing){
 const result=[],seen=new Set(existing.map(l=>l.productId));
 for(const row of rows){
  const {product}=await api(`${root}/products/barcode?value=${encodeURIComponent(row.sku)}`);
  if(product.sku.toUpperCase()!==row.sku.toUpperCase()||seen.has(product.id))throw new Error('DUPLICATE');
  seen.add(product.id);result.push({productId:product.id,name:product.name,sku:product.sku,unit:product.unit,quantity:row.quantity,unitCost:row.unitCost??''});
 }
 return result;
}
