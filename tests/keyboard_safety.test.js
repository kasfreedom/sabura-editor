import test from 'node:test';
import assert from 'node:assert/strict';

const windowListeners = {};
global.window = {
  innerWidth: 1000,
  innerHeight: 800,
  addEventListener: (type, fn) => { (windowListeners[type] ||= []).push(fn); },
  removeEventListener: (type, fn) => { windowListeners[type] = (windowListeners[type] || []).filter((f) => f !== fn); }
};
global.document = { activeElement: null, hidden: false, addEventListener() {}, removeEventListener() {} };

const { ShortcutsCoordinator } = await import('../src/ui/shortcuts.js');
const { TextEditor } = await import('../src/ui/text-editor.js');

function key(k, extra = {}) {
  let prevented = false;
  return { key: k, preventDefault: () => { prevented = true; }, get prevented() { return prevented; }, ...extra };
}

/** A coordinator whose handlers record every call, with overridable state. */
function recorder(state = {}) {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); return true; };
  const coordinator = new ShortcutsCoordinator({
    onSelectTool: record('tool'),
    onDelete: record('delete'),
    onSelectAll: record('selectAll'),
    onUndo: record('undo'),
    onRedo: record('redo'),
    onNudge: record('nudge'),
    onEditText: record('editText'),
    onEscape: record('escape'),
    onSpaceHold: record('space'),
    onDHold: record('dHold'),
    onToggleHelp: record('help'),
    isTextEditing: () => false,
    isReadingMode: () => false,
    isOverlayOpen: () => Boolean(state.overlay),
    isInteracting: () => Boolean(state.interacting)
  });
  return { coordinator, calls };
}

function control(tagName, extra = {}) {
  return { tagName, isContentEditable: false, closest: (sel) => (sel.split(',').some((s) => s.trim().toLowerCase().startsWith(tagName.toLowerCase())) ? {} : null), ...extra };
}

test('editing shortcuts do nothing while the help modal or wheel is open; Escape still closes it (regression)', () => {
  const { coordinator, calls } = recorder({ overlay: true });
  const mod = { metaKey: true, ctrlKey: true };
  for (const e of [key('Backspace'), key('Delete'), key('a', mod), key('z', mod), key('ArrowLeft'), key('r'), key('Enter')]) {
    coordinator.onKeyDown(e);
  }
  assert.deepEqual(calls, []);
  coordinator.onKeyDown(key('Escape'));
  assert.deepEqual(calls, [['escape']]);
});

test('Q and ? still close the wheel and help while an overlay is open', () => {
  const { coordinator, calls } = recorder({ overlay: true });
  coordinator.handlers.onTriggerWheel = () => calls.push(['wheel']);
  coordinator.onKeyDown(key('q'));
  coordinator.onKeyDown(key('?'));
  coordinator.onKeyDown(key('q', { metaKey: true, ctrlKey: true }));
  assert.deepEqual(calls, [['wheel'], ['help']]);
});

test('editing shortcuts do nothing during a pointer gesture; Escape still cancels it (regression)', () => {
  const { coordinator, calls } = recorder({ interacting: true });
  coordinator.onKeyDown(key('z', { metaKey: true, ctrlKey: true }));
  coordinator.onKeyDown(key('Delete'));
  assert.deepEqual(calls, []);
  coordinator.onKeyDown(key('Escape'));
  assert.deepEqual(calls, [['escape']]);
});

test('Enter and Space on a focused button keep their native click (regression)', () => {
  const { coordinator, calls } = recorder();
  document.activeElement = control('BUTTON');
  try {
    const enter = key('Enter');
    coordinator.onKeyDown(enter);
    const space = key(' ');
    coordinator.onKeyDown(space);
    assert.equal(enter.prevented, false);
    assert.equal(space.prevented, false);
    assert.deepEqual(calls, []);
    // Ordinary tool shortcuts still work after clicking a toolbar button.
    coordinator.onKeyDown(key('r'));
    assert.deepEqual(calls, [['tool', 'rectangle']]);
  } finally {
    document.activeElement = null;
  }
});

test('shortcuts never fire while a select menu has focus', () => {
  const { coordinator, calls } = recorder();
  document.activeElement = control('SELECT');
  try {
    for (const e of [key('r'), key('ArrowDown'), key('Delete'), key('Enter')]) coordinator.onKeyDown(e);
    assert.deepEqual(calls, []);
  } finally {
    document.activeElement = null;
  }
});

test('IME composition keys are never treated as shortcuts (regression)', () => {
  const { coordinator, calls } = recorder();
  coordinator.onKeyDown(key('Enter', { isComposing: true }));
  coordinator.onKeyDown(key('r', { keyCode: 229 }));
  assert.deepEqual(calls, []);
});

test('held Space and D are released when the window loses focus (regression)', () => {
  const { coordinator, calls } = recorder();
  coordinator.onKeyDown(key(' '));
  coordinator.onKeyDown(key('d'));
  assert.equal(coordinator.isSpacePressed, true);
  for (const fn of windowListeners.blur || []) fn({});
  assert.equal(coordinator.isSpacePressed, false);
  assert.ok(calls.some((c) => c[0] === 'space' && c[1] === false));
  assert.ok(calls.some((c) => c[0] === 'dHold' && c[1] === false));
  coordinator.destroy();
});

test('keyup without a key (autofill) does not throw', () => {
  const { coordinator } = recorder();
  assert.doesNotThrow(() => coordinator.onKeyUp({}));
  assert.doesNotThrow(() => coordinator.onKeyDown({ preventDefault() {} }));
});

test('text editor ignores Enter and Escape while an IME is composing (regression)', () => {
  let closed = null;
  const editor = { targetObject: { type: 'rectangle' }, close: (commit) => { closed = commit; } };
  const composingEnter = key('Enter', { isComposing: true, stopPropagation() {} });
  TextEditor.prototype.onKeyDown.call(editor, composingEnter);
  TextEditor.prototype.onKeyDown.call(editor, key('Escape', { keyCode: 229, stopPropagation() {} }));
  assert.equal(closed, null);
  assert.equal(composingEnter.prevented, false);

  TextEditor.prototype.onKeyDown.call(editor, key('Enter', { stopPropagation() {} }));
  assert.equal(closed, true, 'a normal Enter in a shape still commits');
});
