import { expect, it } from 'vitest';
import Excel from 'exceljs';
import { importTemplate, parseWorkbook, templateColumns, validImportHeaders } from '../src/catalogue/workbook.js';
import { parseCsv } from '../src/catalogue/csv.js';

it.each(['ar','en'])('round-trips the %s template with localized headers and sheet direction', async lang => {
  const bytes = Buffer.from(await importTemplate(lang), 'base64');
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(bytes as never);
  const sheet = workbook.worksheets[0]!;
  expect(sheet.name).toBe(lang === 'ar' ? 'المنتجات' : 'Products');
  expect(sheet.views[0]?.rightToLeft).toBe(lang === 'ar');
  const rows = await parseWorkbook(bytes);
  expect(rows[0]!.values).toEqual([...templateColumns(lang)]);
  expect(validImportHeaders(rows[0]!.values)).toBe(true);
  const csv = parseCsv(Buffer.from('\uFEFF'+templateColumns(lang).join(',')+'\r\n'));
  expect(validImportHeaders(csv[0]!.values)).toBe(true);
});
it('accepts reordered headers and rejects unknown headers', () => {
  expect(validImportHeaders([...templateColumns('ar')].reverse())).toBe(true);
  expect(validImportHeaders(['unknown'])).toBe(false);
});
