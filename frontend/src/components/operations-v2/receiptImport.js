export const importFields=['sku','barcode','name','unit','quantity','unitCost','sellingPrice'];
export const fieldLabels={ar:['رمز الصنف','الباركود','اسم المنتج','الوحدة الأساسية','الكمية','تكلفة الوحدة','سعر البيع'],en:['SKU','Barcode','Product name','Base unit','Quantity','Unit cost','Selling price']};
const normalize=value=>String(value??'').normalize('NFKC').replace(/[\u200e\u200f\u061c\ufeff\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').trim().toLowerCase().replace(/[\s_\-/]+/g,'');
const aliases={sku:['sku','code','item code','product code','رمز الصنف','رمز المنتج','كود الصنف'],barcode:['barcode','باركود','الباركود'],name:['name','product','product name','item name','اسم المنتج','اسم الصنف','الصنف'],unit:['unit','uom','base unit','الوحدة','الوحدة الأساسية','وحدة القياس'],quantity:['quantity','qty','الكمية','كمية'],unitCost:['unit_cost','unit cost','cost','purchase price','تكلفة الوحدة','تكلفة الشراء','سعر الشراء','التكلفة'],sellingPrice:['selling price','sale price','سعر البيع']};
export const detectMapping=headers=>headers.map(header=>importFields.find(key=>aliases[key].some(alias=>normalize(alias)===normalize(header)))||'');
export function readCsvGrid(text){
 const source=text.replace(/^\uFEFF/,'');
 const first=source.split(/\r?\n/)[0];let quoted=false;const counts={',':0,';':0,'\t':0};
 for(let i=0;i<first.length;i++){if(first[i]==='"')quoted=!quoted;else if(!quoted&&first[i] in counts)counts[first[i]]++;}
 const delimiter=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
 const rows=[];let row=[],cell='',closed=false;quoted=false;
 for(let i=0;i<source.length;i++){
  const ch=source[i];
  if(quoted){if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
  if(ch==='"'&&!cell&&!closed){quoted=true;continue;}
  if(ch===delimiter||ch==='\n'||ch==='\r'){
   row.push(cell);cell='';closed=false;
   if(ch!==delimiter){if(row.some(v=>v.trim()))rows.push(row);row=[];if(ch==='\r'&&source[i+1]==='\n')i++;}
  }else{if(closed||ch==='"')throw Error('CSV');cell+=ch;}
 }
 if(quoted)throw Error('CSV');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 if(rows.length<2||rows.length>101||rows[0].length>100||rows.some(row=>row.length!==rows[0].length||row.some(cell=>cell.length>2600)))throw Error('CSV');
 return rows;
}
export function mappedRows(grid,mapping,cost){
 const keys=mapping.filter(Boolean);
 if(new Set(keys).size!==keys.length||!keys.includes('quantity')||!keys.some(k=>['sku','barcode','name'].includes(k))||(!cost&&keys.some(k=>['unitCost','sellingPrice'].includes(k))))throw Error('MAPPING');
 return grid.slice(1).map((values,index)=>({...Object.fromEntries(mapping.flatMap((key,i)=>key?[[key,String(values[i]??'').trim()]]:[])),sourceRow:index+2,skip:false}));
}
export function decimal(value){return String(value??'').trim().replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c<='٩'?0x660:0x6f0))).replace(/٫/g,'.');}
export function rowIssue(row,cost){
 if(!row.sku?.trim()&&!row.barcode?.trim()&&!row.name?.trim())return 'IDENTIFIER';
 if(!/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(decimal(row.quantity))||Number(decimal(row.quantity))<=0)return 'QUANTITY';
 if(cost&&['unitCost','sellingPrice'].some(key=>row[key]&&!/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(decimal(row[key]))))return 'COST';
 return '';
}
export const unitCode=value=>({قطعة:'PIECE',علبة:'BOX',كرتون:'CARTON',كيلوغرام:'KG',غرام:'GRAM',لتر:'LITRE',متر:'METRE'})[value]||String(value||'PIECE').toUpperCase();
const same=(a,b)=>decimal(a).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'')===decimal(b).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
export async function matchRow(row,api,root){
 if(row.product){const product=await api(`${root}/products/${row.product.id}`);return product;}
 // Strong identifiers take precedence; never silently fall back to a similar name.
 if(row.sku||row.barcode){
  const value=row.sku||row.barcode;
  try{const {product}=await api(`${root}/products/barcode?value=${encodeURIComponent(value)}`);
   if(!row.sku||product.sku?.toUpperCase()===row.sku.toUpperCase())return product;
  }catch(error){if(error.message==='PRODUCT_NOT_FOUND'||error.message==='PRODUCT_INACTIVE')return null;if(error.message!=='PRODUCT_CODE_AMBIGUOUS')throw error;if(!row.sku)throw Error('AMBIGUOUS');}
 }
 const term=row.sku||row.name; if(!term)throw Error('AMBIGUOUS');
 const found=[];
 for(let page=1;page<=25;page++){
  const data=await api(`${root}/products?state=active&page=${page}&search=${encodeURIComponent(term)}`);
  found.push(...data.items.filter(p=>row.sku?p.sku?.toUpperCase()===row.sku.toUpperCase():p.name?.normalize('NFKC').trim().toLowerCase()===row.name.normalize('NFKC').trim().toLowerCase()));
  if(found.length>1)throw Error('AMBIGUOUS');
  if(!data.items.length||page*data.pageSize>=data.total)return found[0]||null;
 }
 throw Error('AMBIGUOUS');
}
export async function inspectRows(rows,api,root,existing,cost){
 const seen=new Set(),result=[];let count=existing.length;
 for(const row of rows){
  if(row.skip){result.push({...row,status:'SKIPPED'});continue;}
  const issue=rowIssue(row,cost);if(issue){result.push({...row,status:issue});continue;}
  try{
   const product=await matchRow(row,api,root);
   if(!product||product.active===false){result.push({...row,status:'MISSING'});continue;}
   if(row.unit&&unitCode(row.unit)!==product.unit){result.push({...row,product,status:'UNIT'});continue;}
   if(seen.has(product.id)){result.push({...row,product,status:'DUPLICATE'});continue;}seen.add(product.id);
   const prior=existing.find(line=>line.productId===product.id);
   const quantity=decimal(row.quantity),unitCost=cost?decimal(row.unitCost||product.purchasePrice||''):'';
   const status=prior?(same(prior.quantity,quantity)&&(!cost||same(prior.unitCost,unitCost))?'EXISTS':'CONFLICT'):(++count>100?'LIMIT':cost&&!unitCost?'COST':'READY');
   result.push({...row,sku:row.sku||product.sku,name:row.name||product.name,unit:row.unit||product.unit,product,quantity,unitCost,status});
  }catch(error){result.push({...row,status:error.message==='AMBIGUOUS'?'AMBIGUOUS':'LOOKUP'});}
 }
 return result;
}
export const readyLines=rows=>rows.filter(row=>row.status==='READY').map(row=>({productId:row.product.id,sku:row.product.sku,name:row.product.name,unit:row.product.unit,quantity:row.quantity,unitCost:row.unitCost}));
export const canApply=rows=>rows.length>0&&rows.every(row=>['READY','SKIPPED','EXISTS'].includes(row.status));
