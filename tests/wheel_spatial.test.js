import test from 'node:test';
import assert from 'node:assert/strict';

// Setup minimal DOM mocks for Node.js test environment
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
        style: {},
        children: [],
        innerHTML: '',
        appendChild: (child) => { el.children.push(child); },
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      return el;
    }
  };
}

import { ToolWheel } from '../src/ui/wheel.js';

function createMockContainer() {
  return {
    appendChild: () => {}
  };
}

test('ToolWheel maintains fixed 8-slot octant layout across all contexts', () => {
  const container = createMockContainer();
  const wheel = new ToolWheel(container, () => {});

  // 1. Canvas Context
  wheel.context = 'canvas';
  const canvasItems = wheel.getItems();
  assert.equal(canvasItems.length, 8, 'Canvas wheel must have exactly 8 items');
  assert.equal(canvasItems[0].id, 'shapes');
  assert.equal(canvasItems[1].id, 'tool_text');
  assert.equal(canvasItems[2].id, 'connector');
  assert.equal(canvasItems[3].id, 'image_import');
  assert.equal(canvasItems[4].id, 'tool_hand');
  assert.equal(canvasItems[5].id, 'action_undo');
  assert.equal(canvasItems[6].id, 'action_redo');
  assert.equal(canvasItems[7].id, 'tool_select');
  assert.deepEqual(canvasItems[0].subItems.map(item => item.id), [
    'shape_rectangle', 'shape_ellipse', 'shape_diamond', 'shape_triangle', 'tool_line'
  ]);

  // 2. Single Shape Context (Rectangle, Ellipse, Diamond, Triangle, Text)
  wheel.context = 'object';
  wheel.selectedCount = 1;
  wheel.selectedObjects = [];
  wheel.selectedObject = { id: 'rect1', type: 'rectangle', x: 10, y: 10, width: 100, height: 80 };
  const shapeItems = wheel.getItems();
  assert.equal(shapeItems.length, 8, 'Shape wheel must have exactly 8 items');

  // 3. Connector Context
  wheel.selectedObject = { id: 'c1', type: 'connector', routing: 'straight' };
  const connItems = wheel.getItems();
  assert.equal(connItems.length, 8, 'Connector wheel must have exactly 8 items');

  // 4. Open Path Context
  wheel.selectedObject = { id: 'p1', type: 'path', closed: false, curveStyle: 'sharp' };
  const openPathItems = wheel.getItems();
  assert.equal(openPathItems.length, 8, 'Open path wheel must have exactly 8 items');

  // 5. Closed Polygon Path Context
  wheel.selectedObject = { id: 'p2', type: 'path', closed: true, curveStyle: 'curved' };
  const closedPathItems = wheel.getItems();
  assert.equal(closedPathItems.length, 8, 'Closed polygon wheel must have exactly 8 items');

  // 6. Multi-selection Context (2 objects)
  wheel.selectedCount = 2;
  wheel.selectedObjects = [
    { id: 's1', type: 'rectangle' },
    { id: 's2', type: 'ellipse' }
  ];
  wheel.selectedObject = wheel.selectedObjects[0];
  const multi2Items = wheel.getItems();
  assert.equal(multi2Items.length, 8, 'Multi-selection (2 objects) must have exactly 8 items');

  // 7. Multi-selection Context (3 objects)
  wheel.selectedCount = 3;
  wheel.selectedObjects.push({ id: 's3', type: 'diamond' });
  const multi3Items = wheel.getItems();
  assert.equal(multi3Items.length, 8, 'Multi-selection (3 objects) must have exactly 8 items');
});

