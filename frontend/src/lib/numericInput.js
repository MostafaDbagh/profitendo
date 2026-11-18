// Reject non-ASCII digits rather than silently changing a monetary amount or
// quantity. Leave text fields and each numeric field's decimal/sign rules alone.
export function hasNonAsciiDigits(value = '') {
  return /[^\x00-\x7F]/u.test(value) && /\p{Decimal_Number}/u.test(value.replace(/[0-9]/g, ''));
}

export function installNumericInputGuard(doc = document) {
  const numeric = target => target instanceof HTMLInputElement &&
    (['number', 'tel'].includes(target.type) || ['numeric', 'decimal'].includes(target.inputMode));
  const guard = event => {
    if (!numeric(event.target)) return;
    const text = event.type === 'paste' ? event.clipboardData?.getData('text/plain')
      : event.type === 'drop' ? event.dataTransfer?.getData('text/plain')
      : event.type === 'keydown' ? event.key : event.data;
    if (text && hasNonAsciiDigits(text)) event.preventDefault();
  };
  const events = ['beforeinput', 'paste', 'drop', 'keydown'];
  events.forEach(type => doc.addEventListener(type, guard, true));
  return () => events.forEach(type => doc.removeEventListener(type, guard, true));
}
