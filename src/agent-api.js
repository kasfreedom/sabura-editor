import {
  canonicalJson,
  cloneDocument,
  REVISION_EXTENSION_KEY
} from './core/document.js';
import { validateCommand } from './core/commands.js';
import { CANVAS_SCHEMA_VERSION, COMMANDS_SCHEMA_VERSION } from './core/types.js';

export const AGENT_API_VERSION = 'sabura/agent/v1';

export const AGENT_PUBLIC_COMMAND_TYPES = Object.freeze([
  'create_object',
  'create_image',
  'delete_objects',
  'move_objects',
  'resize_object',
  'set_style',
  'set_image_fit',
  'set_image_opacity',
  'set_typography',
  'set_text',
  'change_shape',
  'group_objects',
  'ungroup_objects',
  'lock_objects',
  'reorder_objects',
  'align_objects',
  'distribute_objects',
  'connect_objects',
  'reconnect_connector',
  'configure_connector',
  'set_board_theme',
  'set_title',
  'update_path_points',
  'rotate_objects'
]);

const PUBLIC_COMMAND_SET = new Set(AGENT_PUBLIC_COMMAND_TYPES);
const REQUEST_CACHE_LIMIT = 64;

const AGENT_EDIT_TOKEN_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    sessionId: { type: 'string', minLength: 1 },
    sequence: { type: 'integer', minimum: 0 }
  },
  required: ['sessionId', 'sequence'],
  additionalProperties: false
});

const ID_SCHEMA = Object.freeze({ type: 'string', minLength: 1 });
const IDS_SCHEMA = Object.freeze({
  type: 'array',
  minItems: 1,
  uniqueItems: true,
  items: ID_SCHEMA
});
const NUMBER_SCHEMA = Object.freeze({ type: 'number' });
const NON_NEGATIVE_NUMBER_SCHEMA = Object.freeze({ type: 'number', minimum: 0 });
const UNIT_NUMBER_SCHEMA = Object.freeze({ type: 'number', minimum: 0, maximum: 1 });
const EXTENSION_PATTERN = Object.freeze({ '^ext:': {} });

const POINT_SCHEMA = Object.freeze({
  type: 'object',
  properties: { x: NUMBER_SCHEMA, y: NUMBER_SCHEMA },
  required: ['x', 'y'],
  patternProperties: EXTENSION_PATTERN,
  additionalProperties: false
});

const PATH_POINT_SCHEMA = Object.freeze({
  oneOf: [
    POINT_SCHEMA,
    {
      type: 'array',
      prefixItems: [NUMBER_SCHEMA, NUMBER_SCHEMA],
      minItems: 2,
      maxItems: 2
    }
  ]
});

const PATH_POINTS_SCHEMA = Object.freeze({
  type: 'array',
  minItems: 2,
  items: PATH_POINT_SCHEMA
});

const BOUNDS_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    x: NUMBER_SCHEMA,
    y: NUMBER_SCHEMA,
    width: NON_NEGATIVE_NUMBER_SCHEMA,
    height: NON_NEGATIVE_NUMBER_SCHEMA
  },
  required: ['x', 'y', 'width', 'height'],
  additionalProperties: false
});

const TEXT_STYLE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    size: { type: 'string', enum: ['s', 'm', 'l', 'xl'] },
    resolvedSize: { type: 'number', exclusiveMinimum: 0 },
    fontFamily: { type: 'string', enum: ['hand', 'sans', 'serif', 'mono'] },
    bold: { type: 'boolean' },
    align: { type: 'string', enum: ['left', 'center', 'right'] },
    color: { type: 'string' }
  },
  patternProperties: EXTENSION_PATTERN,
  additionalProperties: false
});

const TYPOGRAPHY_UPDATES_SCHEMA = Object.freeze({
  ...TEXT_STYLE_SCHEMA,
  minProperties: 1
});

const STYLE_UPDATES_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    fill: { type: 'string' },
    stroke: { type: 'string' },
    strokeWidth: NON_NEGATIVE_NUMBER_SCHEMA,
    strokeStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
    opacity: UNIT_NUMBER_SCHEMA,
    roughness: NON_NEGATIVE_NUMBER_SCHEMA,
    curveStyle: { type: 'string', enum: ['sharp', 'curved'] },
    closed: { type: 'boolean' },
    startArrow: { type: 'boolean' },
    endArrow: { type: 'boolean' }
  },
  minProperties: 1,
  additionalProperties: false
});

