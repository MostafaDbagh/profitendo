// Format decimal quantities without rounding or converting through Number.
// Monetary values and editable input strings use their own formatting.
export function formatQuantity(value) {
  return String(value ?? '0').replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}