test('Universal actions are anchored to identical slots across all object contexts', () => {
  const container = createMockContainer();
  const wheel = new ToolWheel(container, () => {});
  wheel.context = 'object';

  const contexts = [
    { name: 'Shape', obj: { id: 's1', type: 'rectangle' }, count: 1 },
    { name: 'Connector', obj: { id: 'c1', type: 'connector', routing: 'curved' }, count: 1 },
    { name: 'Open Path', obj: { id: 'p1', type: 'path', closed: false }, count: 1 },
    { name: 'Closed Polygon', obj: { id: 'p2', type: 'path', closed: true }, count: 1 },
    {
      name: 'Multi-Selection',
      obj: { id: 'm1', type: 'rectangle' },
      count: 2,
      objs: [{ id: 'm1', type: 'rectangle' }, { id: 'm2', type: 'ellipse' }]
    }
  ];

  for (const ctx of contexts) {
    wheel.selectedObject = ctx.obj;
    wheel.selectedCount = ctx.count;
    wheel.selectedObjects = ctx.objs || [ctx.obj];

    const items = wheel.getItems();

    // Universal Slots (Indices 3, 4, 5, 6, 7):
    assert.equal(items[3].id, 'action_duplicate', `${ctx.name}: Slot 3 must be Duplicate`);
    assert.equal(items[3].label, 'Duplicate');

    assert.equal(items[4].id, 'menu_order', `${ctx.name}: Slot 4 must be Arrange`);
    assert.equal(items[4].label, 'Arrange');

    assert.equal(items[5].id, 'menu_style', `${ctx.name}: Slot 5 must be Style`);
    assert.equal(items[5].label, 'Style');

    assert.equal(items[6].id, 'menu_ink', `${ctx.name}: Slot 6 must be Ink`);
    assert.equal(items[6].label, 'Ink');

    assert.equal(items[7].id, 'action_delete', `${ctx.name}: Slot 7 must be Delete`);
    assert.equal(items[7].label, 'Delete');
  }
});

test('Multi-selection disables ineligible actions without collapsing slot count', () => {
  const container = createMockContainer();
  const wheel = new ToolWheel(container, () => {});
  wheel.context = 'object';

  // Case 1: 2 spatial objects -> Align enabled, Distribute disabled
  wheel.selectedCount = 2;
  wheel.selectedObjects = [
    { id: 'o1', type: 'rectangle' },
    { id: 'o2', type: 'diamond' }
  ];
  wheel.selectedObject = wheel.selectedObjects[0];

  const items2 = wheel.getItems();
  assert.equal(items2.length, 8);
  assert.equal(items2[0].id, 'menu_align');
  assert.equal(items2[0].disabled, false, 'Align should be enabled for 2 spatial objects');
  assert.equal(items2[1].id, 'menu_distribute');
  assert.equal(items2[1].disabled, true, 'Distribute should be disabled for 2 spatial objects');

  // Case 2: 3 spatial objects -> Both Align and Distribute enabled
  wheel.selectedCount = 3;
  wheel.selectedObjects.push({ id: 'o3', type: 'ellipse' });
  const items3 = wheel.getItems();
  assert.equal(items3.length, 8);
  assert.equal(items3[0].id, 'menu_align');
  assert.equal(items3[0].disabled, false);
  assert.equal(items3[1].id, 'menu_distribute');
  assert.equal(items3[1].disabled, false, 'Distribute should be enabled for 3 spatial objects');
});

test('all-connector multi-selection keeps connector controls and honest mixed state', () => {
  const wheel = new ToolWheel(createMockContainer(), () => {});
  wheel.context = 'object';
  wheel.selectedCount = 2;
  wheel.selectedObjects = [
    { id: 'c1', type: 'connector', routing: 'straight', startArrow: false, endArrow: false, stroke: '#111' },
    { id: 'c2', type: 'connector', routing: 'curved', startArrow: true, endArrow: true, stroke: '#222' }
  ];
  wheel.selectedObject = wheel.selectedObjects[0];
  wheel.themePalette = ['#111', '#222'];

  const items = wheel.getItems();
  assert.deepEqual(items.map(item => item.id), [
    'menu_route', 'menu_arrows', 'menu_conn_points', 'action_duplicate',
    'menu_order', 'menu_style', 'menu_ink', 'action_delete'
  ]);
  assert.deepEqual(items[0].subItems.map(item => item.id), [
    'conn_route_straight', 'conn_route_elbow', 'conn_route_curved'
  ]);
  assert.equal(items[0].subItems.some(item => item.isActive), false, 'mixed routes have no false active choice');
  assert.equal(items[1].subItems.some(item => item.isActive), false, 'mixed arrows have no false active choice');
  assert.deepEqual(items[2].subItems.map(item => item.id), [
    'conn_points_auto', 'conn_points_auto_from', 'conn_points_auto_to'
  ]);
  assert.equal(items[4].subItems.at(-1).id, 'action_group');

  wheel.selectedObjects[1] = { ...wheel.selectedObjects[1], routing: 'straight', startArrow: false, endArrow: false };
  wheel.selectedObject = wheel.selectedObjects[0];
  const shared = wheel.getItems();
  assert.equal(shared[0].subItems.find(item => item.id === 'conn_route_straight').isActive, true);
  assert.equal(shared[1].subItems.find(item => item.id === 'conn_arrows_none').isActive, true);

  wheel.selectedObjects[1] = { id: 'r1', type: 'rectangle' };
  wheel.selectedObject = wheel.selectedObjects[0];
  const mixedTypes = wheel.getItems();
  assert.equal(mixedTypes[0].id, 'menu_align', 'mixed object types retain the generic multi wheel');
});

