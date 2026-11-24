import { X } from 'lucide-react';
import { Children, Fragment, isValidElement, useId, useRef, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import TableToolbar, { TableCsvButton, TableSearchButton } from './TableToolbar';

function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (isValidElement(node) && !['button', 'input', 'select', 'textarea', 'svg'].includes(node.type)) {
    return text(node.props.children);
  }
  return '';
}

function flatten(nodes) {
  return Children.toArray(nodes).flatMap(node =>
    isValidElement(node) && node.type === Fragment ? flatten(node.props.children) : [node]
  );
}

function csv(value) {
  let cell = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(cell)) cell = "'" + cell;
  return '"' + cell.replaceAll('"', '""') + '"';
}

const fieldClass = 'mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-emerald-500';

export default function TableTools({
  headers, children, c, render, searchable = true, exportVisible = true,
  searchActions, searchContent, filters, filtersActive = false,
}) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const id = useId();
  const searchRef = useRef(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [column, setColumn] = useState('all');
  const [value, setValue] = useState('');

  const rows = Children.toArray(children);
  const cells = rows.map(row => flatten(row.props?.children).map(cell => text(cell)));
  const indexes = headers.map((_, index) => index).filter(index => !['actions', 'action'].includes(headers[index]));
  const values = column === 'all' ? [] : [...new Set(cells.map(row => row[Number(column)]?.trim()).filter(Boolean))].sort();
  const keyword = query.toLocaleLowerCase();
  const matchingIndexes = rows.map((_, index) => index).filter(index => {
    const row = cells[index];
    return indexes.map(key => (row[key] ?? '').trim()).join(' ').toLocaleLowerCase().includes(keyword)
      && (column === 'all' || !value || row[Number(column)]?.trim() === value);
  });
  const matching = matchingIndexes.map(index => rows[index]);

  function download() {
    const lines = [
      indexes.map(index => csv(c(headers[index]))).join(','),
      ...matchingIndexes.map(row => indexes.map(index => csv(cells[row][index])).join(',')),
    ];
    const url = URL.createObjectURL(new Blob(['\uFEFF', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'visible-results.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const searchLabel = ar ? 'بحث في الصفحة الحالية' : 'Search current page';
  const searchControl = searchContent || (searchable && (
    <form className="flex min-w-0 items-end gap-2" onSubmit={event => {
      event.preventDefault();
      setQuery(search.trim());
    }}>
      <div className="min-w-0 flex-1">
        <label htmlFor={id + 'search'} className="block text-sm">{searchLabel}</label>
        <div className="relative">
          <input ref={searchRef} id={id + 'search'} autoComplete="off" className={`${fieldClass} ${search || query ? 'pe-9' : ''}`}
            placeholder={ar ? 'اكتب كلمة للبحث…' : 'Type a keyword…'} value={search} onChange={event => setSearch(event.target.value)} />
          {(search || query) && <button type="button" aria-label={ar ? 'مسح البحث' : 'Clear search'}
            className="absolute end-0.5 top-1 inline-flex h-9 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-500"
            onClick={() => { setSearch(''); setQuery(''); searchRef.current?.focus(); }}>
            <X aria-hidden="true" className="h-4 w-4" />
          </button>}
        </div>
      </div>
      <TableSearchButton label={ar ? 'بحث' : 'Search'} />
    </form>
  ));

  return (
    <div className="space-y-3">
      <TableToolbar search={searchControl} filtersActive={filtersActive || Boolean(value)}
        exportAction={searchActions || (exportVisible && <TableCsvButton
          label={ar ? 'تصدير الصفحة CSV' : 'Export page CSV'} disabled={!matching.length} onClick={download} />)}
        filters={<>
          <div className="flex flex-wrap items-end gap-3">
            {filters || <>
              <label htmlFor={id + 'column'} className="min-w-0 max-w-full text-sm">
                {ar ? 'تصفية حسب' : 'Filter by'}
                <select id={id + 'column'} className={fieldClass} value={column} onChange={event => {
                  setColumn(event.target.value);
                  setValue('');
                }}>
                  <option value="all">{ar ? 'كل الأعمدة' : 'All columns'}</option>
                  {indexes.map(index => <option key={index} value={index}>{c(headers[index])}</option>)}
                </select>
              </label>
              {column !== 'all' && <label htmlFor={id + 'value'} className="max-w-full text-sm">
                {ar ? 'القيمة' : 'Value'}
                <select id={id + 'value'} className={fieldClass} value={value} onChange={event => setValue(event.target.value)}>
                  <option value="">{ar ? 'الكل' : 'All'}</option>
                  {values.map(option => <option key={option}>{option}</option>)}
                </select>
              </label>}
            </>}
          </div>
          {exportVisible && !searchActions && <p className="text-xs text-slate-500">
            {ar ? 'تصدير CSV يشمل نتائج الصفحة الحالية فقط.' : 'CSV export includes results on this page only.'}
          </p>}
        </>}
      />
      {(query || value) && <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <span role="status">{ar ? `عرض ${matching.length} من ${rows.length} في هذه الصفحة` : `Showing ${matching.length} of ${rows.length} on this page`}</span>
        {value && <button type="button" className="min-h-9 rounded px-2 font-semibold text-emerald-700 underline focus-visible:ring-2 focus-visible:ring-emerald-500"
          onClick={() => { setColumn('all'); setValue(''); }}>
          {ar ? 'إزالة تصفية العمود' : 'Clear column filter'}
        </button>}
      </div>}
      {render(matching, !matching.length)}
    </div>
  );
}
