import { useState } from 'react';

export default function OwnerPinField({ id, label, hint, value, onChange, disabled, children }) {
  const [cursor, setCursor] = useState(0);
  const slots = Math.max(6, value.length);
  const activeSlot = Math.min(cursor, slots - 1);

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label>
      <div className={children ? 'flex flex-col gap-3 sm:flex-row sm:items-center' : undefined}>
        <div dir="ltr" className="relative min-w-0 flex-1">
          <input
            id={id}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            required
            minLength={4}
            maxLength={8}
            pattern="[0-9]{4,8}"
            aria-describedby={`${id}-hint`}
            disabled={disabled}
            value={value}
            onChange={event => {
              const input = event.currentTarget;
              onChange(input.value.replace(/[^0-9]/g, ''));
              setCursor(input.selectionStart ?? input.value.length);
            }}
            onPaste={event => {
              const digits = event.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 8);
              event.preventDefault();
              if (!digits) return;
              onChange(digits);
              setCursor(digits.length);
            }}
            onSelect={event => setCursor(event.currentTarget.selectionStart ?? value.length)}
            className="peer absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
          />
          <div aria-hidden="true" className="flex gap-1.5 sm:gap-2 peer-disabled:opacity-60 [&>span[data-active=true]]:peer-focus-visible:border-emerald-500 [&>span[data-active=true]]:peer-focus-visible:ring-2 [&>span[data-active=true]]:peer-focus-visible:ring-emerald-500">
            {Array.from({ length: slots }, (_, index) => (
              <span key={index} data-active={index === activeSlot} className="flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg text-slate-900">
                {value[index] && '•'}
              </span>
            ))}
          </div>
        </div>
        {children}
      </div>
      <p id={`${id}-hint`} className="text-xs text-slate-500">{hint}</p>
    </div>
  );
}
