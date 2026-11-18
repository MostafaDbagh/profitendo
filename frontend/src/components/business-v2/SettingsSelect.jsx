import { Children } from 'react';
import * as Dropdown from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export default function SettingsSelect({id,label,value,onChange,disabled,children}) {
  const {dir}=useLanguage();
  const options=Children.toArray(children);
  const placeholder=options.find(option=>option.props.value==='')?.props.children;
  return <div>
    <label id={id+'-label'} htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
    <Dropdown.Root dir={dir} value={value || ''} onValueChange={value=>onChange({target:{value}})} disabled={disabled}>
      <Dropdown.Trigger id={id} aria-labelledby={id+'-label'} className="flex w-full min-h-11 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 text-start hover:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-slate-400">
        <Dropdown.Value placeholder={placeholder}/><Dropdown.Icon><ChevronDown className="h-4 w-4 text-slate-500" aria-hidden="true"/></Dropdown.Icon>
      </Dropdown.Trigger>
      <Dropdown.Portal><Dropdown.Content position="popper" sideOffset={6} collisionPadding={12} className="z-50 w-[var(--radix-select-trigger-width)] max-h-[min(320px,var(--radix-select-content-available-height))] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 text-slate-900 shadow-lg">
        <Dropdown.Viewport>{options.filter(option=>option.props.value!=='').map(option=>{
          const optionValue=option.props.value ?? option.props.children;
          return <Dropdown.Item key={optionValue} value={optionValue} className="relative flex cursor-pointer select-none items-center min-h-11 rounded-lg ps-3 pe-9 py-2 text-sm outline-none data-[highlighted]:bg-slate-50 data-[state=checked]:bg-emerald-50 data-[state=checked]:text-emerald-800">
            <Dropdown.ItemText>{option.props.children}</Dropdown.ItemText>
            <Dropdown.ItemIndicator className="absolute end-3"><Check className="h-4 w-4" aria-hidden="true"/></Dropdown.ItemIndicator>
          </Dropdown.Item>;
        })}</Dropdown.Viewport>
      </Dropdown.Content></Dropdown.Portal>
    </Dropdown.Root>
  </div>;
}
