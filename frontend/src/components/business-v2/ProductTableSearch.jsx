import { useEffect, useId, useRef, useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { primaryClass } from './UI';
import { TableSearchButton } from './TableToolbar';

const MAX_SUGGESTIONS = 8;

export default function ProductTableSearch({ id, c, lang, value, results, failed, onChange, onSearch, onSelect, onAdd }) {
  const listId = useId();
  const input = useRef(null);
  const option = useRef(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const term = value.trim();
  const matches = results?.items.slice(0, MAX_SUGGESTIONS) ?? [];
  const showPanel = open && Boolean(term) && !failed;
  const showOptions = showPanel && matches.length > 0;
  const active = showOptions ? matches[highlight] : undefined;

  useEffect(() => {
    option.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function close() {
    setOpen(false);
    setHighlight(-1);
  }

  function choose(product) {
    close();
    onSelect(product);
  }

  function handleKeys(event) {
    if (event.key === 'Escape' && showPanel) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key === 'Enter' && active) {
      event.preventDefault();
      choose(active);
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && term && matches.length) {
      event.preventDefault();
      setOpen(true);
      setHighlight(current => {
        if (event.key === 'ArrowUp') return current <= 0 ? matches.length - 1 : current - 1;
        return current >= matches.length - 1 ? 0 : current + 1;
      });
    }
  }

  return (
    <form className="relative flex min-w-0 items-end gap-2"
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}
      onSubmit={event => {
        event.preventDefault();
        setHighlight(-1);
        setOpen(Boolean(term));
        onSearch(term);
      }}>
      <div className="min-w-0 flex-1">
        <Field ref={input} id={id} label={c('searchProducts')} placeholder={c('productSearchPlaceholder')}
          value={value} maxLength={160} autoComplete="off" role="combobox" aria-autocomplete="list"
          aria-expanded={showOptions} aria-controls={showOptions ? listId : undefined}
          aria-activedescendant={active ? `${listId}-${highlight}` : undefined}
          onFocus={() => setOpen(true)} onKeyDown={handleKeys}
          onChange={event => {
            setOpen(true);
            setHighlight(-1);
            onChange(event.target.value);
          }}/>
      </div>
      <TableSearchButton label={c('search')} />
      {showPanel && <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white p-1 shadow-md">
        {!results && <p role="status" className="p-2 text-sm text-slate-500">{c('loading')}</p>}
        {results && !matches.length && <div className="space-y-2 p-3 text-center">
          <p role="status" className="text-sm text-slate-500">
            {lang === 'ar' ? 'لا توجد نتائج مطابقة' : 'No matching products'}
          </p>
          {onAdd && <button type="button" className={`${primaryClass} !px-2 sm:!px-4`}
            onClick={() => { close(); onAdd(term, input.current); }}>
            {c('addProduct')}
          </button>}
        </div>}
        {showOptions && <ul id={listId} role="listbox" aria-label={c('searchProducts')}
          className="max-h-64 overflow-y-auto overscroll-contain">
          {matches.map((product, index) => (
            <li key={product.id} id={`${listId}-${index}`} ref={index === highlight ? option : null}
              role="option" aria-selected={index === highlight}
              className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-3 py-2 text-sm hover:bg-emerald-50 aria-selected:bg-emerald-50 aria-selected:text-emerald-800"
              onMouseDown={event => event.preventDefault()} onClick={() => choose(product)}>
              <span className="min-w-0 break-words font-semibold">{product.name}</span>
              {product.sku && <bdi className="min-w-0 break-all text-xs text-slate-500">{product.sku}</bdi>}
            </li>
          ))}
        </ul>}
      </div>}
    </form>
  );
}