test('Style submenu contains only visual style options and never color swatches across all contexts', () => {
  const container = createMockContainer();
  const wheel = new ToolWheel(container, () => {});
  wheel.themePalette = ['#1e1e1e', '#1971c2', '#2f9e44', '#e03131'];
  wheel.context = 'object';

  const contexts = [
    { name: 'Shape', obj: { id: 's1', type: 'rectangle' }, count: 1 },
    { name: 'Connector', obj: { id: 'c1', type: 'connector', routing: 'curved' }, count: 1 },
    { name: 'Open Path', obj: { id: 'p1', type: 'path', closed: false }, count: 1 },
    { name: 'Closed Polygon', obj: { id: 'p2', type: 'path', closed: true }, count: 1 },
    {
      name: 'Group / Multi-Selection',
      obj: { id: 'm1', type: 'rectangle', groupId: 'g1' },
      count: 7,
      objs: [
        { id: 'm1', type: 'rectangle', groupId: 'g1' },
        { id: 'm2', type: 'rectangle', groupId: 'g1' },
        { id: 'm3', type: 'rectangle', groupId: 'g1' },
        { id: 'm4', type: 'ellipse', groupId: 'g1' },
        { id: 'c1', type: 'connector', groupId: 'g1' },
        { id: 'c2', type: 'connector', groupId: 'g1' },
        { id: 'c3', type: 'connector', groupId: 'g1' }
      ]
    }
  ];

  for (const ctx of contexts) {
    wheel.selectedObject = ctx.obj;
    wheel.selectedCount = ctx.count;
    wheel.selectedObjects = ctx.objs || [ctx.obj];

    const items = wheel.getItems();
    const styleItem = items.find(it => it.id === 'menu_style');
    assert.ok(styleItem, `${ctx.name} must have a menu_style item`);

    const subIds = styleItem.subItems.map(s => s.id);
    assert.deepEqual(
      subIds,
      ['style_sketch', 'style_clean', 'stroke_solid', 'stroke_dashed', 'stroke_dotted'],
      `${ctx.name}: Style subItems must only contain sketch/clean and line styles, no color swatches`
    );

    // Verify zero color swatches or fill IDs leaked into Style
    assert.ok(!subIds.some(id => id.startsWith('fill_') || id.startsWith('ink_') || id.startsWith('opacity_')),
      `${ctx.name}: Style must not contain fill, ink, or opacity items`);
  }
});

