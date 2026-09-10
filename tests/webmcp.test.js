import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_EDIT_REQUEST_SCHEMA,
  AGENT_PUBLIC_COMMAND_SCHEMAS,
  AGENT_PUBLIC_COMMAND_TYPES
} from '../src/agent-api.js';
import { validateCommand } from '../src/core/commands.js';
import {
  SABURA_WEBMCP_TOOL_NAMES,
  SaburaWebMcpBridge,
  createSaburaWebMcpTools
} from '../src/webmcp.js';
import { SaburaApp } from '../src/main.js';

function makeAgent() {
  const calls = [];
  const rasterData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const snapshot = {
    success: true,
    editToken: { sessionId: 'session_test', sequence: 4 },
    document: {
      id: 'board_test',
      assets: {
        asset_pixel: {
          id: 'asset_pixel',
          type: 'raster',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          data: rasterData
        }
      }
    }
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  return {
    calls,
    snapshot,
    read() {
      calls.push(['read']);
      return copy(snapshot);
    },
    apply(input) {
      calls.push(['apply', input]);
      return { success: true, requestId: input.requestId, changed: true };
    },
    undo(input) {
      calls.push(['undo', input]);
      return { success: true, requestId: input.requestId, changed: true };
    },
    redo(input) {
      calls.push(['redo', input]);
      return { success: true, requestId: input.requestId, changed: true };
    },
    focusObjects(ids, options) {
      calls.push(['focusObjects', ids, options]);
      return { success: true, focusedIds: [...ids] };
    },
    fitBoard() {
      calls.push(['fitBoard']);
      return { success: true };
    },
    saveCopy() {
      calls.push(['saveCopy']);
      return {
        success: true,
        exportPrepared: true,
        downloadRequested: true,
        deliveryConfirmed: false
      };
    }
  };
}

function toolsByName(agent = makeAgent()) {
  return new Map(createSaburaWebMcpTools(agent).map(tool => [tool.name, tool]));
}

function schemaMatches(value, schema) {
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.oneOf && schema.oneOf.filter(option => schemaMatches(value, option)).length !== 1) return false;
  if (schema.anyOf && !schema.anyOf.some(option => schemaMatches(value, option))) return false;

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matchesType = types.some(type => {
      if (type === 'null') return value === null;
      if (type === 'array') return Array.isArray(value);
      if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
      if (type === 'integer') return Number.isInteger(value);
      if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
      return typeof value === type;
    });
    if (!matchesType) return false;
  }

  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) return false;
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) return false;
    for (let index = 0; index < value.length; index++) {
      const itemSchema = schema.prefixItems?.[index] || schema.items;
      if (itemSchema && !schemaMatches(value[index], itemSchema)) return false;
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) return false;
    if (schema.required?.some(key => !(key in value))) return false;
    for (const key of keys) {
      const propertySchema = schema.properties?.[key];
      if (propertySchema && !schemaMatches(value[key], propertySchema)) return false;
      if (propertySchema) continue;
      const patternSchema = Object.entries(schema.patternProperties || {})
        .find(([pattern]) => new RegExp(pattern).test(key))?.[1];
      if (patternSchema && !schemaMatches(value[key], patternSchema)) return false;
      if (patternSchema) continue;
      if (schema.additionalProperties === false) return false;
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object' &&
          !schemaMatches(value[key], schema.additionalProperties)) return false;
    }
  }
  return true;
}

