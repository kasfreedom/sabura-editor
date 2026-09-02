import test from 'node:test';
import assert from 'node:assert/strict';
import { ShortcutsCoordinator, getPlatform } from '../src/ui/shortcuts.js';
import { ZoomToolbar } from '../src/ui/zoom-toolbar.js';
import { HelpModal } from '../src/ui/help-modal.js';

// Setup minimal DOM mocks for Node.js test environment if not present
if (typeof window === 'undefined') {
  global.window = {
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}
if (typeof document === 'undefined') {
  global.document = {
    activeElement: null,
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        id: '',
        innerHTML: '',
        children: [],
        listeners: {},
        style: {},
        classList: {
          contains: (c) => el.className.split(' ').includes(c),
          add: (c) => { if (!el.className.includes(c)) el.className += ' ' + c; },
          remove: (c) => { el.className = el.className.replace(new RegExp('\\b' + c + '\\b', 'g'), '').trim(); }
        },
        setAttribute: (k, v) => { el[k] = v; },
        getAttribute: (k) => el[k],
        addEventListener: (evt, fn) => {
          el.listeners[evt] = el.listeners[evt] || [];
          el.listeners[evt].push(fn);
        },
        dispatchEvent: (evt) => {
          const fns = el.listeners[evt.type] || [];
          for (const fn of fns) fn(evt);
        },
        appendChild: (child) => {
          el.children.push(child);
          child.parentNode = el;
          return child;
        },
        removeChild: (child) => {
          el.children = el.children.filter(c => c !== child);
          child.parentNode = null;
        },
        querySelector: (sel) => {
          if (sel.startsWith('#')) {
            const targetId = sel.slice(1);
            if (el.id === targetId) return el;
            // Simple mock search in innerHTML
            return {
              id: targetId,
              textContent: '',
              listeners: {},
              addEventListener: (evt, fn) => {},
              click: () => {},
              focus: () => {}
            };
          }
          return null;
        }
      };
      return el;
    }
  };
}

test('getPlatform returns platform-specific modifier key and symbol', () => {
  const plat = getPlatform();
  assert.ok(typeof plat.isMac === 'boolean');
  assert.ok(['Cmd', 'Ctrl'].includes(plat.modKey));
  assert.ok(['⌘', 'Ctrl'].includes(plat.modSymbol));
});

test('ShortcutsCoordinator triggers tools and view commands when idle', () => {
  const events = [];
  const coordinator = new ShortcutsCoordinator({
    onSelectTool: (tool) => events.push(['tool', tool]),
    onTriggerWheel: () => events.push(['wheel']),
    onZoomIn: () => events.push(['zoom_in']),
    onZoomOut: () => events.push(['zoom_out']),
    onResetZoom: () => events.push(['reset_zoom']),
    onFitContent: () => events.push(['fit']),
    onToggleHelp: () => events.push(['help']),
    onEscape: () => events.push(['escape']),
    isTextEditing: () => false
  });

  // Tools
  coordinator.onKeyDown({ key: 'r', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 'e', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 't', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 'c', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 'l', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 'p', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 'v', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 'h', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 'q', preventDefault: () => {} });

  // View
  coordinator.onKeyDown({ key: '+', preventDefault: () => {} });
  coordinator.onKeyDown({ key: '-', preventDefault: () => {} });
  coordinator.onKeyDown({ key: '0', preventDefault: () => {} });
  coordinator.onKeyDown({ key: '1', preventDefault: () => {} });
  coordinator.onKeyDown({ key: '?', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 'Escape', preventDefault: () => {} });

  assert.deepEqual(events, [
    ['tool', 'rectangle'],
    ['tool', 'ellipse'],
    ['tool', 'text'],
    ['tool', 'connector'],
    ['tool', 'line'],
    ['tool', 'line'],
    ['tool', 'select'],
    ['tool', 'hand'],
    ['wheel'],
    ['zoom_in'],
    ['zoom_out'],
    ['reset_zoom'],
    ['fit'],
    ['help'],
    ['escape']
  ]);
});

