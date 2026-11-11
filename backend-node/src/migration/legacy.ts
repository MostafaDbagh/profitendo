import {createHash} from 'node:crypto';
// Read-only compatibility analysis of the legacy /api/backup/export v1 format.
// No password/account import and no automatic warehouse allocation are attempted.
export function analyzeLegacy(raw:string){
 const input=JSON.parse(raw);if(input?.meta?.app!=='ProfitLens'||input?.meta?.format_version!==1||typeof input.meta.business_id!=='string'||!input.data||!Array.isArray(input.data.products))throw new Error('Unsupported ProfitLens v1 export');
 if(input.data.business?.business_id&&input.data.business.business_id!==input.meta.business_id)throw new Error('Business metadata mismatch');
 const bid=input.meta.business_id,issues:string[]=[],seen=new Set<string>(),products=[];
 for(const [index,p] of input.data.products.entries()){
  if(!p||typeof p!=='object')throw new Error('Invalid product row');if(p.business_id!==bid)throw new Error('Export contains another business');
  const sku=typeof p.sku==='string'?p.sku.trim().toUpperCase():'',qty=String(p.stock_qty??0),cost=String(p.product_cost??0),price=String(p.selling_price??0);
  if(!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(sku)||seen.has(sku))issues.push(`Product row ${index+1}: missing, invalid or duplicate SKU`);seen.add(sku);
  if(!/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(qty))issues.push(`Product row ${index+1}: negative or unsupported stock quantity`);
  if(![cost,price].every(v=>/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(v)))issues.push(`Product row ${index+1}: cost or price needs manual precision review`);
  products.push({legacyProductId:p.product_id??null,sku,name:p.name??'',legacyStock:qty,purchaseCost:cost,sellingPrice:price,currency:p.currency??input.data.business?.base_currency??null,baseUnit:null,allocations:[]});
 }
 const collectionCounts:Record<string,number>={};for(const [key,value] of Object.entries(input.data)){if(Array.isArray(value)){collectionCounts[key]=value.length;for(const row of value)if(row&&typeof row==='object'&&'business_id' in row&&row.business_id!==bid)throw new Error('Export contains another business');}}
 return {sourceSha256:createHash('sha256').update(raw).digest('hex'),legacyBusinessId:bid,exportedAt:input.meta.exported_at??null,collectionCounts,issues,products,readyToPost:false,requiredDecisions:['Confirm business currency and base units','Map every SKU and explicitly allocate stock to warehouses/shops','Resolve export row caps against the source database counts','Keep legacy history read-only; do not replay it alongside opening balances','Reconcile supplier opening balances separately; automatic liability migration is not implemented']};
}
