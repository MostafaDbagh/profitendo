// Preserve locale, rounding and separators; override only the currency token.
export function currencyFormatter(locale, options) {
  const formatter = new Intl.NumberFormat(locale, options);
  return {
    format(value) {
      return formatter.formatToParts(value).map(part => part.type === 'currency'
        ? options.currency === 'USD' ? '$' : options.currency === 'SYP' ? 'SYP' : part.value
        : part.value).join('');
    },
  };
}
