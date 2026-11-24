import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, Check, MapPin, Plus} from 'lucide-react';
import {useLanguage} from '../../context/LanguageContext';
import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import {LocationChipGroup, locationIcons} from '../business-v2/LocationChips';
import {OptionalFields} from '../business-v2/Disclosure';
import useLocationOptions from '../business-v2/useLocationOptions';
import {Feedback, Pager, buttonClass, panelClass} from '../business-v2/UI';
import {Field} from '../auth-v2/Fields';
import {useLocalDraft, LocalDraftNotice} from '../../lib/localDraft';
import {discountPayload} from './discount';
import {addProduct, cartSummary, decimal, emptyLine, existingLine} from './cart';
import BarcodeField from './BarcodeField';
import SaleLine from './SaleLine';
import {money} from './Receipt';
import PaymentMethod, {needsReference} from './PaymentMethod';

const defaultPayment = {method:'CASH', received:'', reference:''};
export default function Editor({context, api, c, lang, doc, done, close}) {
  const {t} = useLanguage(), ar = lang === 'ar';
  const root = `/businesses/${context.business.id}`, path = `${root}/sales`;
  const [requestedShop,setShop] = useState(null), [shopPage,setShopPage] = useState(1);
  const [rows,setRows] = useState(() => doc?.lines.length ? doc.lines.map(existingLine) : [emptyLine()]);
  const currentRows = useRef(rows);
  const [customer,setCustomer] = useState(doc?.customerName || ''), [notes,setNotes] = useState(doc?.notes || '');
  const [payment,setPayment] = useState(defaultPayment), [barcode,setBarcode] = useState('');
  const [pending,setPending] = useState(0), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const clientKey = useRef(crypto.randomUUID()), lastRequest = useRef(null), saving = useRef(false);
  const itemsPanel = useRef(null);
  function replaceRows(next) {
    currentRows.current = next;
    setRows(next);
  }
  const draft = useLocalDraft(`sale:${doc?.id || 'new'}:${doc?.revision || 0}`, {
    shop:requestedShop, rows, customer, notes, barcode, clientKey:clientKey.current, fingerprint:lastRequest.current,
    // Omit default payment so drafts saved by previous versions restore with cash selected.
    ...(payment !== defaultPayment ? {payment} : {}),
  }, saved => {
    setShop(saved.shop); replaceRows(saved.rows.length ? saved.rows.map(existingLine) : [emptyLine()]);
    setCustomer(saved.customer); setNotes(saved.notes); setBarcode(saved.barcode); setPayment(saved.payment ?? defaultPayment);
    clientKey.current = saved.clientKey; lastRequest.current = saved.fingerprint;
  });
  const shops = useLocationOptions(api,doc ? null : `${root}/locations?state=active`);
  const availableShop = shops.items.find(item => item.id === requestedShop?.id);
  const shop = doc ? {id:doc.locationId,name:doc.locationName} : availableShop;
  const onlyShop = shops.items.length === 1 ? shops.items[0] : null;
  const unavailable = !doc && requestedShop && !availableShop && !shops.loading && !shops.error;
  const lines = rows.filter(row => row.productId), hasItems = lines.length > 0;
  useEffect(() => {
    if (!doc && !hasItems && !pending && !availableShop && (onlyShop || unavailable)) setShop(onlyShop);
  },[doc, hasItems, pending, availableShop, onlyShop, unavailable]);
  const locked = Boolean(doc || hasItems || pending || busy);
  const pageSize = shops.pageSize ?? 25;
  const options = locked && shop ? [shop] : shops.items.slice((shopPage-1)*pageSize,shopPage*pageSize);
  const lookupPath = `${path}/products?locationId=${shop?.id}`;
  const summary = cartSummary(lines,context.business);
  function change(key, patch) {
    const old = currentRows.current, row = old.find(line => line.key === key);
    if ('packId' in patch && old.some(other => other !== row && other.productId === row.productId && other.packId === patch.packId)) {
      setError('VALIDATION_ERROR'); return;
    }
    const reprice = 'quantity' in patch || 'discountPercent' in patch || 'packId' in patch;
    replaceRows(old.map(line => line === row ? {...line,...patch,...(reprice ? {legacyDiscount:undefined} : {})} : line));
  }
  function add(product, key) {
    replaceRows(addProduct(currentRows.current,product,key));
    setError('');
  }
  function select(product, key) {
    try { add(product,key); return true; } catch (err) { setError(err.message); return false; }
  }
  function addItem(reuseBlank = false) {
    const old = currentRows.current, blank = old.find(row => !row.productId);
    if ((!reuseBlank || !blank) && old.length < 100) replaceRows([...old,emptyLine()]);
    requestAnimationFrame(() => {
      const groups = itemsPanel.current?.querySelectorAll('[data-empty-line]');
      const group = groups?.[reuseBlank ? 0 : groups.length-1];
      group?.querySelector('input')?.focus();
    });
  }
  function remove(key) {
    const rest = currentRows.current.filter(row => row.key !== key);
    replaceRows(rest.length ? rest : [emptyLine()]);
    setError('');
  }
  async function submit(event, draftOnly = false) {
    event.preventDefault();
    if (saving.current || pending || !shop || !summary.valid || !draft.online) return;
    const dueNow = payment.method === 'CREDIT' ? '0' : summary.total;
    const received = payment.method === 'CASH' && payment.received ? payment.received : dueNow;
    if (!draftOnly && (decimal(received) === null || decimal(received) < decimal(dueNow) || (needsReference(payment.method) && !payment.reference.trim()))) {
      setError(payment.method === 'OTHER' && !payment.reference.trim() ? 'PAYMENT_DESCRIPTION_REQUIRED' : 'PAYMENT_INVALID'); return;
    }
    saving.current = true; setBusy(true); setError('');
    const content = {customerName:customer, notes, lines:lines.map(row => ({
      productId:row.productId, packId:row.packId, quantity:row.quantity,
      ...discountPayload({...row,discountPercent:row.discountPercent || '0'}), discountReason:row.discountReason,
    }))};
    const fingerprint = JSON.stringify({...content,locationId:shop.id});
    if (lastRequest.current !== fingerprint) { clientKey.current = crypto.randomUUID(); lastRequest.current = fingerprint; }
    draft.checkpoint({clientKey:clientKey.current,fingerprint});
    let quote;
    const tender = {method:payment.method, received, reference:payment.reference};
    const checkoutKey = crypto.randomUUID();
    try {
      quote = await api(doc ? `${path}/${doc.id}` : path, {method:doc ? 'PATCH' : 'POST',
        body:doc ? {...content, revision:doc.revision} : {...content, locationId:shop.id, clientKey:clientKey.current}});
      if (draftOnly || quote.status === 'COMPLETED') { draft.clear(); done(quote,{payment:tender}); return; }
      if (quote.status !== 'DRAFT' || !quote.capabilities.checkout) throw new Error('SALE_STATE');
      if (quote.currency !== summary.currency || ['subtotal','discount','tax','total'].some(k => decimal(quote[k]) !== decimal(summary[k]))) throw new Error('TOTAL_CHANGED');
      const result = await api(`${path}/${quote.id}/checkout`, {method:'POST',body:{
        revision:quote.revision, expectedTotal:quote.total, confirm:true, payment:tender, clientKey:checkoutKey,
      }});
      draft.clear(); done(result);
    } catch (err) {
      // Recover the existing server draft, including the idempotency key if a payment response was lost.
      if (quote) { draft.clear(); done(quote,{payment:tender,error:err.message,checkoutKey}); }
      else setError(err.message);
    } finally {saving.current = false; setBusy(false);}
  }
  const blocked = !shop || busy || pending > 0;
  return <PageLayout as="div" className="w-full max-w-4xl">
    <button type="button" className="inline-flex items-center gap-2 rounded text-sm text-slate-500 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-emerald-500" disabled={busy || pending>0} onClick={close}>
      <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true"/>{t('back')}
    </button>
    <PageHeader title={doc ? c('saleEdit') : t('newSale')} heading="h1"/>
    <div className="space-y-2">
      <LocationChipGroup label={c('chooseLocation')} required>
        {options.map(option => {const Icon = locationIcons[option.kind] ?? MapPin, selected = option.id === shop?.id;
          return <button type="button" key={option.id} aria-pressed={selected} disabled={locked} onClick={() => setShop(option)}
            className={`${buttonClass} !rounded-full aria-pressed:border-emerald-300 aria-pressed:bg-emerald-50 aria-pressed:text-emerald-800 disabled:!opacity-100`}>
            <Icon aria-hidden="true"/><bdi className="min-w-0 break-words">{option.name}</bdi>{selected && <Check aria-hidden="true"/>}
          </button>;})}
      </LocationChipGroup>
      {!doc && <Feedback error={shops.error} c={c} retry={shops.reload}/>}
      {!doc && shops.loading && <LoadingState>{c('loading')}</LoadingState>}
      {!doc && !shops.loading && !shops.error && !shops.items.length && <p role="status">{ar ? 'لا توجد مواقع متاحة للبيع.' : 'No locations are available for sales.'}</p>}
      {unavailable && hasItems && <p role="status">{ar ? 'لم يعد موقع المسودة متاحًا. أزل أصنافها لاختيار موقع آخر.' : 'The draft location is no longer available. Remove its items to choose another location.'}</p>}
      {!locked && shops.items.length>pageSize && <Pager data={{page:shopPage,pageSize,total:shops.items.length}} setPage={setShopPage} c={c}/>}
    </div>
    <fieldset disabled={busy} className={`${panelClass} grid min-w-0 sm:p-6 gap-4 sm:grid-cols-2`}>
      <Field id="sale-customer" form="sale-entry" label={t('customer')} placeholder={t('customerPh')} value={customer} onChange={e=>setCustomer(e.target.value)} maxLength={150}/>
      <PaymentMethod {...{lang,c}} form="sale-entry" method={payment.method} reference={payment.reference}
        onMethod={method=>setPayment({...defaultPayment,method})} onReference={reference=>setPayment({...payment,reference})}/>
    </fieldset>
    <BarcodeField key={shop?.id || ''} {...{api,lookupPath,lang,c,add}} value={barcode} onChange={setBarcode} disabled={!shop || busy}
      onPending={setPending} onManual={()=>addItem(true)}/>
    <form id="sale-entry" onSubmit={submit} className="space-y-6">
      <fieldset ref={itemsPanel} disabled={busy || pending>0} className={`${panelClass} min-w-0 sm:p-6`}>
        <h3 className="mb-4 font-bold text-slate-900">{t('itemsLabel')}</h3>
        <div className="space-y-3">{rows.map((row,index) => <div key={row.key} data-empty-line={!row.productId || undefined}>
          <SaleLine {...{row,index,context,api,root,c,lang,lookupPath,select,change,summary}} disabled={blocked} remove={()=>remove(row.key)}/>
        </div>)}</div>
        <button type="button" className={`${buttonClass} mt-4 border-dashed`} disabled={blocked || rows.length>=100} onClick={()=>addItem()}>
          <Plus aria-hidden="true"/>{t('addItem')}</button>
      </fieldset>
      <Feedback {...{c,error}}/>
      <div className={`${panelClass} flex flex-wrap items-center justify-between gap-4 !border-emerald-100`}>
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          {[['subtotal','subtotalLabel'],['discount','lineDiscount'],...(decimal(summary.tax)>0n ? [['tax','saleTax']] : []),['total','grandTotal']].map(([key,label]) =>
            <div key={key}><dt className="text-xs text-slate-500">{key==='tax' ? c(label) : t(label)}</dt>
              <dd data-testid={`sale-${key}`} className={key==='total' ? 'text-xl font-extrabold text-emerald-600' : 'font-bold text-slate-900'}><bdi>{money(summary[key],summary,lang)}</bdi></dd></div>)}
        </dl>
        <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-500 px-8 py-3 text-sm font-semibold text-white hover:bg-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60" data-testid="sale-confirm" disabled={blocked || !summary.valid || !draft.online}>{busy ? c('saving') : t('confirmSale')}</button>
        <div className="w-full empty:hidden"><LocalDraftNotice {...{draft,lang,busy:busy || pending>0}}/></div>
      </div>
      <OptionalFields hasValue={Boolean(notes || payment.received)}>
        <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field id="sale-notes" label={c('saleNotes')} value={notes} onChange={e=>setNotes(e.target.value)} maxLength={2000}/>
          {payment.method === 'CASH' && <Field id="sale-received" label={c('saleReceived')} value={payment.received} placeholder={summary.total}
            inputMode="decimal" pattern="(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?" onChange={e=>setPayment({...payment,received:e.target.value})}/>}
        </fieldset>
        <button type="button" onClick={e=>submit(e,true)} className={buttonClass} disabled={blocked || !summary.valid || !draft.online}>{ar ? 'حفظ كمسودة' : 'Save as draft'}</button>
      </OptionalFields>
    </form>
  </PageLayout>;
}
