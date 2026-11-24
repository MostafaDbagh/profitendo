import {Pencil,Plus,Upload} from 'lucide-react';
import RequiredMark from '../RequiredMark';
import TableToolbar, { TableCsvButton } from '../business-v2/TableToolbar';
import CopyableCode from '@/components/CopyableCode';
import { Info, X, ChevronDown, ScanBarcode } from 'lucide-react';
import {downloadCsv} from '../completion-v2/Shared';
import { unitLabel } from '../catalogue-v2/units';
import ProductAssets from './ProductAssets';
import References from './References';
import { useRef, useState } from 'react';
import { useLiveSearch, useResource } from '../business-v2/useBusinessApi';
import { Feedback, Modal, Pager, Select, Table, buttonClass, primaryClass, panelClass } from '../business-v2/UI';
import ProductForm from './ProductForm';
import ProductImport from './ProductImport';
import CatalogueSearch from './CatalogueSearch';
export default function Catalogue({context,api,c,lang,reload:refreshContext,initialAction}){
  const path=`/businesses/${context.business.id}/products`,cost=context.permissions['catalogue.cost'],manage=context.permissions['catalogue.edit'],create=context.permissions['catalogue.create'];
  const [page,setPage]=useState(1),[state,setState]=useState('active'),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[scan,setScan]=useState(''),[found,setFound]=useState(null),[scanError,setScanError]=useState(''),[scanning,setScanning]=useState(false),[edit,setEdit]=useState(() => ['new','setup'].includes(initialAction) && create && cost ? {product:null} : null),[importing,setImporting]=useState(false),[notice,setNotice]=useState('');
  const [filter,setFilter]=useState('all'),[exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
  const stock=context.permissions['inventory.view']&&context.permissions['locations.view'],sales=context.permissions['sales.view']&&context.permissions['locations.view'];
  const quantity=value=>new Intl.NumberFormat(lang==='ar'?'ar-u-nu-latn':'en',{maximumFractionDigits:4}).format(Number(value??0));
  const insightsPath=`${path}/insights?page=${page}&state=${state}&search=${encodeURIComponent(query)}&filter=${filter}`;
  useLiveSearch(search,query,setQuery,setPage);
  async function exportRows(){setExporting(true);setExportError('');try{downloadCsv(await api(`${insightsPath}&export=true&lang=${lang==='ar'?'ar':'en'}`));}catch(e){setExportError(e.message);}finally{setExporting(false);}}
  const [assets,setAssets]=useState(null),[references,setReferences]=useState(false);
  const [stockProduct,setStockProduct]=useState(null);
  const trigger=useRef(null),scanRef=useRef(null);
  const {data,error,reload}=useResource(api,insightsPath);
  const currentResults=query===search.trim()?data:null;
  const checkAllProducts=Boolean(query&&currentResults?.items.length===0&&(state!=='all'||filter!=='all'));
  const allProducts=useResource(api,checkAllProducts?`${path}?state=all&page=1&search=${encodeURIComponent(query)}`:null);
  async function lookup(e){e.preventDefault();if(scanning)return;setScanning(true);setScanError('');setFound(null);try{const result=await api(`${path}/barcode?value=${encodeURIComponent(scan.trim())}`);setFound(result.product);setScan('');}catch(e){setScanError(e.message);}finally{setScanning(false);scanRef.current?.focus();}}
  function open(e,product){trigger.current=e.currentTarget;setNotice('');setEdit({product});}
  function applySearch(term){
    setSearch(term);
    setQuery(term);
    setPage(1);
  }
  function selectSuggestion(product){
    if(checkAllProducts){
      setState('all');
      setFilter('all');
    }
    applySearch(product.sku||product.name);
  }
  function addFromSearch(name,input){
    trigger.current=input;
    setNotice('');
    setEdit({product:null,name});
  }
  function finishProduct(saved=true){
    const created=saved&&!edit.product;
    setEdit(null);
    setFound(null);
    reload();
    setNotice(saved?'saved':'');
    if(created)refreshContext();
  }
  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold">{c('catalogue')}</h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {create&&cost&&<>
          <button type="button" className={primaryClass} onClick={e=>open(e,null)}><Plus aria-hidden="true" className="h-4 w-4 shrink-0"/>{c('addProduct')}</button>
          <button type="button" className={buttonClass} onClick={e=>{trigger.current=e.currentTarget;setImporting(true);}}><Upload aria-hidden="true" className="h-4 w-4 shrink-0"/>{c('importProducts')}</button>
        </>}

      </div>
    </div>
    {context.permissions['catalogue.manage']&&<button className={buttonClass} onClick={e=>{trigger.current=e.currentTarget;setReferences(true);}}>{lang==='ar'?'الفئات والوحدات':'Categories & units'}</button>}
    <details className={`${panelClass} group !p-0`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 group-open:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
            <ScanBarcode aria-hidden="true" className="h-5 w-5" />
          </span>
          {lang==='ar'?'الماسح الضوئي':'Barcode scanner'}
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500 motion-safe:transition-transform group-open:rotate-180" />
      </summary>
      <form onSubmit={lookup} className="space-y-3 border-t border-slate-200 px-4 pb-4 pt-3"><label htmlFor="catalogue-scan" className="block text-sm font-medium text-slate-700">{lang==='ar'?'الباركود أو رمز الصنف':'Barcode or SKU'}<RequiredMark/></label><div className="flex flex-wrap gap-2"><input ref={scanRef} id="catalogue-scan" aria-label={lang==='ar'?'الباركود أو رمز الصنف':'Barcode or SKU'} className="flex-1 min-w-0 px-3 py-2.5 rounded-lg border border-slate-200 text-sm placeholder:text-slate-500 focus:ring-2 focus:ring-emerald-500" dir="ltr" placeholder="001234567890" value={scan} onChange={e=>setScan(e.target.value)} maxLength={128} required/><button className={buttonClass} disabled={scanning}>{c(scanning?'loading':'findProduct')}</button></div><p className="text-xs text-slate-500">{lang==='ar'?'رمز الصنف (SKU): رمز داخلي لتنظيم منتجاتك، مثل MOCK-001. الباركود: الرمز المقروء بالماسح والموجود عادةً على العبوة. يمكنك البحث بأيٍّ منهما هنا وفي المشتريات.':'SKU: your internal product code, such as MOCK-001. Barcode: the scannable code usually printed on the packaging. You can use either here and in Purchases.'}</p><Feedback error={scanError} c={c}/>{found&&<div className="flex items-center gap-2"><p role="status" className="text-sm text-emerald-700">{c('productFound')}: {found.name} · <CopyableCode>{found.sku}</CopyableCode></p><button type="button" onClick={()=>setFound(null)} aria-label={lang==='ar'?'إخفاء نتيجة البحث':'Dismiss search result'} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><X aria-hidden="true" className="h-4 w-4" /></button></div>}</form>
    </details>
    <TableToolbar
      search={<CatalogueSearch {...{c,lang}} value={search} onChange={setSearch} onSearch={applySearch}
        results={checkAllProducts?allProducts.data:currentResults}
        failed={query===search.trim()&&Boolean(error||allProducts.error)}
        onSelect={selectSuggestion} onAdd={create&&cost?addFromSearch:undefined}/>}
      filtersActive={state!=='active'||filter!=='all'}
      filters={<div className="flex flex-wrap items-end gap-3">
        <Select id="catalogue-state" label={c('status')} value={state} onChange={event=>{setState(event.target.value);setPage(1);}}>
          {['active','inactive','all'].map(value=><option key={value} value={value}>{c(value)}</option>)}
        </Select>
        <Select id="catalogue-filter" label={lang==='ar'?'عرض المنتجات':'Product view'} value={filter}
          onChange={event=>{setFilter(event.target.value);setPage(1);}}>
          <option value="all">{c('all')}</option>
          {sales&&<option value="top">{lang==='ar'?'أكثر 10 منتجات مبيعاً':'Top 10 best sellers'}</option>}
          {stock&&<option value="low">{lang==='ar'?'مخزون منخفض':'Low stock'}</option>}
        </Select>
      </div>}
      exportAction={<TableCsvButton label={lang==='ar'?'تصدير كل النتائج CSV':'Export all results CSV'}
        disabled={exporting||!data} onClick={exportRows}/>}
    />
    <Feedback error={error||exportError} notice={notice} c={c} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}
    {data&&<><p className="text-xs text-slate-500">{c('pricesCurrency')}: {data.currency}</p><Table tools={false} tableClassName="min-w-[1500px] [&_td]:align-middle [&_td]:whitespace-nowrap" headers={['productName','category',...(sales?['productUnitsSold']:[]),...(stock?['productAvailableTotal']:[]),'sku','barcodeColumn','unit','sellingPrice',...(cost?['purchasePrice']:[]),...(sales?['productSaleCount']:[]),'status',...(manage?['actions']:[])]} empty={!data.items.length} c={c}>{data.items.map(p=><tr key={p.id}><td className="px-5 py-3 font-semibold min-w-[260px]">{p.name}</td><td className="px-5 py-3">{p.category?.trim() || '-'}</td>{sales&&<td className="px-5 py-3 font-semibold tabular"><bdi>{quantity(p.unitsSold)}</bdi></td>}{stock&&<td className="px-5 py-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>{c('productAvailable')}: <bdi className="font-semibold">{quantity(p.available)}</bdi></span>
        <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-500"
          aria-label={`${lang==='ar'?'تفاصيل المخزون':'Stock details'}: ${p.name}`}
          onClick={e=>{trigger.current=e.currentTarget;setStockProduct(p);}}>
          <Info aria-hidden="true" className="h-4 w-4"/>
        </button>
      </div>
    </td>}<td className="px-5 py-3 whitespace-nowrap"><CopyableCode>{p.sku}</CopyableCode></td><td className="px-5 py-3 whitespace-nowrap">{p.barcodes?.length?p.barcodes.map(barcode=><span key={barcode} className="block font-mono text-sm leading-6"><CopyableCode kind="barcode">{barcode}</CopyableCode></span>):<span className="text-xs text-slate-400">{lang==='ar'?'لم يُضف باركود':'No barcode added'}</span>}</td><td className="px-5 py-3">{unitLabel(p.unit,c)}</td>{['sellingPrice',...(cost?['purchasePrice']:[])].map(k=><td key={k} className="px-5 py-3 tabular"><span dir="ltr">{p[k]}</span></td>)}{sales&&<td className="px-5 py-3">{p.saleCount}</td>}<td className="px-5 py-3">{c(p.active?'active':'inactive')}</td>{manage&&<td className="px-5 py-3"><div className="flex items-center gap-2 whitespace-nowrap"><button className={buttonClass} onClick={e=>open(e,p)}><Pencil aria-hidden="true" className="h-4 w-4 shrink-0"/>{c('editProduct')}</button><button className={buttonClass} onClick={e=>{trigger.current=e.currentTarget;setAssets(p);}}>{lang==='ar'?'العبوات والصورة':'Packs & image'}</button></div></td>}</tr>)}</Table><Pager {...{data,setPage,c}}/></>}
    {stock&&stockProduct&&<Modal title={stockProduct.name} description={lang==='ar'?'المخزون المتاح حسب الموقع':'Available stock by location'}
      {...{c,lang}} returnFocus={trigger.current} close={()=>setStockProduct(null)}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
        <CopyableCode>{stockProduct.sku}</CopyableCode>
        <span>{c('productAvailable')}: <bdi className="font-semibold">{quantity(stockProduct.available)}</bdi> {unitLabel(stockProduct.unit,c)}</span>
      </div>
      {!!stockProduct.stockByLocation?.length&&<ul className="mt-1 space-y-1">
        {stockProduct.stockByLocation.map(location=>(
          <li key={location.id} className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${location.lowStock?'bg-red-50 text-red-800':stockProduct.active?'bg-emerald-50 text-emerald-800':'bg-slate-50 text-slate-600'}`}>
            <bdi>{location.name}</bdi>
            <bdi className="font-semibold tabular-nums">{quantity(location.available)}</bdi>
            {location.lowStock&&<span className="sr-only">{lang==='ar'?'مخزون منخفض':'Low stock'}</span>}
          </li>
        ))}
      </ul>}
      {!stockProduct.stockByLocation?.length&&<p className="mt-1 text-xs text-slate-500">{lang==='ar'?'لا تتوفر تفاصيل المواقع':'No location details available'}</p>}
    </Modal>}
    {references&&<References canDelete={context.permissions['catalogue.delete']} {...{path,api,c,lang}} returnFocus={trigger.current} close={()=>setReferences(false)}/>}
    {assets&&<ProductAssets canDelete={context.permissions['catalogue.delete']} product={assets} {...{path,api,c,lang}} returnFocus={trigger.current} close={()=>{setAssets(null);reload();}}/>}
    {importing&&<ProductImport businessId={context.business.id} {...{api,c,lang}} returnFocus={trigger.current} close={()=>{setImporting(false);reload();}} done={()=>{setImporting(false);refreshContext();}}/>}
    {edit&&<ProductForm canDelete={context.permissions['catalogue.delete']} product={edit.product} initialName={edit.name} {...{cost,path,api,c,lang}} returnFocus={trigger.current} close={()=>setEdit(null)} done={finishProduct}/>}
  </section>;
}
