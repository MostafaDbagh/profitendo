// Round gross, discount and tax per line using the sale currency's minor unit.
export function basketTotal(rows,business) {
  const digits=new Intl.NumberFormat('en',{style:'currency',currency:business.baseCurrency}).resolvedOptions().maximumFractionDigits;
  const quantum=10n**BigInt(4-digits);
  const round=(n,d)=>(n+d/2n)/d;
  function fixed(value) {
    const text=String(value);
    if(!/^\d+(\.\d{1,4})?$/.test(text))throw new RangeError('Incomplete amount');
    const [whole,fraction='']=text.split('.');
    return BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
  }
  try {
    let total=0n;
    for(const row of rows){
      const factor=row.packs.find(p=>p.id===row.packId)?.baseQuantity??'1';
      const units=fixed(row.quantity)*fixed(factor);
      if(units%10000n)return null;
      const gross=round(units/10000n*fixed(row.unitPrice),10000n*quantum);
      const discount=row.legacyDiscount!=null?fixed(row.legacyDiscount)/quantum:round(gross*fixed(row.discountPercent),1000000n);
      const net=gross-discount;
      if(net<0n)return null;
      total+=net+round(net*fixed(business.countryCode==='SY'?0:business.salesTaxRate??0),1000000n);
    }
    const amount=total*quantum;
    return `${amount/10000n}.${String(amount%10000n).padStart(4,'0')}`;
  }catch(error){if(error instanceof RangeError)return null;throw error;}
}
