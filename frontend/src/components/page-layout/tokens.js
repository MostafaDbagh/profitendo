// Layout dimensions live in index.css. Palette, type and radius use the
// application's existing Tailwind theme and semantic color variables.
export const controlHeight = 'min-h-[var(--page-control-height)]';
export const stack = 'min-w-0 space-y-[var(--page-gap)]';
export const rowGap = 'gap-[var(--page-control-gap)]';
export const surface = 'rounded-lg border border-border bg-card';
export const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export const buttonClass = `inline-flex max-w-full items-center justify-center ${rowGap} ${controlHeight} rounded-lg border border-border bg-card px-4 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-muted ${focusRing} disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0`;
export const primaryTone = '!border-[hsl(var(--page-action))] !bg-[hsl(var(--page-action))] !text-primary-foreground hover:!bg-[hsl(var(--page-action-hover))]';
export const primaryClass = `${buttonClass} ${primaryTone}`;
export const panelClass = `${surface} p-[var(--page-panel-padding)] shadow-sm`;
export const fieldSurface = `${surface} ${controlHeight} text-sm`;

// Compact list actions retain a 36px target without the full form-button height.
export const rowButtonClass = `inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 ${focusRing} disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0`;