const ANCHOR_SCHEMA = Object.freeze({
  type: 'object',
  properties: { x: UNIT_NUMBER_SCHEMA, y: UNIT_NUMBER_SCHEMA },
  required: ['x', 'y'],
  patternProperties: EXTENSION_PATTERN,
  additionalProperties: false
});

const ENDPOINT_SCHEMA = Object.freeze({
  oneOf: [
    {
      type: 'object',
      properties: { id: ID_SCHEMA, anchor: ANCHOR_SCHEMA },
      required: ['id'],
      patternProperties: EXTENSION_PATTERN,
      additionalProperties: false
    },
    {
      type: 'object',
      properties: { point: POINT_SCHEMA },
      required: ['point'],
      patternProperties: EXTENSION_PATTERN,
      additionalProperties: false
    }
  ]
});

const COMMON_OBJECT_PROPERTIES = Object.freeze({
  id: ID_SCHEMA,
  rotation: NUMBER_SCHEMA,
  fill: { type: 'string' },
  stroke: { type: 'string' },
  strokeWidth: NON_NEGATIVE_NUMBER_SCHEMA,
  strokeStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
  opacity: UNIT_NUMBER_SCHEMA,
  roughness: NON_NEGATIVE_NUMBER_SCHEMA,
  seed: { type: 'integer', minimum: 1, maximum: 2147483647 },
  locked: { type: 'boolean' },
  groupId: { type: ['string', 'null'] },
  text: { type: 'string' },
  textStyle: TEXT_STYLE_SCHEMA
});

function persistentObjectSchema(type, extraProperties, required = []) {
  return {
    type: 'object',
    properties: {
      ...COMMON_OBJECT_PROPERTIES,
      type: Array.isArray(type) ? { type: 'string', enum: type } : { const: type },
      ...extraProperties
    },
    required: ['id', 'type', ...required],
    patternProperties: EXTENSION_PATTERN,
    additionalProperties: false
  };
}

const SPATIAL_PROPERTIES = Object.freeze({
  x: NUMBER_SCHEMA,
  y: NUMBER_SCHEMA,
  width: { type: 'number', exclusiveMinimum: 0 },
  height: { type: 'number', exclusiveMinimum: 0 }
});

const CREATE_OBJECT_SCHEMA = Object.freeze({
  oneOf: [
    persistentObjectSchema(
      ['rectangle', 'ellipse', 'diamond', 'triangle'],
      SPATIAL_PROPERTIES,
      ['x', 'y', 'width', 'height']
    ),
    persistentObjectSchema('text', {
      ...SPATIAL_PROPERTIES,
      autoWidth: { type: 'boolean' },
      autoHeight: { type: 'boolean' }
    }, ['x', 'y', 'width', 'height']),
    persistentObjectSchema('path', {
      ...SPATIAL_PROPERTIES,
      points: PATH_POINTS_SCHEMA,
      closed: { type: 'boolean' },
      curveStyle: { type: 'string', enum: ['sharp', 'curved'] },
      startArrow: { type: 'boolean' },
      endArrow: { type: 'boolean' }
    }, ['x', 'y', 'width', 'height', 'points']),
    persistentObjectSchema('connector', {
      from: ENDPOINT_SCHEMA,
      to: ENDPOINT_SCHEMA,
      routing: { type: 'string', enum: ['straight', 'elbow', 'curved'] },
      curveSide: { type: 'integer', enum: [-1, 1] },
      curveDistance: { type: ['number', 'null'], minimum: 0 },
      elbowOffset: { type: ['number', 'null'] },
      startArrow: { type: 'boolean' },
      endArrow: { type: 'boolean' },
      stacking: { type: 'string', enum: ['front', 'back'] }
    }, ['from', 'to'])
  ]
});

const IMAGE_OBJECT_SCHEMA = Object.freeze(persistentObjectSchema('image', {
  ...SPATIAL_PROPERTIES,
  assetId: ID_SCHEMA,
  fit: { type: 'string', enum: ['contain', 'cover'] }
}, ['x', 'y', 'width', 'height', 'assetId']));

