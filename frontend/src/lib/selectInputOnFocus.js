// Preserve normal caret placement once the field is already focused.
export const selectInputOnFocus = {
  onFocus(event) {
    event.currentTarget.select();
  },
  onMouseDown(event) {
    const input = event.currentTarget;
    if (event.button !== 0 || input.ownerDocument.activeElement === input) return;
    event.preventDefault();
    input.focus();
  },
};