const REPRESENTATIVE_PUBLIC_COMMANDS = Object.freeze({
  create_object: { type: 'create_object', object: { id: 'shape_a', type: 'rectangle', x: 10, y: 20, width: 120, height: 80, text: 'A', 'ext:agent': 'kept' }, atIndex: 0 },
  create_image: {
    type: 'create_image',
    object: { id: 'image_a', type: 'image', x: 10, y: 20, width: 120, height: 80, assetId: 'asset_a', fit: 'cover' },
    asset: { id: 'asset_a', type: 'raster', data: 'data:image/png;base64,AA==', mimeType: 'image/png', width: 1, height: 1 }
  },
  delete_objects: { type: 'delete_objects', ids: ['shape_a'] },
  move_objects: { type: 'move_objects', ids: ['shape_a'], dx: 12, dy: -4 },
  resize_object: { type: 'resize_object', id: 'shape_a', bounds: { x: 1, y: 2, width: 80, height: 40 }, scaleText: true },
  set_style: { type: 'set_style', ids: ['shape_a'], updates: { fill: '#fff', strokeWidth: 0, opacity: 0.5, curveStyle: 'curved' } },
  set_image_fit: { type: 'set_image_fit', id: 'image_a', fit: 'contain' },
  set_image_opacity: { type: 'set_image_opacity', id: 'image_a', opacity: 0.75 },
  set_typography: { type: 'set_typography', ids: ['shape_a'], updates: { size: 'l', resolvedSize: 28, fontFamily: 'sans', bold: true, align: 'center', color: '#111' } },
  set_text: { type: 'set_text', id: 'shape_a', text: 'Updated' },
  change_shape: { type: 'change_shape', id: 'shape_a', newType: 'ellipse' },
  group_objects: { type: 'group_objects', ids: ['shape_a', 'shape_b'], groupId: 'group_a', name: 'Services' },
  ungroup_objects: { type: 'ungroup_objects', groupIds: ['group_a'] },
  lock_objects: { type: 'lock_objects', ids: ['shape_a'], locked: true },
  reorder_objects: { type: 'reorder_objects', ids: ['shape_a'], action: 'front' },
  align_objects: { type: 'align_objects', ids: ['shape_a', 'shape_b'], alignment: 'middle' },
  distribute_objects: { type: 'distribute_objects', ids: ['shape_a', 'shape_b', 'shape_c'], direction: 'horizontal' },
  connect_objects: {
    type: 'connect_objects', connectorId: 'edge_ab', fromId: 'shape_a', toId: 'shape_b',
    fromAnchor: { x: 1, y: 0.5 }, toAnchor: { x: 0, y: 0.5 }, routing: 'curved', curveSide: -1,
    curveDistance: 60, elbowOffset: 10, startArrow: false, endArrow: true, stacking: 'front',
    stroke: '#111', strokeWidth: 2, strokeStyle: 'dashed', opacity: 0.75, roughness: 1
  },
  reconnect_connector: { type: 'reconnect_connector', id: 'edge_ab', endpoint: 'to', target: { id: 'shape_c', anchor: { x: 0, y: 0.5 } } },
  configure_connector: { type: 'configure_connector', id: 'edge_ab', routing: 'elbow', elbowOffset: -20, startArrow: true, endArrow: false, stacking: 'back' },
  set_board_theme: { type: 'set_board_theme', themeId: 'night' },
  set_title: { type: 'set_title', title: 'Agent board' },
  update_path_points: { type: 'update_path_points', id: 'path_a', points: [{ x: 0, y: 0 }, [20, 30]], bounds: { x: 1, y: 2, width: 40, height: 50 } },
  rotate_objects: {
    type: 'rotate_objects',
    objects: { shape_a: { rotation: 45, x: 20, y: 30 } },
    freeEndpoints: { edge_free: { from: { x: 0, y: 0 }, to: { x: 40, y: 60 } } }
  }
});

test('WebMCP publishes exactly seven stable tools with safety annotations and strict envelopes', () => {
  const tools = createSaburaWebMcpTools(makeAgent());
  assert.deepEqual(tools.map(tool => tool.name), SABURA_WEBMCP_TOOL_NAMES);
  assert.equal(new Set(tools.map(tool => tool.name)).size, 7);

  const byName = new Map(tools.map(tool => [tool.name, tool]));
  assert.deepEqual(byName.get('sabura_read_board').annotations, {
    readOnlyHint: true,
    untrustedContentHint: true,
    consequentialHint: false
  });
  for (const name of ['sabura_edit_board', 'sabura_undo', 'sabura_redo', 'sabura_focus_objects', 'sabura_fit_board']) {
    assert.deepEqual(byName.get(name).annotations, {
      readOnlyHint: false,
      untrustedContentHint: true,
      consequentialHint: false
    });
  }
  assert.deepEqual(byName.get('sabura_save_copy').annotations, {
    readOnlyHint: false,
    untrustedContentHint: true,
    consequentialHint: true
  });
  assert.equal(byName.get('sabura_edit_board').inputSchema, AGENT_EDIT_REQUEST_SCHEMA);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.execute, 'function');
  }
});