test('Fill menu provides colors in subItems (Ring 2) and opacity in thirdItems (Ring 3)', () => {
  const container = createMockContainer();
  const wheel = new ToolWheel(container, () => {});
  wheel.themePalette = ['#1e1e1e', '#1971c2', '#2f9e44', '#e03131'];
  wheel.context = 'object';
  wheel.selectedObject = { id: 'rect1', type: 'rectangle', fill: '#1971c2', opacity: 0.75 };
  wheel.selectedCount = 1;
  wheel.selectedObjects = [wheel.selectedObject];

  const items = wheel.getItems();
  const fillItem = items.find(it => it.id === 'menu_fill');
  assert.ok(fillItem, 'Fill item must exist');
  assert.ok(Array.isArray(fillItem.subItems), 'Fill must have subItems for Ring 2');
  assert.ok(Array.isArray(fillItem.thirdItems), 'Fill must have thirdItems for Ring 3');

  // Ring 2: colors (None + themePalette)
  const colorIds = fillItem.subItems.map(s => s.id);
  assert.equal(colorIds[0], 'fill_none');
  assert.equal(colorIds[1], 'fill_0');
  assert.equal(colorIds.length, 5); // None + 4 colors
  assert.ok(!colorIds.some(id => id.startsWith('opacity_')), 'Ring 2 must not contain opacity items');

  // Ring 3: opacity tiers (100%, 75%, 50%, 25%)
  const opacityIds = fillItem.thirdItems.map(t => t.id);
  assert.deepEqual(opacityIds, ['opacity_100', 'opacity_75', 'opacity_50', 'opacity_25']);
  assert.equal(fillItem.thirdItems[1].isActive, true, '75% opacity should be active');
});

test('Shape submenu partitions geometries into Ring 2 and modifiers into Ring 3', () => {
  const container = createMockContainer();
  const wheel = new ToolWheel(container, () => {});
  wheel.context = 'object';
  wheel.selectedObject = { id: 'rect1', type: 'rectangle' };
  wheel.selectedCount = 1;

  const items = wheel.getItems();
  const shapeItem = items.find(it => it.id === 'menu_shape');
  assert.ok(shapeItem, 'Shape item must exist');

  // Ring 2: Core Geometries
  const subIds = shapeItem.subItems.map(s => s.id);
  assert.deepEqual(subIds, ['to_rectangle', 'to_ellipse', 'to_diamond', 'to_triangle']);
  const rectSub = shapeItem.subItems.find(s => s.id === 'to_rectangle');
  assert.equal(rectSub.label, 'Rect', 'Rectangle should be labeled Rect');

  // Ring 3: Modifiers and Actions
  assert.ok(Array.isArray(shapeItem.thirdItems), 'Shape item must have thirdItems');
  const thirdIds = shapeItem.thirdItems.map(t => t.id);
  assert.ok(thirdIds.includes('to_equal_sides'), 'thirdItems must include to_equal_sides');
  assert.ok(thirdIds.includes('action_connect'), 'thirdItems must include action_connect');
  const equalSub = shapeItem.thirdItems.find(s => s.id === 'to_equal_sides');
  assert.equal(equalSub.label, 'Equal', 'Equal sides should be labeled Equal');
});

test('Type menu partitions fonts and formatting into Ring 2 and text sizes into Ring 3', () => {
  const container = createMockContainer();
  const wheel = new ToolWheel(container, () => {});
  wheel.context = 'object';
  wheel.selectedObject = { id: 'rect1', type: 'rectangle', textStyle: { size: 'm', fontFamily: 'sans', bold: true } };
  wheel.selectedCount = 1;

  const items = wheel.getItems();
  const typeItem = items.find(it => it.id === 'menu_type');
  assert.ok(typeItem, 'Type item must exist');

  // Ring 2: Fonts and formatting
  const subIds = typeItem.subItems.map(s => s.id);
  assert.deepEqual(subIds, ['font_hand', 'font_sans', 'font_serif', 'font_mono', 'type_bold', 'type_align']);
  const activeFont = typeItem.subItems.find(s => s.isActive);
  assert.equal(activeFont.id, 'font_sans');
  const boldItem = typeItem.subItems.find(s => s.id === 'type_bold');
  assert.ok(boldItem.isActive, 'Bold should be active');

  // Ring 3: Text Sizes
  assert.ok(Array.isArray(typeItem.thirdItems), 'Type item must have thirdItems');
  const thirdIds = typeItem.thirdItems.map(t => t.id);
  assert.deepEqual(thirdIds, ['type_s', 'type_m', 'type_l', 'type_xl']);
  const activeSize = typeItem.thirdItems.find(t => t.isActive);
  assert.equal(activeSize.id, 'type_m');
});