const RASTER_ASSET_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    id: ID_SCHEMA,
    type: { const: 'raster' },
    data: { type: 'string', minLength: 1 },
    mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
    width: { type: 'number', exclusiveMinimum: 0, maximum: 16384 },
    height: { type: 'number', exclusiveMinimum: 0, maximum: 16384 }
  },
  required: ['id', 'type', 'data', 'mimeType', 'width', 'height'],
  patternProperties: EXTENSION_PATTERN,
  additionalProperties: false
});

const THEME_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    background: { type: 'string', minLength: 1 },
    gridColor: { type: 'string' },
    palette: { type: 'array', minItems: 1, items: { type: 'string' } },
    defaultFill: { type: 'string' },
    defaultStroke: { type: 'string' },
    defaultStrokeWidth: NON_NEGATIVE_NUMBER_SCHEMA,
    defaultOpacity: UNIT_NUMBER_SCHEMA,
    defaultRoughness: NON_NEGATIVE_NUMBER_SCHEMA,
    defaultFontFamily: { type: 'string', enum: ['hand', 'sans', 'serif', 'mono'] },
    defaultFontSize: { type: 'string', enum: ['s', 'm', 'l', 'xl'] }
  },
  minProperties: 1,
  patternProperties: EXTENSION_PATTERN,
  additionalProperties: false
});

const CONNECTOR_CONFIG_PROPERTIES = Object.freeze({
  routing: { type: 'string', enum: ['straight', 'elbow', 'curved'] },
  curveSide: { type: 'integer', enum: [-1, 1] },
  curveDistance: { type: ['number', 'null'], minimum: 0 },
  elbowOffset: { type: ['number', 'null'] },
  startArrow: { type: 'boolean' },
  endArrow: { type: 'boolean' },
  stacking: { type: 'string', enum: ['front', 'back'] }
});

const CONNECTOR_CREATION_PROPERTIES = Object.freeze({
  ...CONNECTOR_CONFIG_PROPERTIES,
  stroke: { type: 'string' },
  strokeWidth: NON_NEGATIVE_NUMBER_SCHEMA,
  strokeStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
  opacity: UNIT_NUMBER_SCHEMA,
  roughness: NON_NEGATIVE_NUMBER_SCHEMA
});

const ROTATION_ENTRY_SCHEMA = Object.freeze({
  type: 'object',
  properties: { rotation: NUMBER_SCHEMA, x: NUMBER_SCHEMA, y: NUMBER_SCHEMA },
  required: ['rotation'],
  additionalProperties: false
});

const FREE_ENDPOINT_ENTRY_SCHEMA = Object.freeze({
  type: 'object',
  properties: { from: POINT_SCHEMA, to: POINT_SCHEMA },
  minProperties: 1,
  additionalProperties: false
});

function commandSchema(type, properties, required, extra = {}) {
  return {
    type: 'object',
    description: `A validated Sabura ${type} command.`,
    properties: { type: { const: type }, ...properties },
    required: ['type', ...required],
    additionalProperties: false,
    ...extra
  };
}

