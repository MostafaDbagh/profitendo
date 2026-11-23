export default function ReceiptSteps({stage,canConfirm,c}) {
 const steps=['receiptItems','receiptReview',canConfirm?'receiptStock':'receiptApproval'];
 return <ol aria-label={c('newReceipt')} className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
  {steps.map((key,index)=><li key={key} aria-current={stage===index?'step':undefined}
   className={`flex items-center gap-2 rounded-lg px-3 py-2 ${stage===index?'bg-emerald-50 font-semibold text-emerald-800':'text-slate-500'}`}>
   <span aria-hidden="true" className="shrink-0">{index+1}.</span>{c(key)}
  </li>)}
 </ol>;
}
