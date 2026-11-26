import { installNumericInputGuard } from './numericInput';

let removeGuard;
beforeEach(() => { removeGuard = installNumericInputGuard(); });
afterEach(() => { removeGuard(); document.body.replaceChildren(); });

function field(type, mode) {
  const input = document.createElement('input');
  input.type = type;
  input.inputMode = mode;
  document.body.appendChild(input);
  return input;
}

test.each([['number', ''], ['text', 'decimal']])('rejects negative edits in %s fields', (type, mode) => {
  const input = field(type, mode);
  const options = { bubbles: true, cancelable: true };
  expect(input.dispatchEvent(new KeyboardEvent('keydown', { ...options, key: '-' }))).toBe(false);
  expect(input.dispatchEvent(new InputEvent('beforeinput', { ...options, data: '−2' }))).toBe(false);
  for (const [eventName, property] of [['paste', 'clipboardData'], ['drop', 'dataTransfer']]) {
    const event = new Event(eventName, options);
    Object.defineProperty(event, property, { value: { getData: () => '-12.50' } });
    expect(input.dispatchEvent(event)).toBe(false);
  }
  for (const value of ['0', '12.50', '']) {
    expect(input.dispatchEvent(new InputEvent('beforeinput', { ...options, data: value }))).toBe(true);
    input.value = value;
    input.dispatchEvent(new Event('input', options));
    const previous = input.value;
    input.value = '-3';
    input.dispatchEvent(new Event('input', options));
    expect(input.value).toBe(previous);
  }
});

test('preserves phone punctuation and explicitly signed fields', () => {
  for (const input of [field('tel', 'tel'), field('text', ''), field('number', '')]) {
    if (input.type === 'number') input.min = '-10';
    expect(input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: '-' }))).toBe(true);
  }
});
