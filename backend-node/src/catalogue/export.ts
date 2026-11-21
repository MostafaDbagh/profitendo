import { csvCell } from '../reports/service.js';

export const exportHeaders: Record<string, [string, string]> = {
  category: ['Category', 'الفئة'], subcategory: ['Subcategory', 'الفئة الفرعية'], brand: ['Brand', 'العلامة التجارية'], description: ['Description', 'الوصف'], barcodes: ['Barcodes', 'الباركودات'], active: ['Active', 'نشط'],
  name: ['Product name', 'اسم المنتج'], sku: ['SKU', 'رمز الصنف'],
  unit: ['Unit', 'الوحدة'], sellingPrice: ['Selling price', 'سعر البيع'],
  purchasePrice: ['Purchase cost', 'تكلفة الشراء'], saleCount: ['Completed invoices', 'الفواتير المكتملة'],
  unitsSold: ['Units sold', 'الوحدات المباعة'], onHand: ['Stock on hand', 'المخزون الموجود'],
  available: ['Available stock', 'المخزون المتاح'], minimumStock: ['Low-stock threshold', 'حد تنبيه المخزون'],
  lowStock: ['Low stock', 'مخزون منخفض'],
};
export const exportUnits: Record<string, [string, string]> = {
  PIECE: ['Piece', 'قطعة'], BOX: ['Box', 'علبة'], CARTON: ['Carton', 'كرتون'],
  KG: ['Kilogram', 'كيلوغرام'], GRAM: ['Gram', 'غرام'], LITRE: ['Litre', 'لتر'], METRE: ['Metre', 'متر'],
};
export function productExportCsv(columns: string[], rows: Record<string, unknown>[], lang: 'ar' | 'en' = 'en') {
  const index = lang === 'ar' ? 1 : 0;
  return [columns.map(key => csvCell(exportHeaders[key]?.[index] ?? key)).join(','),
    ...rows.map(row => columns.map(key => {
      let value = row[key];
      if (key === 'unit' && typeof value === 'string') value = exportUnits[value]?.[index] ?? value;
      if (key === 'barcodes' && Array.isArray(value)) value = value.join('\n');
      if ((key === 'lowStock' || key === 'active') && typeof value === 'boolean') value = lang === 'ar' ? (value ? 'نعم' : 'لا') : (value ? 'Yes' : 'No');
      return csvCell(value);
    }).join(',')),
  ].join('\r\n');
}