test('WebMCP edit discovery stays aligned with the public Agent API command set', () => {
  const discovered = AGENT_EDIT_REQUEST_SCHEMA.properties.commands.items.oneOf
    .map(variant => variant.properties.type.const);
  assert.deepEqual(discovered, AGENT_PUBLIC_COMMAND_TYPES);
});

test('every public command has one strict, self-describing schema variant', () => {
  assert.deepEqual(Object.keys(AGENT_PUBLIC_COMMAND_SCHEMAS), AGENT_PUBLIC_COMMAND_TYPES);
  assert.deepEqual(Object.keys(REPRESENTATIVE_PUBLIC_COMMANDS), AGENT_PUBLIC_COMMAND_TYPES);
  for (const type of AGENT_PUBLIC_COMMAND_TYPES) {
    const schema = AGENT_PUBLIC_COMMAND_SCHEMAS[type];
    const command = REPRESENTATIVE_PUBLIC_COMMANDS[type];
    assert.equal(schema.additionalProperties, false, `${type} command envelope`);
    assert.equal(schema.properties.type.const, type);
    assert.equal(schemaMatches(command, schema), true, `${type} representative schema match`);
    assert.deepEqual(validateCommand(command), { valid: true, errors: [] }, `${type} runtime validation`);
    assert.equal(schemaMatches({ ...command, unknownField: true }, schema), false, `${type} rejects unknown envelope fields`);
  }
});

test('WebMCP command schemas reject invalid nested fields, enums, and numeric bounds', () => {
  assert.equal(schemaMatches({
    type: 'set_style', ids: ['shape_a'], updates: { opacity: 2 }
  }, AGENT_PUBLIC_COMMAND_SCHEMAS.set_style), false);
  assert.equal(schemaMatches({
    type: 'set_typography', ids: ['shape_a'], updates: { fontFamily: 'fantasy' }
  }, AGENT_PUBLIC_COMMAND_SCHEMAS.set_typography), false);
  assert.equal(schemaMatches({
    type: 'reconnect_connector', id: 'edge', endpoint: 'to', target: { id: 'shape', x: 3 }
  }, AGENT_PUBLIC_COMMAND_SCHEMAS.reconnect_connector), false);
  assert.equal(schemaMatches({
    type: 'rotate_objects', objects: { shape: { rotation: 45, surprise: true } }
  }, AGENT_PUBLIC_COMMAND_SCHEMAS.rotate_objects), false);
  assert.equal(schemaMatches({
    type: 'create_object', object: { id: 'shape', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, typo: true }
  }, AGENT_PUBLIC_COMMAND_SCHEMAS.create_object), false);
});

test('read returns a copy with raster bytes redacted and useful metadata retained', async () => {
  const agent = makeAgent();
  const read = toolsByName(agent).get('sabura_read_board');
  const result = await read.execute({});
  const asset = result.document.assets.asset_pixel;

  assert.equal(result.success, true);
  assert.equal(asset.data, undefined);
  assert.equal(asset.dataOmitted, true);
  assert.equal(asset.mimeType, 'image/png');
  assert.equal(asset.width, 1);
  assert.equal(asset.height, 1);
  assert.equal(result.rasterDataOmitted, true);
  assert.deepEqual(result.omittedAssetData, [{
    id: 'asset_pixel',
    mimeType: 'image/png',
    dataUrlCharacters: agent.snapshot.document.assets.asset_pixel.data.length
  }]);

  asset.width = 900;
  assert.equal(agent.snapshot.document.assets.asset_pixel.width, 1);
  assert.equal(JSON.stringify(result).includes('iVBORw0KGgo'), false);
});

