// Select the current quantity when entering the field, so the first keystroke
// replaces defaults (including 0/1). Further clicks preserve caret placement.
const enteringByPointer = new WeakSet();
export const selectInputOnFocus = {
  onFocus(event) {
    event.currentTarget.select();
  },
  onPointerDown(event) {
    const input = event.currentTarget;
    if (event.button === 0 && input.ownerDocument.activeElement !== input) enteringByPointer.add(input);
    else enteringByPointer.delete(input);
  },
  onMouseDown(event) {
    const input = event.currentTarget;
    if (event.button !== 0 || input.type === 'number' || input.ownerDocument.activeElement === input) return;
    event.preventDefault();
    input.focus();
  },
  onClick(event) {
    const input = event.currentTarget;
    // Touch browsers may move the caret after focus. Reapply selection once
    // the initial tap completes, without changing the stored value on focus.
    if (enteringByPointer.has(input)) {
      enteringByPointer.delete(input);
      input.select();
    }
  },
  onPointerCancel(event) { enteringByPointer.delete(event.currentTarget); },
  onBlur(event) { enteringByPointer.delete(event.currentTarget); },
};
