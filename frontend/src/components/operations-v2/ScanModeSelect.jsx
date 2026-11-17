import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

export default function ScanModeSelect({value,onChange,disabled,c,lang}) {
 const ar=lang==='ar';
 const options=[['once',ar?'إدخال الكمية يدوياً':'Enter quantity manually'],['repeat',ar?'زيادة الكمية مع كل مسح':'Add one per scan']];
 return <div className="min-w-0">
  <label id="receipt-scan-mode-label" htmlFor="receipt-scan-mode" className="block text-sm font-medium text-slate-700 mb-1.5">{c('scanMode')}</label>
  <Select.Root dir={ar?'rtl':'ltr'} value={value} onValueChange={onChange} disabled={disabled}>
   <Select.Trigger id="receipt-scan-mode" aria-labelledby="receipt-scan-mode-label" className="flex h-11 w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50">
    <Select.Value>{options.find(([key])=>key===value)?.[1]}</Select.Value><Select.Icon><ChevronDown className="h-4 w-4 shrink-0 text-slate-500"/></Select.Icon>
   </Select.Trigger>
   <Select.Portal><Select.Content position="popper" sideOffset={5} collisionPadding={12} className="z-50 w-[var(--radix-select-trigger-width)] max-h-[var(--radix-select-content-available-height)] overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
    <Select.Viewport>{options.map(([key,label])=><Select.Item key={key} value={key} className="relative cursor-default select-none rounded-md py-3 ps-3 pe-9 text-sm text-slate-700 outline-none data-[highlighted]:bg-emerald-50 data-[highlighted]:text-emerald-900">
     <Select.ItemText>{label}</Select.ItemText><Select.ItemIndicator className="absolute end-3 top-3.5 text-emerald-600"><Check className="h-4 w-4"/></Select.ItemIndicator>
    </Select.Item>)}</Select.Viewport>
   </Select.Content></Select.Portal>
  </Select.Root>
 </div>;
}
