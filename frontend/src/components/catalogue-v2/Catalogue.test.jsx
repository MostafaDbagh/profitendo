import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { businessCopy } from '../business-v2/copy';
import Catalogue from './Catalogue';
import {DraftScope} from '../../lib/localDraft';
import ProductForm from './ProductForm';

jest.mock('react-router-dom', () => ({ useNavigate: () => () => {} }), { virtual: true });
jest.mock('@/lib/quantity', () => ({ formatQuantity: value => String(value ?? '') }), { virtual: true });
jest.mock('@/lib/utils', () => jest.requireActual('../../lib/utils'), { virtual: true });
jest.mock('@/components/CopyableCode', () => ({ __esModule: true, default: ({ children }) => <span>{children}</span> }), { virtual: true });
jest.mock('../ui/dialog', () => ({
  Dialog: ({ children }) => <div role="dialog">{children}</div>,
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogDescription: ({ children }) => <p>{children}</p>,
}));

global.IS_REACT_ACT_ENVIRONMENT = true;
const milk = { id: 'milk', name: 'Milk', sku: '001-MILK', unit: 'PIECE', active: true, sellingPrice: '75.0000', purchasePrice: '50.0000', barcodes: ['00123','00456','00789'] };
const tea = { id: 'tea', name: 'Tea', sku: '002-TEA', unit: 'PIECE', active: false };
let host, root, paths, refreshContext;

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(window,'crypto',{configurable:true,value:{randomUUID:require('crypto').randomUUID}});
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  paths = [];
  refreshContext = jest.fn();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  jest.useRealTimers();
});

async function render(lang, canCreate = true, settings = {}) {
  localStorage.setItem('profitlens_lang', lang);
  const context = { business: { id: 'shop', ...settings.business }, permissions: { 'business.edit': Boolean(settings.onPatch), 'catalogue.create': canCreate, 'catalogue.cost': canCreate } };
  const api = async (path, options) => {
    const url = new URL(path, 'https://app.example.test');
    paths.push(url);
    if (url.searchParams.get('export') === 'true') return { filename: 'products.csv', csv: 'SKU,Name\r\n001-MILK,Milk' };
    if (url.pathname.endsWith('/product-imports/template')) return { filename: 'product-import-template.' + url.searchParams.get('format'), fileBase64: btoa('template') };
    if (options?.method === 'PATCH') return settings.onPatch(options.body);
    if (options?.method === 'POST') {
      expect(options.body.name).toBe('Lemon');
      return { id: 'lemon', sku: '003-LEMON', active: true };
    }
    const products = [milk, tea, ...(refreshContext.mock.calls.length ? [{ ...milk, id: 'lemon', sku: '003-LEMON', name: 'Lemon' }] : [])];
    const term = url.searchParams.get('search')?.toLowerCase() ?? '';
    const items = url.pathname.endsWith('/references') ? [] : products.filter(product =>
      (product.active || url.searchParams.get('state') === 'all') &&
      (product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term)));
    return { items, page: 1, pageSize: 25, total: items.length, currency: 'USD' };
  };
  const c = key => businessCopy[lang][key] ?? key;
  await act(async () => root.render(<LanguageProvider><Catalogue {...{ c, lang, api, context }} reload={refreshContext} /></LanguageProvider>));
  return host.querySelector('#catalogue-search');
}

