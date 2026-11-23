export default function SaleSteps({step,lang}) {
 const labels=lang==='ar'?['إضافة المنتجات','تحصيل الدفع','الإيصال']:['Add products','Take payment','Receipt'];
 return <ol aria-label={lang==='ar'?'خطوات البيع':'Sale steps'} className="grid grid-cols-3 gap-2 text-xs sm:text-sm print:hidden">
  {labels.map((label,index)=><li key={label} aria-current={index===step?'step':undefined}
   className={`flex items-center gap-2 rounded-lg px-2 py-2 ${index===step?'bg-emerald-50 font-semibold text-emerald-800':'text-slate-500'}`}>
   <span aria-hidden="true" className="shrink-0">{index+1}.</span><span>{label}</span>
  </li>)}
 </ol>;
}