test('fill_none does not have fill: none inline style which would break SVG pointer events', () => {
  const container = createMockContainer();
  let dispatchedAction = null;
  let dispatchedPayload = null;
  const wheel = new ToolWheel(container, (action, payload) => {
    dispatchedAction = action;
    dispatchedPayload = payload;
  });
  wheel.themePalette = ['#1e1e1e', '#1971c2'];
  wheel.context = 'object';
  wheel.selectedObject = { id: 'rect1', type: 'rectangle', fill: '#1971c2' };
  wheel.selectedCount = 1;
  wheel.selectedObjects = [wheel.selectedObject];
  wheel.activeSubMenu = 'menu_fill';

  wheel.render();

  const svg = wheel.wheelEl.innerHTML;
  const noneWedgeMatch = svg.match(/<path[^>]*data-sub-id="fill_none"[^>]*>/);
  assert.ok(noneWedgeMatch, 'Must render path for fill_none');
  const noneWedgeHtml = noneWedgeMatch[0];

  assert.ok(!noneWedgeHtml.includes('fill: none'), 'fill_none must NOT have inline fill: none which breaks pointer hit testing in SVG');
  assert.ok(noneWedgeHtml.includes('style=""'), 'fill_none should have empty style attribute to use solid CSS fill');

  // Verify onAction dispatch with payload color 'none'
  const items = wheel.getItems();
  const fillItem = items.find(it => it.id === 'menu_fill');
  const noneItem = fillItem.subItems.find(s => s.id === 'fill_none');
  assert.equal(noneItem.color, 'none');
  wheel.onAction(noneItem.id, noneItem);
  assert.equal(dispatchedAction, 'fill_none');
  assert.equal(dispatchedPayload.color, 'none');
});

test('Style menu provides stroke width options in thirdItems (Ring 3) across all contexts', () => {
  const container = createMockContainer();
  const wheel = new ToolWheel(container, () => {});
  wheel.themePalette = ['#1e1e1e', '#1971c2'];

  const contexts = [
    {
      name: 'Single Shape',
      obj: { id: 's1', type: 'rectangle', strokeWidth: 4 },
      count: 1,
      expectedActiveWidth: 4
    },
    {
      name: 'Connector',
      obj: { id: 'c1', type: 'connector', routing: 'curved', strokeWidth: 6 },
      count: 1,
      expectedActiveWidth: 6
    },
    {
      name: 'Path / Polyline',
      obj: { id: 'p1', type: 'path', closed: false, points: [[0,0], [10,10]], strokeWidth: 1 },
      count: 1,
      expectedActiveWidth: 1
    },
    {
      name: 'Multi-Selection',
      obj: { id: 'm1', type: 'rectangle', strokeWidth: 2 },
      count: 3,
      objs: [{ id: 'm1', type: 'rectangle', strokeWidth: 2 }, { id: 'm2', type: 'ellipse' }],
      expectedActiveWidth: 2
    }
  ];

  for (const ctx of contexts) {
    wheel.context = 'object';
    wheel.selectedObject = ctx.obj;
    wheel.selectedCount = ctx.count;
    wheel.selectedObjects = ctx.objs || [ctx.obj];

    const items = wheel.getItems();
    const styleItem = items.find(it => it.id === 'menu_style');
    assert.ok(styleItem, `${ctx.name} must have a menu_style item`);
    assert.ok(Array.isArray(styleItem.thirdItems), `${ctx.name} Style must have thirdItems for Ring 3`);

    const widthIds = styleItem.thirdItems.map(t => t.id);
    assert.deepEqual(widthIds, ['width_1', 'width_2', 'width_4', 'width_6'], `${ctx.name} must offer 1px, 2px, 4px, 6px`);

    const activeItem = styleItem.thirdItems.find(t => t.isActive);
    assert.ok(activeItem, `${ctx.name} must have an active width item`);
    assert.equal(activeItem.value, ctx.expectedActiveWidth, `${ctx.name} active width should match expected value`);
  }
});
