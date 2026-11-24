import {useState} from 'react';
import {ChevronDown, Package, Trash2} from 'lucide-react';
import {useLanguage} from '../../context/LanguageContext';
import {inputClass} from '../auth-v2/Fields';
import {unitLabel} from '../catalogue-v2/units';
import {formatQuantity} from '../../lib/quantity';
import CopyableCode from '../CopyableCode';
import {selectInputOnFocus} from '../../lib/selectInputOnFocus';
import ProductSearch from '../operations-v2/ProductSearch';

const caption = 'mb-1 block text-xs font-medium text-slate-500';
export default function SaleLine({row, index, context, api, root, c, lang, lookupPath, disabled, select, change, remove, summary}) {
  const {t} = useLanguage();
  const [searching,setSearching] = useState(false), [query,setQuery] = useState('');
  const picked = Boolean(row.productId), canDiscount = context.permissions['sales.discount'];
  const showPicker = !picked || searching;
  function pick(product) {
    if (select(product, row.key)) { setSearching(false); setQuery(''); }
  }
  return <div data-testid={`sale-item-${index}`} className="relative grid min-w-0 grid-cols-2 items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 lg:grid-cols-[minmax(0,2.5fr)_minmax(0,.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
    <div className="col-span-2 min-w-0 pe-12 lg:col-span-1 lg:pe-0">
      {showPicker ? <ProductSearch {...{context, api, root, c, lang, lookupPath, disabled}} label={t('selectProduct')} selectCreated={false}
        maxLength={100} value={query} onTextChange={setQuery} onSelect={pick}/> :
        <><span className={caption}>{t('selectProduct')}</span>
          <button type="button" onClick={() => setSearching(true)} className={`${inputClass} flex items-center gap-2 text-start`}>
            <Package aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400"/><bdi className="min-w-0 flex-1 break-words">{row.name}</bdi><ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400"/>
          </button>
          {row.sku && <div className="mt-1 text-xs text-slate-500"><CopyableCode>{row.sku}</CopyableCode></div>}
        </>}
    </div>
    <div><label className={caption} htmlFor={`sale-quantity-${index}`}>{t('qtyLabel')}</label>
      <input id={`sale-quantity-${index}`} className={inputClass} {...selectInputOnFocus} inputMode="decimal" disabled={!picked}
        required pattern="(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?" value={row.quantity} onChange={e => change(row.key,{quantity:e.target.value})}/>
    </div>
    <div><label className={caption} htmlFor={`sale-pack-${index}`}>{t('unitType')}</label>
      <select id={`sale-pack-${index}`} className={inputClass} value={row.packId ?? ''} disabled={!picked} onChange={e => change(row.key,{packId:e.target.value || null})}>
        <option value="">{picked ? unitLabel(row.unit,c) : '—'}</option>
        {row.packs.map(pack => <option key={pack.id} value={pack.id}>{pack.name} ({formatQuantity(pack.baseQuantity)} {unitLabel(row.unit,c)})</option>)}
      </select>
    </div>
    <div><label className={caption} htmlFor={`sale-price-${index}`}>{c('salePrice')}</label>
      <input id={`sale-price-${index}`} className={`${inputClass} tabular-nums text-slate-600`} value={formatQuantity(row.unitPrice)} readOnly/>
    </div>
    {canDiscount && <div><label className={caption} htmlFor={`sale-discount-${index}`}>{t('lineDiscount')} (%)</label>
      <input id={`sale-discount-${index}`} className={inputClass} value={row.discountPercent} disabled={!picked} inputMode="decimal" {...selectInputOnFocus}
        pattern="(0|[1-9][0-9]?)(\.[0-9]{1,4})?|100(\.0{1,4})?" placeholder="0" onChange={e => change(row.key,{discountPercent:e.target.value})}/>
    </div>}
    <button type="button" onClick={remove} aria-label={`${c('saleRemove')}: ${row.name || index+1}`}
      className="absolute end-3 top-8 inline-flex h-11 w-11 items-center justify-center justify-self-end self-start rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-emerald-500 lg:static lg:col-start-6 lg:mt-5">
      <Trash2 aria-hidden="true" className="h-4 w-4"/>
    </button>
    <div className="col-span-full flex flex-wrap items-end justify-between gap-2 text-sm">
      <div className="w-full max-w-md"><span className={caption} id={`sale-line-total-${index}`}>{t('lineTotal')}</span>
        <output aria-labelledby={`sale-line-total-${index}`} className="flex h-11 items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white">
          <span className="flex items-center border-e border-slate-200 bg-slate-50 px-3 font-semibold text-slate-600">{summary.currency}</span>
          <bdi className="flex items-center px-4 text-lg font-extrabold tabular-nums text-emerald-700">{formatQuantity(summary.lines.get(row.key) ?? '0')}</bdi>
        </output>
      </div>
      {picked && row.available != null && <span className="text-xs text-slate-500">{c('saleAvailable')} · <bdi>{formatQuantity(row.available)}</bdi></span>}
    </div>
    {summary.shortStock.has(row.productId) && <p role="alert" className="col-span-full text-sm text-red-700">{c('INSUFFICIENT_STOCK')}</p>}
    {canDiscount && (Number(row.discountPercent)>0 || row.discountReason) && <div className="col-span-full">
      <label className={caption} htmlFor={`sale-reason-${index}`}>{c('saleReason')}</label>
      <input id={`sale-reason-${index}`} className={inputClass} value={row.discountReason} onChange={e=>change(row.key,{discountReason:e.target.value})}
        required={Number(row.discountPercent)>0} minLength={5} maxLength={500}/>
    </div>}
  </div>;
}
