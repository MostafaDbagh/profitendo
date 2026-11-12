const builtin = new Set(['PIECE', 'BOX', 'CARTON', 'KG', 'LITRE', 'METRE']);
// Custom unit codes are stable business identifiers, including historical receipts.
export const unitLabel = (unit, translate) => builtin.has(unit) ? translate(unit) : unit;