test('ShortcutsCoordinator isolates typing when text editor or inputs are active', () => {
  const events = [];
  const coordinator = new ShortcutsCoordinator({
    onSelectTool: (tool) => events.push(['tool', tool]),
    onTriggerWheel: () => events.push(['wheel']),
    onEscape: () => events.push(['escape']),
    isTextEditing: () => true // Text editor active
  });

  coordinator.onKeyDown({ key: 't', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 'r', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 'e', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 'q', preventDefault: () => {} });
  coordinator.onKeyDown({ key: 'c', preventDefault: () => {} });

  // No tool changes should occur while typing
  assert.equal(events.length, 0, 'Tools should not trigger while text editing is active');

  // Escape should still be passed through to close the text editor
  coordinator.onKeyDown({ key: 'Escape', preventDefault: () => {} });
  assert.deepEqual(events, [['escape']]);
});

test('ZoomToolbar renders 5 buttons in exact sequence and updates zoom %', () => {
  const parent = document.createElement('div');
  const events = [];
  const toolbar = new ZoomToolbar(parent, {
    onZoomOut: () => events.push('zoom_out'),
    onZoomIn: () => events.push('zoom_in'),
    onResetZoom: () => events.push('reset_zoom'),
    onFit: () => events.push('fit'),
    onOpenHelp: () => events.push('help')
  });

  assert.ok(toolbar.toolbarEl.innerHTML.includes('id="btn-zoom-out"'));
  assert.ok(toolbar.toolbarEl.innerHTML.includes('id="btn-zoom-reset"'));
  assert.ok(toolbar.toolbarEl.innerHTML.includes('id="btn-zoom-in"'));
  assert.ok(toolbar.toolbarEl.innerHTML.includes('id="btn-zoom-fit"'));
  assert.ok(toolbar.toolbarEl.innerHTML.includes('id="btn-help-toggle"'));

  // Initial percentage
  assert.equal(toolbar.zoom, 1.0);
  toolbar.setZoom(1.45);
  assert.equal(toolbar.zoom, 1.45);
});

test('HelpModal opens, renders scannable sections, and toggles cleanly', () => {
  const parent = document.createElement('div');
  const modal = new HelpModal(parent);

  assert.equal(modal.isOpen, false);
  modal.open();
  assert.equal(modal.isOpen, true);
  assert.ok(modal.modalEl.className.includes('visible'));
  assert.ok(modal.modalEl.innerHTML.includes('Tools & Navigation'));
  assert.ok(modal.modalEl.innerHTML.includes('Editing & Modifiers'));
  assert.ok(modal.modalEl.innerHTML.includes('Connectors'));
  assert.ok(modal.modalEl.innerHTML.includes('View & Controls'));

  modal.close();
  assert.equal(modal.isOpen, false);
  assert.ok(!modal.modalEl.className.includes('visible'));

  modal.toggle();
  assert.equal(modal.isOpen, true);
});

test('ShortcutsCoordinator triggers onEqualSides on S or =, and protects text editing', () => {
  let equalTriggered = 0;
  let zoomInTriggered = 0;
  let hasShapes = true;

  const coordinator = new ShortcutsCoordinator({
    onEqualSides: () => {
      if (hasShapes) {
        equalTriggered++;
        return true;
      }
      return false;
    },
    onZoomIn: () => {
      zoomInTriggered++;
    },
    isTextEditing: () => false
  });

  // Tapping S when shapes exist
  coordinator.onKeyDown({ key: 's', preventDefault: () => {} });
  assert.equal(equalTriggered, 1);

  // Tapping = when shapes exist
  coordinator.onKeyDown({ key: '=', preventDefault: () => {} });
  assert.equal(equalTriggered, 2);
  assert.equal(zoomInTriggered, 0);

  // Tapping = when NO shapes exist -> falls back to Zoom In
  hasShapes = false;
  coordinator.onKeyDown({ key: '=', preventDefault: () => {} });
  assert.equal(equalTriggered, 2);
  assert.equal(zoomInTriggered, 1);

  // Tapping S when editing text -> strictly ignored
  const typingCoordinator = new ShortcutsCoordinator({
    onEqualSides: () => { equalTriggered++; return true; },
    isTextEditing: () => true
  });
  typingCoordinator.onKeyDown({ key: 's', preventDefault: () => {} });
  assert.equal(equalTriggered, 2, 'Typing S inside text editor must not trigger equal sides');
});
