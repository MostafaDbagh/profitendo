// Strict CSV parsing keeps identifiers as text and rejects incomplete files atomically.
export function parseReceiptCsv(text, cost, includeDetails=false) {
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 const source=text.replace(/^\uFEFF/,'');
 for(let i=0;i<source.length;i++){
  const ch=source[i];
  if(quoted){if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
  if(ch==='"'&&!cell&&!closed){quoted=true;continue;}
  if(ch===','||ch==='\n'||ch==='\r'){
   row.push(cell);cell='';closed=false;
   if(ch!==','){if(row.some(v=>v.trim()))rows.push(row);row=[];if(ch==='\r'&&source[i+1]==='\n')i++;}
  }else{if(closed||ch==='"')throw new Error('CSV');cell+=ch;}
 }
 if(quoted)throw new Error('CSV');
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 const headers=rows.shift()?.map(v=>v.trim());
 const aliases={'رمز الصنف':'sku','اسم المنتج':'name','الوحدة الأساسية':'unit','الكمية':'quantity','تكلفة الوحدة':'unit_cost',product_name:'name'};
 const keys=headers?.map(header=>aliases[header]??header);
 if(!keys||!keys.includes('sku')||!keys.includes('quantity')||new Set(keys).size!==keys.length||keys.some(key=>!['sku','name','unit','quantity',...(cost?['unit_cost']:[])].includes(key)))throw new Error('HEADERS');
 if(!rows.length||rows.length>100)throw new Error('CSV');
 const seen=new Set();
 return rows.map((values,index)=>{
  const record=Object.fromEntries(keys.map((key,i)=>[key,values[i]?.trim()]));
  const {sku,quantity,unit_cost:unitCost}=record;
  if(values.length!==headers.length||!sku||sku.length>128||seen.has(sku.toUpperCase())||! /^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(quantity)||Number(quantity)<=0||(unitCost&&! /^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(unitCost)))throw new Error(`ROW:${index+2}`);
  seen.add(sku.toUpperCase());return {sku,quantity,...(includeDetails?{name:record.name??'',unit:record.unit??''}:{}),...(unitCost!==undefined?{unitCost}:{})};
 });
}
export function csvCell(value){const text=String(value??'');return '"'+(/^[\s]*[=+\-@]/.test(text)?"'":'')+text.replaceAll('"','""')+'"';}
export function receiptCsv(lines,cost,lang='en'){
 const keys=['sku','name','unit','quantity',...(cost?['unitCost']:[])];
 const labels=lang==='ar'?['رمز الصنف','اسم المنتج','الوحدة الأساسية','الكمية',...(cost?['تكلفة الوحدة']:[])]:['sku','name','unit','quantity',...(cost?['unit_cost']:[])];
 const units={PIECE:'قطعة',BOX:'علبة',CARTON:'كرتون',KG:'كيلوغرام',GRAM:'غرام',LITRE:'لتر',METRE:'متر'};
 return [labels.join(','),...lines.map(line=>keys.map(key=>csvCell(key==='unit'&&lang==='ar'?(units[line.unit]??line.unit):line[key])).join(','))].join('\r\n');
}
const decimalKey=(value='')=>value.includes('.')?value.replace(/0+$/,'').replace(/\.$/,''):value;

async function findReceiptProduct(api, root, sku) {
 const code=encodeURIComponent(sku);
 try {
  const {product}=await api(`${root}/products/barcode?value=${code}`);
  if(product.sku?.toUpperCase()===sku)return product;
 } catch(error) {
  if(error.message!=='PRODUCT_CODE_AMBIGUOUS')throw error;
 }
 // A barcode can match another product's SKU. Only accept the exact SKU.
 for(let page=1;page<=10000;page++){
  const data=await api(`${root}/products?state=active&page=${page}&search=${code}`);
  const product=data.items?.find(item=>item.sku?.toUpperCase()===sku);
  if(product)return product;
  if(!data.items?.length||page*data.pageSize>=data.total)break;
 }
 throw new Error('PRODUCT_NOT_FOUND');
}

export async function resolveReceiptRows(rows, api, root, existing, cost=false) {
 const result=[];
 const bySku=new Map(existing.filter(line=>line.sku).map(line=>[line.sku.toUpperCase(),line]));
 const ids=new Set(existing.map(line=>line.productId));
 for(const [index,row] of rows.entries()){
  const sku=row.sku.toUpperCase(), current=bySku.get(sku);
  if(current){
   const sameQuantity=decimalKey(current.quantity)===decimalKey(row.quantity);
   const sameCost=row.unitCost===undefined||decimalKey(current.unitCost)===decimalKey(row.unitCost);
   if(!sameQuantity||!sameCost)throw new Error(`CONFLICT:${index+2}`);
   continue;
  }
  let product;
  try{product=await findReceiptProduct(api,root,sku);}
  catch(error){
   if(['PRODUCT_NOT_FOUND','PRODUCT_INACTIVE'].includes(error.message))throw new Error(`PRODUCT:${index+2}:${row.sku}`);
   throw error;
  }
  if(ids.has(product.id))throw new Error(`CONFLICT:${index+2}`);
  ids.add(product.id);
  result.push({productId:product.id,name:product.name,sku:product.sku,unit:product.unit,quantity:row.quantity,unitCost:row.unitCost??(cost?product.purchasePrice??'':'')});
 }
 if(existing.length+result.length>100)throw new Error('CSV');
 return result;
}
