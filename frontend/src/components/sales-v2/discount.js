const scaled=value=>{const [whole,fraction='']=String(value??'0').split('.');return BigInt(whole||'0')*10000n+BigInt(fraction.padEnd(4,'0'));};
// Retain the exact legacy amount until the user changes its rate, quantity or pack.
// This avoids rounding old documents merely by opening and saving their editor.
export function percentageRow(row) {
  if(row.discountPercent!=null)return row;
  let rate=0n;
  try {
    const factor=row.packs?.find(p=>p.id===row.packId)?.baseQuantity??row.factor??'1';
    const gross=row.gross!=null?scaled(row.gross):scaled(row.quantity)*scaled(factor)*scaled(row.unitPrice)/100000000n;
    if(gross>0n)rate=(scaled(row.discount)*1000000n+gross/2n)/gross;
  } catch { /* Incomplete local drafts remain editable. */ }
  return {...row,discountPercent:`${rate/10000n}.${String(rate%10000n).padStart(4,'0')}`,legacyDiscount:row.discount??'0'};
}
export function discountPayload(row) {
  return row.legacyDiscount!=null?{discount:row.legacyDiscount}:{discountPercent:row.discountPercent};
}