function fill(input, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function type(input, value) {
  act(() => { input.focus(); fill(input, value); });
  await act(async () => jest.advanceTimersByTime(220));
}

function press(input, key) {
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
}

test('the Arabic products toolbar keeps search, options and export together while a suggestion is selected', async () => {
  const input = await render('ar');
  const toggle = host.querySelector('button[aria-controls]');
  const row = toggle.parentElement;
  expect(row.children[0].contains(input)).toBe(true);
  expect(row.children[1]).toBe(toggle);
  expect(row.children[2].querySelector('button').getAttribute('aria-label')).toBe('تصدير كل النتائج CSV');
  await type(input, 'Mil');
  expect(input.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('[role="option"]').textContent).toContain('001-MILK');
  press(input, 'ArrowDown');
  expect(host.querySelector('[aria-selected="true"]').id).toBe(input.getAttribute('aria-activedescendant'));
  await act(async () => press(input, 'Enter'));
  expect(input.value).toBe('001-MILK');
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  expect(paths.at(-1).searchParams.get('search')).toBe('001-MILK');
});

test('no match opens the product form with the typed name and saves it through the catalogue', async () => {
  const input = await render('en');
  await type(input, 'Lemon');
  const add = [...input.form.querySelectorAll('button')].find(button => button.textContent === 'Add product');
  expect(add).toBeDefined();
  await act(async () => add.click());
  const name = host.querySelector('#product-name');
  expect(name.value).toBe('Lemon');
  act(() => fill(host.querySelector('#product-purchasePrice'), '1'));
  await act(async () => name.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(refreshContext).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector('tbody').textContent).toContain('Lemon');
});

test('a product hidden by the active filter is still suggested instead of asking the user to add it', async () => {
  const input = await render('en');
  await type(input, 'Tea');
  expect(input.form.textContent).not.toContain('Add product');
  const suggestion = host.querySelector('[role="option"]');
  expect(suggestion.textContent).toContain('002-TEA');
  await act(async () => suggestion.click());
  expect(paths.at(-1).searchParams.get('state')).toBe('all');
  expect(host.querySelector('tbody').textContent).toContain('Tea');
});

test.each(['ar','en'])('compact catalogue keeps prices, additional barcodes and cost permissions intact (%s)',async lang=>{
 await render(lang);
 const body=host.querySelector('tbody');
 expect(body.textContent).toContain('75.00');
 expect(body.textContent).not.toContain('75.0000');
 expect(body.textContent).toContain('50.00');
 const disclosure=body.querySelector('details');
 expect(disclosure.open).toBe(false);
 act(()=>disclosure.querySelector('summary').click());
 expect(disclosure.open).toBe(true);
 expect(disclosure.textContent).toContain('00456');
 expect(disclosure.textContent).toContain('00789');
 await render(lang,false);
 expect(host.querySelector('thead').textContent).not.toContain(businessCopy[lang].purchasePrice);
 expect(host.querySelector('tbody').textContent).not.toContain('50.00');
});

test('a restored product form reuses its submission key after an unknown response', async () => {
  const context = {business:{id:'shop'},membershipId:'owner',permissions:{}};
  const api = jest.fn(async (path,options) => {
    if (options?.method) throw new Error('NETWORK_ERROR');
    return {items:[]};
  });
  const form = () => (
    <LanguageProvider><DraftScope.Provider value={context}>
      <ProductForm cost path="/products" api={api} lang="en" c={key=>key} close={()=>{}} done={()=>{}}/>
    </DraftScope.Provider></LanguageProvider>
  );
  await act(async()=>root.render(form()));
  act(()=>{fill(host.querySelector('#product-name'),'Lemon');fill(host.querySelector('#product-purchasePrice'),'1');});
  const submit = () => act(async()=>host.querySelector('#product-name').form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await submit();
  await act(async()=>root.render(null));
  await act(async()=>root.render(form()));
  expect(host.querySelector('#product-name').value).toBe('Lemon');
  await submit();
  act(()=>fill(host.querySelector('#product-purchasePrice'),'2'));
  await submit();
  const keys=api.mock.calls.filter(([,options])=>options?.method==='POST').map(([,options])=>options.body.clientKey);
  expect(keys).toHaveLength(3);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});

test('the catalogue rename action saves table and button labels together and displays them after reload', async () => {
  const onPatch=jest.fn();
  await render('ar',true,{business:{revision:3},onPatch});
  const trigger=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='إعادة تسمية أعمدة الجدول');
  act(()=>trigger.click());
  const form=document.querySelector('#label-catalogue_catalogue').form;
  act(()=>{
    fill(form.querySelector('#label-catalogue_catalogue'),'خدمات الحلاقة');
    fill(form.querySelector('#label-catalogue_productName'),'الخدمة');
    fill(form.querySelector('#label-addProduct'),'أضف حلاقة');
  });
  await act(async ()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  const patch=onPatch.mock.calls[0][0];
  expect(patch.revision).toBe(3);
  expect(patch.actionLabels.ar).toEqual({catalogue_catalogue:'خدمات الحلاقة',catalogue_productName:'الخدمة',addProduct:'أضف حلاقة'});
  await render('ar',true,{business:patch});
  expect(host.querySelector('h1,h2').textContent).toContain('خدمات الحلاقة');
  expect(host.querySelector('th').textContent).toContain('الخدمة');
  expect(Array.from(host.querySelectorAll('button')).some(button=>button.textContent.includes('أضف حلاقة'))).toBe(true);
});

test.each([false,true])('uses the standard export and import templates with custom catalogue labels enabled=%s', async custom => {
  const overrides = { catalogue_catalogue:'خدمات الحلاقة', catalogue_productName:'الخدمة',
    catalogue_exportCsv:'تصدير الخدمات', catalogue_importProducts:'استيراد الخدمات' };
  await render('ar',true,{business:{actionLabels:{ar:custom ? overrides : {}}}});
  const button = label => Array.from(document.querySelectorAll('button')).find(element =>
    element.getAttribute('aria-label') === label || element.textContent === label);
  const blobs = [];
  const downloads = [];
  const original = URL.createObjectURL;
  URL.createObjectURL = blob => { blobs.push(blob); return 'blob:test'; };
  const click = jest.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function () { downloads.push(this.download); });
  try {
    await act(async () => button(custom ? overrides.catalogue_exportCsv : 'تصدير كل النتائج CSV').click());
    await act(async () => button(custom ? overrides.catalogue_importProducts : businessCopy.ar.importProducts).click());
    await act(async () => button(businessCopy.ar.downloadImportTemplate).click());
    await act(async () => button('تنزيل قالب CSV').click());
    expect(paths.slice(-3).map(url => url.pathname + url.search)).toEqual([
      '/businesses/shop/products/insights?page=1&state=active&search=&filter=all&export=true&lang=ar',
      '/businesses/shop/product-imports/template?format=xlsx&lang=ar',
      '/businesses/shop/product-imports/template?format=csv&lang=ar',
    ]);
    expect(downloads).toEqual(['products.csv','product-import-template.xlsx','product-import-template.csv']);
    const csv = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blobs[0]);
    });
    expect(csv).toBe('SKU,Name\r\n001-MILK,Milk');
  } finally {
    click.mockRestore();
    if (original) URL.createObjectURL = original;
    else delete URL.createObjectURL;
  }
});
