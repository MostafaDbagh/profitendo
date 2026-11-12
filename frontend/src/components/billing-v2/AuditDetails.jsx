const fields={code:'code',name:'nameEn',nameAr:'nameAr',priceMinor:'price',currency:'currency',interval:'interval',trialDays:'trialDays',maxMembers:'maxMembers',maxWarehouses:'maxWarehouses',maxShops:'maxShops'};
export default function AuditDetails({row,c,lang}){
 const changes=row.changes||{};
 const value=(k,v,source)=>k==='priceMinor'?(v===null?c('trialOnly'):new Intl.NumberFormat(lang,{style:'currency',currency:source.currency||'USD'}).format(v/100)):k==='interval'?c(v):String(v??'—');
 if(changes.reason)return <p className="break-words">{changes.reason}</p>;
 if(typeof changes.before==='boolean')return <p>{c(changes.before?'published':'draft')} → {c(changes.after?'published':'draft')}</p>;
 const current=changes.after&&typeof changes.after==='object'?changes.after:changes;
 const keys=Object.keys(fields).filter(k=>k in current&&(!changes.before||current[k]!==changes.before[k]));
 return keys.length?<dl className="space-y-1">{keys.map(k=><div key={k}><dt className="inline font-medium">{c(fields[k])}: </dt><dd className="inline">{changes.before&&<>{c('before')} {value(k,changes.before[k],changes.before)} · {c('after')} </>}{value(k,current[k],current)}</dd></div>)}</dl>:<span>—</span>;
}