test('all WebMCP executions delegate to the existing public Agent API facade', async () => {
  const agent = makeAgent();
  const tools = toolsByName(agent);
  const token = { sessionId: 'session_test', sequence: 4 };
  const edit = { requestId: 'edit-1', expectedEditToken: token, commands: [{ type: 'set_title', title: 'Agent' }] };
  const undo = { requestId: 'undo-1', expectedEditToken: token };
  const redo = { requestId: 'redo-1', expectedEditToken: token };

  assert.equal((await tools.get('sabura_edit_board').execute(edit)).success, true);
  assert.equal((await tools.get('sabura_undo').execute(undo)).success, true);
  assert.equal((await tools.get('sabura_redo').execute(redo)).success, true);
  assert.equal((await tools.get('sabura_focus_objects').execute({ ids: ['a', 'b'], padding: 80 })).success, true);
  assert.equal((await tools.get('sabura_fit_board').execute({})).success, true);
  const save = await tools.get('sabura_save_copy').execute({});
  assert.equal(save.deliveryConfirmed, false);

  assert.deepEqual(agent.calls, [
    ['apply', edit],
    ['undo', undo],
    ['redo', redo],
    ['focusObjects', ['a', 'b'], { padding: 80 }],
    ['fitBoard'],
    ['saveCopy']
  ]);
});

test('a pre-aborted WebMCP call cannot mutate the agent or request a download', async () => {
  const agent = makeAgent();
  const tools = toolsByName(agent);
  const controller = new AbortController();
  controller.abort();

  for (const name of SABURA_WEBMCP_TOOL_NAMES) {
    const result = await tools.get(name).execute({}, { signal: controller.signal });
    assert.equal(result.success, false, name);
    assert.equal(result.errors[0].code, 'CANCELLED', name);
  }
  assert.deepEqual(agent.calls, []);
});

test('unsupported browsers no-op without attempting registration', async () => {
  const bridge = new SaburaWebMcpBridge(makeAgent(), null);
  assert.deepEqual(await bridge.register(), { supported: false, registered: [] });
  bridge.dispose();
});

test('registration uses one abort lifecycle and a failure rolls back the entire tool set', async () => {
  const attempted = [];
  const signals = [];
  const modelContext = {
    async registerTool(tool, options) {
      attempted.push(tool.name);
      signals.push(options.signal);
      if (tool.name === 'sabura_redo') throw new Error('experimental browser failure');
    }
  };
  const bridge = new SaburaWebMcpBridge(makeAgent(), modelContext);
  const result = await bridge.register();

  assert.deepEqual(attempted, ['sabura_read_board', 'sabura_edit_board', 'sabura_undo', 'sabura_redo']);
  assert.equal(new Set(signals).size, 1);
  assert.equal(signals[0].aborted, true);
  assert.deepEqual(result, { supported: true, registered: [], failed: true });
});

test('successful registration is idempotent and dispose unregisters all tools', async () => {
  const registrations = [];
  const modelContext = {
    async registerTool(tool, options) {
      registrations.push({ tool, signal: options.signal });
    }
  };
  const bridge = new SaburaWebMcpBridge(makeAgent(), modelContext);
  const first = await bridge.register();
  const second = await bridge.register();

  assert.deepEqual(first, { supported: true, registered: SABURA_WEBMCP_TOOL_NAMES });
  assert.deepEqual(second, first);
  assert.equal(registrations.length, 7);
  assert.equal(registrations.every(item => item.signal === registrations[0].signal), true);
  bridge.dispose();
  assert.equal(registrations[0].signal.aborted, true);
});

test('Sabura public API boot wires the native bridge without exposing internals', async () => {
  const agent = makeAgent();
  const registered = [];
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {};
  globalThis.document = {
    modelContext: {
      async registerTool(tool) {
        registered.push(tool.name);
      }
    }
  };
  try {
    const app = Object.create(SaburaApp.prototype);
    app.agentApi = { publicApi: () => agent };
    app.exposeApi();
    await app.webMcpBridge.register();
    assert.deepEqual(registered, SABURA_WEBMCP_TOOL_NAMES);
    assert.equal(globalThis.window.sabura.agent, agent);
    assert.notEqual(app.webMcpBridge.agent, app.agentApi);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('unexpected adapter exceptions become bounded structured errors', async () => {
  const agent = makeAgent();
  agent.apply = () => { throw new Error('<script>private implementation</script>'); };
  const result = await toolsByName(agent).get('sabura_edit_board').execute({});
  assert.deepEqual(result, {
    success: false,
    errors: [{ code: 'TOOL_EXECUTION_FAILED', message: 'The Sabura tool could not complete the request' }]
  });
});
