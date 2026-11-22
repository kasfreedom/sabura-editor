import test from 'node:test';
import assert from 'node:assert/strict';
import { readInterfaceTheme, writeInterfaceTheme, UI_THEME_KEY } from '../src/storage/ui-preferences.js';

// --- Interface theme preference (regression: blocked storage crashed startup) ---

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};
const blocked = () => { throw new DOMException('The document is sandboxed and lacks the allow-same-origin flag.', 'SecurityError'); };

test('the saved interface theme is read back', () => {
  for (const theme of ['light', 'dark', 'system']) {
    assert.equal(readInterfaceTheme(() => memoryStorage({ [UI_THEME_KEY]: theme })), theme);
  }
});

test('no saved theme, or an unknown value, falls back to system', () => {
  assert.equal(readInterfaceTheme(() => memoryStorage()), 'system');
  assert.equal(readInterfaceTheme(() => memoryStorage({ [UI_THEME_KEY]: 'neon"><script>' })), 'system');
  assert.equal(readInterfaceTheme(() => undefined), 'system');
});

test('blocked storage (sandboxed iframe, data: URL, privacy mode) never stops the editor (regression)', () => {
  // Reading the localStorage getter itself throws in these contexts.
  assert.equal(readInterfaceTheme(blocked), 'system');
  assert.equal(readInterfaceTheme(() => ({ getItem: blocked })), 'system');
  assert.equal(writeInterfaceTheme(blocked, 'dark'), false);
  assert.equal(writeInterfaceTheme(() => ({ setItem: blocked }), 'dark'), false, 'quota errors too');
});

test('writing a theme saves it and reports success', () => {
  const storage = memoryStorage();
  assert.equal(writeInterfaceTheme(() => storage, 'dark'), true);
  assert.equal(storage.data[UI_THEME_KEY], 'dark');
});

// --- Inline text editor follows the camera (regression) ---------------------

function fakeDom() {
  const style = {};
  const textarea = { style, value: '', setAttribute() {}, addEventListener() {}, focus() {}, select() {} };
  global.document = { createElement: () => textarea };
  return { container: { appendChild() {} }, textarea };
}

test('the open text box moves and scales with pan and zoom (regression)', async () => {
  const { TextEditor } = await import('../src/ui/text-editor.js');
  const { container, textarea } = fakeDom();
  const editor = new TextEditor(container, () => {});
  const shape = { id: 's', type: 'rectangle', x: 100, y: 50, width: 200, height: 100, text: 'hi', textStyle: { resolvedSize: 20 } };

  editor.open(shape, { x: 0, y: 0, zoom: 1 });
  assert.deepEqual([textarea.style.left, textarea.style.top, textarea.style.width, textarea.style.fontSize], ['100px', '50px', '200px', '20px']);

  // Pan by (30, -10) and zoom to 2x: the box tracks the shape on screen.
  editor.followCamera({ x: 30, y: -10, zoom: 2 });
  assert.deepEqual([textarea.style.left, textarea.style.top, textarea.style.width, textarea.style.height, textarea.style.fontSize],
    ['230px', '90px', '400px', '200px', '40px']);
  assert.equal(textarea.value, 'hi', 'following the camera keeps what the user typed');
});

test('following the camera with no open text box does nothing', async () => {
  const { TextEditor } = await import('../src/ui/text-editor.js');
  const { container, textarea } = fakeDom();
  const editor = new TextEditor(container, () => {});
  editor.followCamera({ x: 5, y: 5, zoom: 3 });
  assert.equal(textarea.style.display, 'none');
  assert.equal(textarea.style.left, undefined);
});