export const AGENT_PUBLIC_COMMAND_SCHEMAS = Object.freeze({
  create_object: commandSchema('create_object', {
    object: CREATE_OBJECT_SCHEMA,
    atIndex: { type: 'integer', minimum: 0 }
  }, ['object']),
  create_image: commandSchema('create_image', {
    object: IMAGE_OBJECT_SCHEMA,
    asset: RASTER_ASSET_SCHEMA,
    atIndex: { type: 'integer', minimum: 0 }
  }, ['object', 'asset']),
  delete_objects: commandSchema('delete_objects', { ids: IDS_SCHEMA }, ['ids']),
  move_objects: commandSchema('move_objects', { ids: IDS_SCHEMA, dx: NUMBER_SCHEMA, dy: NUMBER_SCHEMA }, ['ids', 'dx', 'dy']),
  resize_object: commandSchema('resize_object', {
    id: ID_SCHEMA,
    bounds: BOUNDS_SCHEMA,
    points: PATH_POINTS_SCHEMA,
    scaleText: { type: 'boolean' },
    textStyle: TEXT_STYLE_SCHEMA
  }, ['id', 'bounds']),
  set_style: commandSchema('set_style', { ids: IDS_SCHEMA, updates: STYLE_UPDATES_SCHEMA }, ['ids', 'updates']),
  set_image_fit: commandSchema('set_image_fit', { id: ID_SCHEMA, fit: { type: 'string', enum: ['contain', 'cover'] } }, ['id', 'fit']),
  set_image_opacity: commandSchema('set_image_opacity', { id: ID_SCHEMA, opacity: UNIT_NUMBER_SCHEMA }, ['id', 'opacity']),
  set_typography: commandSchema('set_typography', { ids: IDS_SCHEMA, updates: TYPOGRAPHY_UPDATES_SCHEMA }, ['ids', 'updates']),
  set_text: commandSchema('set_text', { id: ID_SCHEMA, text: { type: 'string' } }, ['id', 'text']),
  change_shape: commandSchema('change_shape', {
    id: ID_SCHEMA,
    newType: { type: 'string', enum: ['rectangle', 'ellipse', 'diamond', 'triangle', 'text'] }
  }, ['id', 'newType']),
  group_objects: commandSchema('group_objects', { ids: IDS_SCHEMA, groupId: ID_SCHEMA, name: { type: 'string' } }, ['ids', 'groupId']),
  ungroup_objects: commandSchema('ungroup_objects', { groupIds: IDS_SCHEMA }, ['groupIds']),
  lock_objects: commandSchema('lock_objects', { ids: IDS_SCHEMA, locked: { type: 'boolean' } }, ['ids', 'locked']),
  reorder_objects: commandSchema('reorder_objects', {
    ids: IDS_SCHEMA,
    action: { type: 'string', enum: ['front', 'back', 'forward', 'backward'] }
  }, ['ids', 'action']),
  align_objects: commandSchema('align_objects', {
    ids: IDS_SCHEMA,
    alignment: { type: 'string', enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'] }
  }, ['ids', 'alignment']),
  distribute_objects: commandSchema('distribute_objects', {
    ids: IDS_SCHEMA,
    direction: { type: 'string', enum: ['horizontal', 'vertical'] }
  }, ['ids', 'direction']),
  connect_objects: commandSchema('connect_objects', {
    connectorId: ID_SCHEMA,
    fromId: ID_SCHEMA,
    toId: ID_SCHEMA,
    fromAnchor: ANCHOR_SCHEMA,
    toAnchor: ANCHOR_SCHEMA,
    ...CONNECTOR_CREATION_PROPERTIES
  }, ['connectorId', 'fromId', 'toId']),
  reconnect_connector: commandSchema('reconnect_connector', {
    id: ID_SCHEMA,
    endpoint: { type: 'string', enum: ['from', 'to'] },
    target: ENDPOINT_SCHEMA
  }, ['id', 'endpoint', 'target']),
  configure_connector: commandSchema('configure_connector', {
    id: ID_SCHEMA,
    ...CONNECTOR_CONFIG_PROPERTIES
  }, ['id']),
  set_board_theme: commandSchema('set_board_theme', {
    themeId: { type: 'string', enum: ['paper', 'blueprint', 'night', 'high-contrast'] },
    theme: THEME_SCHEMA
  }, [], { anyOf: [{ required: ['themeId'] }, { required: ['theme'] }] }),
  set_title: commandSchema('set_title', { title: { type: 'string' } }, ['title']),
  update_path_points: commandSchema('update_path_points', {
    id: ID_SCHEMA,
    points: PATH_POINTS_SCHEMA,
    bounds: BOUNDS_SCHEMA
  }, ['id', 'points']),
  rotate_objects: commandSchema('rotate_objects', {
    objects: {
      type: 'object',
      minProperties: 1,
      additionalProperties: ROTATION_ENTRY_SCHEMA
    },
    freeEndpoints: {
      type: 'object',
      additionalProperties: FREE_ENDPOINT_ENTRY_SCHEMA
    }
  }, ['objects'])
});

/**
 * Public JSON Schemas shared by live-agent discovery and the optional WebMCP
 * adapter. The core command validator remains the authority for command fields
 * and document-aware invariants.
 */
export const AGENT_COMMAND_INPUT_SCHEMA = Object.freeze({
  oneOf: AGENT_PUBLIC_COMMAND_TYPES.map(type => AGENT_PUBLIC_COMMAND_SCHEMAS[type])
});

export const AGENT_EDIT_REQUEST_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    requestId: { type: 'string', minLength: 1, maxLength: 200 },
    expectedEditToken: AGENT_EDIT_TOKEN_SCHEMA,
    commands: {
      type: 'array',
      minItems: 1,
      items: AGENT_COMMAND_INPUT_SCHEMA
    }
  },
  required: ['requestId', 'expectedEditToken', 'commands'],
  additionalProperties: false
});

