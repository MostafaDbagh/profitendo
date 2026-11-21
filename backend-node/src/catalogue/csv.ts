import { ApiError } from '../errors.js';
import { importHeaderMap, type WorkbookRow } from './workbook.js';

/** Bounded UTF-8 CSV parser. Quoted commas, escaped quotes and multiline cells
 * are supported; identifiers stay strings, preserving leading zeroes. */
export function parseCsv(buffer: Buffer): WorkbookRow[] {
  const invalid = () => new ApiError(422, 'INVALID_CSV', 'Use a valid UTF-8 CSV with at most 500 product rows and 1 MB');
  if (!buffer.length || buffer.length > 1024 * 1024) throw invalid();
  let text: string;
  try { text = new TextDecoder('utf-8', {fatal:true}).decode(buffer).replace(/^\uFEFF/, ''); }
  catch { throw invalid(); }
  if (text.includes('\0')) throw invalid();
  const rows: WorkbookRow[] = [];
  let values: string[] = [], cell = '', quoted = false, closed = false, row = 1;
  function field() {
    values.push(cell.trim()); cell = ''; closed = false;
    if (values.length > 24) {
      if (row === 1) throw new ApiError(422, 'IMPORT_HEADERS', 'Unexpected CSV column');
      throw invalid();
    }
  }
  function record() {
    field();
    if(row===1&&!importHeaderMap(values))throw new ApiError(422,'IMPORT_HEADERS','Use supported product headers');
    if (row === 1 || values.some(value => value !== '')) rows.push({row, values, invalid:row === 1 ? false : values.length !== rows[0]?.values.length});
    values = []; row++;
    if (row > 502) throw invalid();
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i+1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === ',') field();
    else if (char === '\n' || char === '\r') {
      record(); if (char === '\r' && text[i+1] === '\n') i++;
    } else if (char === '"' && cell === '' && !closed) quoted = true;
    else {
      if (closed || char === '"') throw invalid();
      cell += char;
    }
    if (cell.length > 2600) throw invalid();
  }
  if (quoted) throw invalid();
  if (cell !== '' || closed || values.length) record();
  return rows;
}
