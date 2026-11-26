// Keep numeric entry consistent across native number inputs and decimal text fields.
export function hasNonAsciiDigits(value = '') {
  return /[^\x00-\x7F]/u.test(value) && /\p{Decimal_Number}/u.test(value.replace(/[0-9]/g, ''));
}

const minus = /[-\u2212\uFE63\uFF0D]/u;
const unsigned = input => input.type !== 'tel' &&
  (input.type === 'number' || input.inputMode === 'decimal') &&
  !(input.min && Number(input.min) < 0);

export function installNumericInputGuard(doc = document) {
  const previous = new WeakMap();
  const guard = event => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement)) return;
    const numeric = ['number', 'tel'].includes(field.type) || ['numeric', 'decimal'].includes(field.inputMode);
    if (!numeric) return;

    if (event.type === 'input' || event.type === 'focusin') {
      if (unsigned(field)) {
        if (field.type === 'number' ? field.value.startsWith('-') : minus.test(field.value)) {
          // Autofill and some mobile keyboards can bypass cancelable beforeinput.
          // Restore the last valid edit before React reads the input event.
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, previous.get(field) ?? '');
        } else {
          previous.set(field, field.value);
        }
      }
      return;
    }
    if (event.type === 'keydown' && (event.ctrlKey || event.metaKey || event.altKey)) return;
    const text = event.type === 'paste' ? event.clipboardData?.getData('text/plain')
      : event.type === 'drop' ? event.dataTransfer?.getData('text/plain')
      : event.type === 'keydown' ? event.key : event.data;
    if (text && (hasNonAsciiDigits(text) || (unsigned(field) && minus.test(text)))) event.preventDefault();
  };
  const events = ['beforeinput', 'paste', 'drop', 'keydown', 'input', 'focusin'];
  events.forEach(type => doc.addEventListener(type, guard, true));
  return () => events.forEach(type => doc.removeEventListener(type, guard, true));
}