export const AGENT_HISTORY_REQUEST_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    requestId: { type: 'string', minLength: 1, maxLength: 200 },
    expectedEditToken: AGENT_EDIT_TOKEN_SCHEMA
  },
  required: ['requestId', 'expectedEditToken'],
  additionalProperties: false
});

const COMMAND_SCHEMAS = Object.freeze({
  create_object: { required: ['object.id', 'object.type'] },
  create_image: { required: ['object.id', 'object.type=image', 'object.assetId', 'asset.id', 'asset.type=raster'] },
  delete_objects: { required: ['ids[]'] },
  move_objects: { required: ['ids[]', 'dx', 'dy'] },
  resize_object: { required: ['id', 'bounds{x,y,width,height}'] },
  set_style: { required: ['ids[]', 'updates{}'] },
  set_image_fit: { required: ['id', 'fit'] },
  set_image_opacity: { required: ['id', 'opacity'] },
  set_typography: { required: ['ids[]', 'updates{}'] },
  set_text: { required: ['id', 'text'] },
  change_shape: { required: ['id', 'newType'] },
  group_objects: { required: ['ids[]', 'groupId'] },
  ungroup_objects: { required: ['groupIds[]'] },
  lock_objects: { required: ['ids[]', 'locked'] },
  reorder_objects: { required: ['ids[]', 'action'] },
  align_objects: { required: ['ids[]', 'alignment'] },
  distribute_objects: { required: ['ids[]', 'direction'] },
  connect_objects: { required: ['connectorId', 'fromId', 'toId'], optional: ['fromAnchor', 'toAnchor', 'routing', 'startArrow', 'endArrow', 'style fields'] },
  reconnect_connector: { required: ['id', 'endpoint', 'target'] },
  configure_connector: { required: ['id'], optional: ['routing', 'curveSide', 'curveDistance', 'elbowOffset', 'startArrow', 'endArrow', 'stacking'] },
  set_board_theme: { required: ['theme or themeId'] },
  set_title: { required: ['title'] },
  update_path_points: { required: ['id', 'points[]'], optional: ['bounds'] },
  rotate_objects: { required: ['objects{id:{rotation,...}}'], optional: ['freeEndpoints'] }
});

function makeSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `session_${crypto.randomUUID()}`;
  }
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function safeMessage(value) {
  const message = String(value || 'Operation failed')
    .replace(/<[^>]*>/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return (message || 'Operation failed').slice(0, 400);
}

function failure(code, message, details = {}) {
  const { errorDetails = {}, ...resultDetails } = details;
  return {
    success: false,
    ...resultDetails,
    errors: [{ code, message: safeMessage(message), ...errorDetails }]
  };
}

function tokenEquals(left, right) {
  return Boolean(left && right &&
    left.sessionId === right.sessionId &&
    Number.isInteger(left.sequence) &&
    left.sequence === right.sequence);
}

function objectDiff(before, after) {
  const beforeObjects = before?.objects || {};
  const afterObjects = after?.objects || {};
  const created = [];
  const updated = [];
  const deleted = [];

  for (const id of Object.keys(afterObjects)) {
    if (!beforeObjects[id]) created.push(id);
    else if (canonicalJson(beforeObjects[id]) !== canonicalJson(afterObjects[id])) updated.push(id);
  }
  for (const id of Object.keys(beforeObjects)) {
    if (!afterObjects[id]) deleted.push(id);
  }

  const directlyAffected = new Set([...created, ...updated, ...deleted]);
  const renderAffected = new Set(directlyAffected);
  for (const doc of [before, after]) {
    for (const object of Object.values(doc?.objects || {})) {
      if (object?.type !== 'connector') continue;
      if (directlyAffected.has(object.from?.id) || directlyAffected.has(object.to?.id)) {
        renderAffected.add(object.id);
      }
    }
  }

  return {
    created: created.sort(),
    updated: updated.sort(),
    deleted: deleted.sort(),
    renderAffected: [...renderAffected].sort()
  };
}

function executionError(error, requestId) {
  const message = safeMessage(error?.message || error);
  const indexMatch = message.match(/command \[(\d+)\]/i);
  const errorDetails = indexMatch ? { commandIndex: Number(indexMatch[1]) } : {};
  const code = /validation|invalid|already exists|non-existent|not found/i.test(message)
    ? 'INVALID_COMMAND'
    : 'EXECUTION_FAILED';
  return failure(code, message, { requestId, errorDetails });
}

export class AgentApi {
  constructor(app) {
    this.app = app;
    this.sessionId = makeSessionId();
    this.sequence = 0;
    this.requestCache = new Map();
  }

  recordDocumentChange() {
    this.sequence += 1;
  }

  editToken() {
    return { sessionId: this.sessionId, sequence: this.sequence };
  }

  describe() {
    return cloneDocument({
      apiVersion: AGENT_API_VERSION,
      documentSchemaVersion: CANVAS_SCHEMA_VERSION,
      commandSchemaVersion: COMMANDS_SCHEMA_VERSION,
      operations: ['describe', 'read', 'apply', 'undo', 'redo', 'fitBoard', 'focusObjects', 'saveCopy', 'subscribe'],
      supportedCommands: AGENT_PUBLIC_COMMAND_TYPES,
      commandSchemas: COMMAND_SCHEMAS,
      editRequestSchema: AGENT_EDIT_REQUEST_SCHEMA,
      historyRequestSchema: AGENT_HISTORY_REQUEST_SCHEMA,
      capabilities: {
        atomicBatches: true,
        optimisticConcurrency: true,
        sessionIdempotency: true,
        explicitCreatedIds: true,
        copiedSnapshots: true,
        undoRedo: true,
        subscriptions: true,
        fitBoard: true,
        focusObjects: true,
        selfContainedSaveCopy: true
      }
    });
  }

  busyState({ forEdit = false } = {}) {
    if (this.app.isCorrupted) return { busy: true, reason: 'corrupted-document' };
    if (this.app.inPresentation) return { busy: true, reason: 'presentation' };
    if (forEdit && this.app.mode !== 'editing') return { busy: true, reason: 'reading-mode' };
    if (this.app.isSaving) return { busy: true, reason: 'saving' };
    if (this.app.pendingImageReader || this.app.pendingImageDecode) return { busy: true, reason: 'image-import' };
    if (this.app.textEditor?.targetObject || this.app.textEditor?.textarea?.style?.display === 'block') {
      return { busy: true, reason: 'text-editing' };
    }
    if (this.app.workspace?.hasActiveInteraction?.()) return { busy: true, reason: 'pointer-interaction' };
    return { busy: false, reason: null };
  }

  viewportSnapshot() {
    const workspace = this.app.workspace;
    const rect = workspace?.container?.getBoundingClientRect?.();
    return {
      camera: workspace?.camera ? { ...workspace.camera } : null,
      size: rect ? { width: rect.width, height: rect.height } : null,
      canFitBoard: Boolean(workspace?.fitToContent),
      canFocusObjects: Boolean(workspace?.focusObjects)
    };
  }

  read() {
    return {
      success: !this.app.isCorrupted,
      apiVersion: AGENT_API_VERSION,
      editToken: this.editToken(),
      document: this.app.doc ? cloneDocument(this.app.doc) : null,
      selection: {
        ids: [...(this.app.workspace?.selectedIds || [])],
        activeGroupId: this.app.workspace?.activeGroupId || null
      },
      viewport: this.viewportSnapshot(),
      mode: this.app.mode,
      busy: this.busyState(),
      history: {
        canUndo: Boolean(this.app.undoStack?.length),
        canRedo: Boolean(this.app.redoStack?.length)
      },
      savedRevision: this.app.doc?.[REVISION_EXTENSION_KEY]
        ? cloneDocument(this.app.doc[REVISION_EXTENSION_KEY])
        : null
    };
  }

  validateRequest(request, operation) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      return failure('INVALID_REQUEST', `${operation} requires a request object`);
    }
    if (typeof request.requestId !== 'string' || !request.requestId.trim()) {
      return failure('INVALID_REQUEST', 'requestId must be a non-empty string');
    }
    if (request.requestId.length > 200) {
      return failure('INVALID_REQUEST', 'requestId must not exceed 200 characters', { requestId: request.requestId });
    }
    if (!request.expectedEditToken || typeof request.expectedEditToken !== 'object') {
      return failure('INVALID_REQUEST', 'expectedEditToken is required', { requestId: request.requestId });
    }
    return null;
  }

  requestFingerprint(operation, request) {
    try {
      return canonicalJson({
        operation,
        expectedEditToken: request.expectedEditToken,
        commands: request.commands
      });
    } catch (_) {
      return null;
    }
  }

  cachedResult(requestId, fingerprint) {
    const cached = this.requestCache.get(requestId);
    if (!cached) return null;
    if (cached.fingerprint !== fingerprint) {
      return failure('REQUEST_ID_REUSE', 'requestId was already used with a different request', { requestId });
    }
    return cloneDocument(cached.result);
  }

  remember(requestId, fingerprint, result) {
    this.requestCache.set(requestId, { fingerprint, result: cloneDocument(result) });
    while (this.requestCache.size > REQUEST_CACHE_LIMIT) {
      this.requestCache.delete(this.requestCache.keys().next().value);
    }
    return result;
  }

  preconditionFailure(request, operation) {
    const invalid = this.validateRequest(request, operation);
    if (invalid) return { result: invalid, fingerprint: null };
    const fingerprint = this.requestFingerprint(operation, request);
    if (!fingerprint) {
      return {
        result: failure('INVALID_REQUEST', 'Request must contain JSON-serializable data', { requestId: request.requestId }),
        fingerprint: null
      };
    }
    const cached = this.cachedResult(request.requestId, fingerprint);
    if (cached) return { result: cached, fingerprint };
    const busy = this.busyState({ forEdit: true });
    if (busy.busy) {
      const code = busy.reason === 'reading-mode' ? 'NOT_EDITABLE' : 'EDITOR_BUSY';
      return {
        result: failure(code, `Agent edits are unavailable while the editor is in ${busy.reason}`, {
          requestId: request.requestId,
          currentEditToken: this.editToken()
        }),
        fingerprint
      };
    }
    if (!tokenEquals(request.expectedEditToken, this.editToken())) {
      return {
        result: failure('STALE_EDIT', 'The live document changed after the agent snapshot', {
          requestId: request.requestId,
          currentEditToken: this.editToken()
        }),
        fingerprint
      };
    }
    return { result: null, fingerprint };
  }

  validateAgentCommands(commands, requestId) {
    if (!Array.isArray(commands)) {
      return failure('INVALID_REQUEST', 'commands must be an array', { requestId });
    }
    const createdIds = new Set();
    const createdAssetIds = new Set();
    const createdGroupIds = new Set();
    for (let index = 0; index < commands.length; index++) {
      const command = commands[index];
      if (!command || typeof command !== 'object' || !PUBLIC_COMMAND_SET.has(command.type)) {
        return failure('UNSUPPORTED_COMMAND', `Command type "${command?.type || 'unknown'}" is not public`, {
          requestId,
          errorDetails: { commandIndex: index, path: `commands[${index}].type` }
        });
      }
      const validation = validateCommand(command);
      if (!validation.valid) {
        return failure('INVALID_COMMAND', validation.errors.join(', '), {
          requestId,
          errorDetails: { commandIndex: index, path: `commands[${index}]` }
        });
      }

      const requireNewId = (id, kind, existing, seen, path) => {
        if (typeof id !== 'string' || !id.trim()) {
          return failure('EXPLICIT_ID_REQUIRED', `Agent-created ${kind} requires an explicit ID`, {
            requestId,
            errorDetails: { commandIndex: index, path }
          });
        }
        if (existing?.[id] || seen.has(id)) {
          return failure('ID_COLLISION', `${kind} ID "${id}" already exists`, {
            requestId,
            errorDetails: { commandIndex: index, path }
          });
        }
        seen.add(id);
        return null;
      };

      let idFailure = null;
      if (command.type === 'create_object') {
        idFailure = requireNewId(command.object?.id, 'object', this.app.doc?.objects, createdIds, `commands[${index}].object.id`);
      } else if (command.type === 'create_image') {
        idFailure = requireNewId(command.object?.id, 'object', this.app.doc?.objects, createdIds, `commands[${index}].object.id`) ||
          requireNewId(command.asset?.id, 'asset', this.app.doc?.assets, createdAssetIds, `commands[${index}].asset.id`);
      } else if (command.type === 'connect_objects') {
        idFailure = requireNewId(command.connectorId, 'connector', this.app.doc?.objects, createdIds, `commands[${index}].connectorId`);
      } else if (command.type === 'group_objects') {
        idFailure = requireNewId(command.groupId, 'group', this.app.doc?.groups, createdGroupIds, `commands[${index}].groupId`);
      }
      if (idFailure) return idFailure;
    }
    return null;
  }

  apply(request) {
    const precondition = this.preconditionFailure(request, 'apply');
    if (precondition.result) return precondition.result;
    const invalidCommands = this.validateAgentCommands(request.commands, request.requestId);
    if (invalidCommands) return this.remember(request.requestId, precondition.fingerprint, invalidCommands);

    const before = cloneDocument(this.app.doc);
    const editTokenBefore = this.editToken();
    try {
      const changed = this.app.dispatchCommandBatch(cloneDocument(request.commands));
      const result = {
        success: true,
        requestId: request.requestId,
        changed,
        editTokenBefore,
        editTokenAfter: this.editToken(),
        affected: objectDiff(before, this.app.doc)
      };
      return this.remember(request.requestId, precondition.fingerprint, result);
    } catch (error) {
      return this.remember(request.requestId, precondition.fingerprint, executionError(error, request.requestId));
    }
  }

  historyOperation(operation, request) {
    const precondition = this.preconditionFailure(request, operation);
    if (precondition.result) return precondition.result;
    const before = cloneDocument(this.app.doc);
    const editTokenBefore = this.editToken();
    try {
      const changed = operation === 'undo' ? this.app.undo() : this.app.redo();
      const result = {
        success: true,
        requestId: request.requestId,
        changed,
        editTokenBefore,
        editTokenAfter: this.editToken(),
        affected: objectDiff(before, this.app.doc)
      };
      return this.remember(request.requestId, precondition.fingerprint, result);
    } catch (error) {
      return this.remember(request.requestId, precondition.fingerprint, executionError(error, request.requestId));
    }
  }

  fitBoard() {
    const busy = this.busyState();
    if (busy.busy) return failure('EDITOR_BUSY', `Cannot fit the board while the editor is in ${busy.reason}`);
    if (!this.app.workspace?.fitToContent) return failure('VIEWPORT_UNAVAILABLE', 'Board viewport is unavailable');
    this.app.workspace.fitToContent(60);
    return { success: true, changed: false, editToken: this.editToken(), viewport: this.viewportSnapshot() };
  }

  focusObjects(ids, options = {}) {
    const busy = this.busyState();
    if (busy.busy) return failure('EDITOR_BUSY', `Cannot focus objects while the editor is in ${busy.reason}`);
    if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== 'string' || !id.trim())) {
      return failure('INVALID_REQUEST', 'focusObjects requires a non-empty array of object IDs');
    }
    const missing = ids.filter(id => !this.app.doc?.objects?.[id]);
    if (missing.length > 0) {
      return failure('OBJECT_NOT_FOUND', `Unknown object IDs: ${missing.join(', ')}`, { missingIds: missing });
    }
    const padding = options && Number.isFinite(options.padding)
      ? Math.max(0, Math.min(400, options.padding))
      : 60;
    if (!this.app.workspace?.focusObjects?.(ids, padding)) {
      return failure('VIEWPORT_UNAVAILABLE', 'Objects do not have focusable geometry');
    }
    return { success: true, changed: false, editToken: this.editToken(), focusedIds: [...ids], viewport: this.viewportSnapshot() };
  }

  saveCopy() {
    const busy = this.busyState();
    if (busy.busy) return failure('EDITOR_BUSY', `Cannot save while the editor is in ${busy.reason}`);
    const result = this.app.saveCopy();
    if (!result?.success) return failure('EXPORT_FAILED', result?.error || 'Save Copy failed');
    return {
      success: true,
      exportPrepared: true,
      downloadRequested: true,
      deliveryConfirmed: false,
      filename: result.filename,
      byteLength: result.byteLength,
      revisionId: result.revisionId,
      parentId: result.parentId || null,
      changed: result.changed
    };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Agent subscriber must be a function');
    const wrapped = () => listener(this.read());
    this.app.subscribers.add(wrapped);
    return () => this.app.subscribers.delete(wrapped);
  }

  publicApi() {
    return Object.freeze({
      describe: () => this.describe(),
      read: () => this.read(),
      apply: request => this.apply(request),
      undo: request => this.historyOperation('undo', request),
      redo: request => this.historyOperation('redo', request),
      fitBoard: () => this.fitBoard(),
      focusObjects: (ids, options) => this.focusObjects(ids, options),
      saveCopy: () => this.saveCopy(),
      subscribe: listener => this.subscribe(listener)
    });
  }
}
