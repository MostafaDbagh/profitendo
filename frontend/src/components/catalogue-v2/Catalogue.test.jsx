import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { businessCopy } from '../business-v2/copy';
import Catalogue from './Catalogue';

jest.mock('react-router-dom', () => ({ useNavigate: () => () => {} }), { virtual: true });
jest.mock('@/lib/quantity', () => ({ formatQuantity: value => String(value ?? '') }), { virtual: true });
jest.mock('@/lib/utils', () => jest.requireActual('../../lib/utils'), { virtual: true });
jest.mock('@/components/CopyableCode', () => ({ __esModule: true, default: ({ children }) => <span>{children}</span> }), { virtual: true });
jest.mock('./ProductImport', () => () => null);
jest.mock('../ui/dialog', () => ({
  Dialog: ({ children }) => <div role="dialog">{children}</div>,
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogDescription: ({ children }) => <p>{children}</p>,
}));

global.IS_REACT_ACT_ENVIRONMENT = true;
const milk = { id: 'milk', name: 'Milk', sku: '001-MILK', unit: 'PIECE', active: true };
const tea = { id: 'tea', name: 'Tea', sku: '002-TEA', unit: 'PIECE', active: false };
let host, root, paths, refreshContext;

beforeEach(() => {
  jest.useFakeTimers();
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

async function render(lang, canCreate = true) {
  localStorage.setItem('profitlens_lang', lang);
  const context = { business: { id: 'shop' }, permissions: { 'catalogue.create': canCreate, 'catalogue.cost': canCreate } };
  const api = async (path, options) => {
    const url = new URL(path, 'https://app.example.test');
    paths.push(url);
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
