/**
 * Sabura Document Management: Schema, Validation, Factory, and Canonical Serialization.
 */

import {
  CANVAS_SCHEMA_VERSION,
  THEME_PRESETS,
  FONT_SIZES,
  MIN_OBJECT_SIZE,
  OBJECT_TYPES,
  CONNECTOR_ROUTINGS,
  STROKE_STYLES
} from './types.js';
import { measureText } from './geometry.js';
import {
  REVISION_EXTENSION_KEY,
  REVISION_ALLOWED_FIELDS,
  computeSha256,
  generateRevisionId,
  getShortRevisionId,
  computeContentDigest,
  validateRevisionMetadata,
  transitionRevision,
  setDefaultNormalizeFn
} from './revision.js';

export {
  REVISION_EXTENSION_KEY,
  REVISION_ALLOWED_FIELDS,
  computeSha256,
  generateRevisionId,
  getShortRevisionId,
  computeContentDigest,
  validateRevisionMetadata,
  transitionRevision
};

/**
 * Generate a random stable alphanumeric ID.
 * @param {string} prefix
 * @returns {string}
 */
export function generateId(prefix = 'obj') {
  const rand = Math.random().toString(36).substring(2, 9);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}_${rand}${time}`;
}

/**
 * Generate a deterministic 32-bit positive integer seed.
 * @returns {number}
 */
export function generateSeed() {
  return Math.floor(Math.random() * 2147483647) + 1;
}

/**
 * Creates a valid, empty Sabura document.
 * @param {Partial<{ id: string, title: string, themeId: string }>} options
 * @returns {Object}
 */
export function createDefaultDocument(options = {}) {
  const themeId = options.themeId && THEME_PRESETS[options.themeId] ? options.themeId : 'paper';
  const theme = JSON.parse(JSON.stringify(THEME_PRESETS[themeId]));

  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    id: options.id || generateId('board'),
    title: options.title || 'Untitled Board',
    theme,
    objects: {},
    order: [],
    groups: {},
    assets: {}
  };
}

/**
 * Creates a default Sabura object matching schema requirements.
 * @param {string} type
 * @param {Object} overrides
 * @param {Object} theme
 * @returns {Object}
 */
export function createDefaultObject(type, overrides = {}, theme = THEME_PRESETS.paper) {
  const safeTheme = normalizeTheme(theme);
  const id = overrides.id || generateId(type.slice(0, 4));
  const seed = overrides.seed !== undefined ? overrides.seed : generateSeed();
  const fontSizeToken = overrides.textStyle?.size || safeTheme.defaultFontSize;
  const resolvedSize = FONT_SIZES[fontSizeToken] || 20;

  let defaultWidth = type === 'text' ? 80 : 160;
  let defaultHeight = type === 'text' ? 32 : 100;
  if (type === 'text' && overrides.text) {
    const familyToken = overrides.textStyle?.fontFamily || safeTheme.defaultFontFamily;
    const m = measureText(overrides.text, resolvedSize, familyToken);
    defaultWidth = m.width;
    defaultHeight = m.height;
  }

  const width = Math.max(MIN_OBJECT_SIZE, overrides.width !== undefined ? overrides.width : defaultWidth);
  const height = Math.max(MIN_OBJECT_SIZE, overrides.height !== undefined ? overrides.height : defaultHeight);

  const baseObject = {
    id,
    type,
    rotation: overrides.rotation || 0,
    fill: overrides.fill !== undefined ? overrides.fill : safeTheme.defaultFill,
    stroke: overrides.stroke !== undefined ? overrides.stroke : safeTheme.defaultStroke,
    strokeWidth: overrides.strokeWidth !== undefined ? overrides.strokeWidth : safeTheme.defaultStrokeWidth,
    strokeStyle: overrides.strokeStyle || 'solid',
    opacity: overrides.opacity !== undefined ? overrides.opacity : safeTheme.defaultOpacity,
    roughness: overrides.roughness !== undefined ? overrides.roughness : safeTheme.defaultRoughness,
    seed,
    locked: overrides.locked || false,
    groupId: overrides.groupId || null,
    text: overrides.text !== undefined ? overrides.text : '',
    textStyle: {
      size: fontSizeToken,
      resolvedSize,
      fontFamily: overrides.textStyle?.fontFamily || safeTheme.defaultFontFamily,
      bold: overrides.textStyle?.bold || false,
      align: overrides.textStyle?.align || (type === 'text' ? 'left' : 'center'),
      color: overrides.textStyle?.color || overrides.stroke || safeTheme.defaultStroke
    }
  };

  if (type === 'connector') {
    baseObject.from = overrides.from || { point: { x: overrides.x !== undefined ? overrides.x : 0, y: overrides.y !== undefined ? overrides.y : 0 } };
    baseObject.to = overrides.to || { point: { x: (overrides.x !== undefined ? overrides.x : 0) + 160, y: (overrides.y !== undefined ? overrides.y : 0) + 100 } };
    baseObject.routing = overrides.routing || 'straight'; // 'straight' | 'elbow' | 'curved'
    baseObject.curveSide = overrides.curveSide !== undefined ? overrides.curveSide : 1;
    if (overrides.curveDistance !== undefined) baseObject.curveDistance = overrides.curveDistance;
    if (overrides.elbowOffset !== undefined) baseObject.elbowOffset = overrides.elbowOffset;
    baseObject.startArrow = overrides.startArrow || false;
    baseObject.endArrow = overrides.endArrow !== undefined ? overrides.endArrow : true;
  } else {
    baseObject.x = overrides.x !== undefined ? overrides.x : 0;
    baseObject.y = overrides.y !== undefined ? overrides.y : 0;
    baseObject.width = width;
    baseObject.height = height;
    if (type === 'path') {
      baseObject.points = Array.isArray(overrides.points) ? overrides.points : [{ x: 0, y: 0 }, { x: width, y: height }];
      baseObject.closed = overrides.closed !== undefined ? overrides.closed : false;
      baseObject.curveStyle = overrides.curveStyle || 'sharp';
      baseObject.startArrow = overrides.startArrow || false;
      baseObject.endArrow = overrides.endArrow || false;
    }
  }

  // Preserve any additional fields for custom namespaces
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in baseObject)) {
      baseObject[key] = value;
    }
  }

  return baseObject;
}

/**
 * Validates a Sabura document structure against the canonical schema.
 * @param {any} doc
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const DOCUMENT_ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'id',
  'title',
  'theme',
  'objects',
  'order',
  'groups',
  'assets'
]);

export const THEME_ALLOWED_FIELDS = new Set([
  'id',
  'name',
  'background',
  'gridColor',
  'palette',
  'defaultFill',
  'defaultStroke',
  'defaultStrokeWidth',
  'defaultOpacity',
  'defaultRoughness',
  'defaultFontFamily',
  'defaultFontSize'
]);

export const GROUP_ALLOWED_FIELDS = new Set([
  'id',
  'name',
  'collapsed'
]);

export const ASSET_ALLOWED_FIELDS = new Set([
  'id',
  'type',
  'data',
  'mimeType',
  'width',
  'height'
]);

export const TEXT_STYLE_ALLOWED_FIELDS = new Set([
  'size',
  'resolvedSize',
  'fontFamily',
  'bold',
  'align',
  'color'
]);

export const OBJECT_COMMON_FIELDS = new Set([
  'id',
  'type',
  'rotation',
  'fill',
  'stroke',
  'strokeWidth',
  'strokeStyle',
  'opacity',
  'roughness',
  'seed',
  'locked',
  'groupId',
  'text',
  'textStyle'
]);

export const SHAPE_ALLOWED_FIELDS = new Set([...OBJECT_COMMON_FIELDS, 'x', 'y', 'width', 'height']);
export const TEXT_ALLOWED_FIELDS = new Set([...OBJECT_COMMON_FIELDS, 'x', 'y', 'width', 'height', 'autoWidth', 'autoHeight']);
export const CONNECTOR_ALLOWED_FIELDS = new Set([
  ...OBJECT_COMMON_FIELDS,
  'from',
  'to',
  'routing',
  'curveSide',
  'curveDistance',
  'elbowOffset',
  'startArrow',
  'endArrow',
  'stacking'
]);
export const PATH_ALLOWED_FIELDS = new Set([
  ...OBJECT_COMMON_FIELDS,
  'x',
  'y',
  'width',
  'height',
  'points',
  'closed',
  'curveStyle',
  'startArrow',
  'endArrow'
]);

export const CONNECTOR_ENDPOINT_ID_ALLOWED_FIELDS = new Set(['id', 'anchor']);
export const CONNECTOR_ENDPOINT_POINT_ALLOWED_FIELDS = new Set(['point']);
export const CONNECTOR_ANCHOR_ALLOWED_FIELDS = new Set(['x', 'y']);
export const CONNECTOR_POINT_ALLOWED_FIELDS = new Set(['x', 'y']);
export const PATH_POINT_ALLOWED_FIELDS = new Set(['x', 'y']);

export const DEFAULT_THEME_VALUES = Object.freeze({
  defaultStroke: '#1e1e1e',
  defaultStrokeWidth: 2,
  defaultFill: 'none',
  defaultOpacity: 1.0,
  defaultRoughness: 1,
  defaultFontSize: 'm',
  defaultFontFamily: 'hand',
  gridColor: 'rgba(0, 0, 0, 0.08)'
});

export function normalizeTheme(theme) {
  if (!theme || typeof theme !== 'object') {
    return { background: '#fcfaf6', palette: ['#1e1e1e'], ...DEFAULT_THEME_VALUES };
  }
  const normalized = { ...theme };
  if (normalized.defaultStroke === undefined) normalized.defaultStroke = DEFAULT_THEME_VALUES.defaultStroke;
  if (normalized.defaultStrokeWidth === undefined) normalized.defaultStrokeWidth = DEFAULT_THEME_VALUES.defaultStrokeWidth;
  if (normalized.defaultFill === undefined) normalized.defaultFill = DEFAULT_THEME_VALUES.defaultFill;
  if (normalized.defaultOpacity === undefined) normalized.defaultOpacity = DEFAULT_THEME_VALUES.defaultOpacity;
  if (normalized.defaultRoughness === undefined) normalized.defaultRoughness = DEFAULT_THEME_VALUES.defaultRoughness;
  if (normalized.defaultFontSize === undefined) normalized.defaultFontSize = DEFAULT_THEME_VALUES.defaultFontSize;
  if (normalized.defaultFontFamily === undefined) normalized.defaultFontFamily = DEFAULT_THEME_VALUES.defaultFontFamily;
  if (normalized.gridColor === undefined) normalized.gridColor = DEFAULT_THEME_VALUES.gridColor;
  return normalized;
}

/**
 * Computes a deterministic non-negative 31-bit integer seed from an object ID.
 * Guarantees that omitted seeds normalize identically on repeated loads.
 * @param {string} id
 * @returns {number}
 */
export function deterministicSeedFromId(id) {
  const str = String(id || '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h & 0x7fffffff) || 1;
}

export function getAllowedFieldsForType(type) {
  if (['rectangle', 'ellipse', 'diamond', 'triangle'].includes(type)) return SHAPE_ALLOWED_FIELDS;
  if (type === 'text') return TEXT_ALLOWED_FIELDS;
  if (type === 'connector') return CONNECTOR_ALLOWED_FIELDS;
  if (type === 'path') return PATH_ALLOWED_FIELDS;
  return OBJECT_COMMON_FIELDS;
}

function checkUnknownProperties(obj, allowedSet, context, errors) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const key of Object.keys(obj)) {
    if (!key.startsWith('ext:') && !allowedSet.has(key)) {
      errors.push(`Unknown unnamespaced property "${key}" on ${context}. Only standard properties or "ext:*" namespaced properties are allowed.`);
    }
  }
}

function validateConnectorEndpoint(endpoint, endpointName, objId, doc, errors) {
  if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) {
    errors.push(`Connector "${objId}" must have a valid "${endpointName}" definition`);
    return;
  }

  const hasId = endpoint.id !== undefined;
  const hasPoint = endpoint.point !== undefined;

  if (hasId && hasPoint) {
    errors.push(`Connector "${objId}" ${endpointName} cannot contain both "id" and "point"`);
    return;
  }

  if (!hasId && !hasPoint) {
    errors.push(`Connector "${objId}" ${endpointName} must contain either "id" (with optional "anchor") or "point"`);
    return;
  }

  if (hasId) {
    checkUnknownProperties(endpoint, CONNECTOR_ENDPOINT_ID_ALLOWED_FIELDS, `connector "${objId}" ${endpointName}`, errors);
    if (typeof endpoint.id !== 'string' || !endpoint.id.trim()) {
      errors.push(`Connector "${objId}" ${endpointName}.id must be a non-empty string`);
    } else if (!doc.objects || !doc.objects[endpoint.id]) {
      errors.push(`Connector "${objId}" ${endpointName} references non-existent object ID: "${endpoint.id}"`);
    }

    if (endpoint.anchor !== undefined) {
      if (!endpoint.anchor || typeof endpoint.anchor !== 'object' || Array.isArray(endpoint.anchor)) {
        errors.push(`Connector "${objId}" ${endpointName}.anchor must be an object`);
      } else {
        checkUnknownProperties(endpoint.anchor, CONNECTOR_ANCHOR_ALLOWED_FIELDS, `connector "${objId}" ${endpointName}.anchor`, errors);
        if (typeof endpoint.anchor.x !== 'number' || !Number.isFinite(endpoint.anchor.x) || typeof endpoint.anchor.y !== 'number' || !Number.isFinite(endpoint.anchor.y)) {
          errors.push(`Connector "${objId}" ${endpointName}.anchor must have finite numeric x and y`);
        } else if (endpoint.anchor.x < 0 || endpoint.anchor.x > 1 || endpoint.anchor.y < 0 || endpoint.anchor.y > 1) {
          errors.push(`Connector "${objId}" ${endpointName}.anchor (x, y) must be normalized between 0 and 1`);
        }
      }
    }
  } else if (hasPoint) {
    checkUnknownProperties(endpoint, CONNECTOR_ENDPOINT_POINT_ALLOWED_FIELDS, `connector "${objId}" ${endpointName}`, errors);
    const pt = endpoint.point;
    if (!pt || typeof pt !== 'object' || Array.isArray(pt)) {
      errors.push(`Connector "${objId}" ${endpointName}.point must be an object with { x, y }`);
    } else {
      checkUnknownProperties(pt, CONNECTOR_POINT_ALLOWED_FIELDS, `connector "${objId}" ${endpointName}.point`, errors);
      if (typeof pt.x !== 'number' || !Number.isFinite(pt.x) || typeof pt.y !== 'number' || !Number.isFinite(pt.y)) {
        errors.push(`Connector "${objId}" ${endpointName}.point coordinates (x, y) must be finite numbers`);
      }
    }
  }
}

/**
 * Validates a Sabura document structure against the canonical v1 schema.
 * Rejects unknown unnamespaced properties, broken references, malformed geometry, etc.
 * @param {any} doc
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDocument(doc, options = {}) {
  const errors = [];

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { valid: false, errors: ['Document must be an object'] };
  }

  // Reject unknown unnamespaced properties at the document root
  checkUnknownProperties(doc, DOCUMENT_ALLOWED_FIELDS, 'document', errors);

  if (REVISION_EXTENSION_KEY in doc) {
    const revVal = validateRevisionMetadata(doc, options?.verifyDigest ? canonicalJson : null, normalizeDocument);
    if (!revVal.valid) {
      errors.push(...revVal.errors);
    }
  }

  if (doc.schemaVersion !== CANVAS_SCHEMA_VERSION) {
    errors.push(`Invalid schemaVersion: expected "${CANVAS_SCHEMA_VERSION}", received "${doc.schemaVersion}"`);
  }

  if (typeof doc.id !== 'string' || !doc.id.trim()) {
    errors.push('Document id must be a non-empty string');
  }

  if (typeof doc.title !== 'string') {
    errors.push('Document title must be a string');
  }

  if (!doc.theme || typeof doc.theme !== 'object' || Array.isArray(doc.theme)) {
    errors.push('Document theme must be an object');
  } else {
    checkUnknownProperties(doc.theme, THEME_ALLOWED_FIELDS, 'theme', errors);
    if (doc.theme.id !== undefined && typeof doc.theme.id !== 'string') {
      errors.push('Theme id must be a string');
    }
    if (doc.theme.name !== undefined && typeof doc.theme.name !== 'string') {
      errors.push('Theme name must be a string');
    }
    if (typeof doc.theme.background !== 'string' || !doc.theme.background.trim()) {
      errors.push('Theme background must be a valid non-empty string');
    }
    if (doc.theme.gridColor !== undefined && typeof doc.theme.gridColor !== 'string') {
      errors.push('Theme gridColor must be a string');
    }
    if (doc.theme.defaultFill !== undefined && typeof doc.theme.defaultFill !== 'string') {
      errors.push('Theme defaultFill must be a string');
    }
    if (doc.theme.defaultStroke !== undefined && typeof doc.theme.defaultStroke !== 'string') {
      errors.push('Theme defaultStroke must be a string');
    }
    if (!Array.isArray(doc.theme.palette) || doc.theme.palette.length === 0) {
      errors.push('Theme palette must be a non-empty array of strings');
    } else {
      for (let i = 0; i < doc.theme.palette.length; i++) {
        if (typeof doc.theme.palette[i] !== 'string') {
          errors.push(`Theme palette entry at index ${i} must be a string`);
        }
      }
    }
    if (doc.theme.defaultStrokeWidth !== undefined && (typeof doc.theme.defaultStrokeWidth !== 'number' || !Number.isFinite(doc.theme.defaultStrokeWidth) || doc.theme.defaultStrokeWidth < 0)) {
      errors.push('Theme defaultStrokeWidth must be a finite non-negative number');
    }
    if (doc.theme.defaultOpacity !== undefined && (typeof doc.theme.defaultOpacity !== 'number' || !Number.isFinite(doc.theme.defaultOpacity) || doc.theme.defaultOpacity < 0 || doc.theme.defaultOpacity > 1)) {
      errors.push('Theme defaultOpacity must be a finite number from 0 through 1');
    }
    if (doc.theme.defaultRoughness !== undefined && (typeof doc.theme.defaultRoughness !== 'number' || !Number.isFinite(doc.theme.defaultRoughness) || doc.theme.defaultRoughness < 0)) {
      errors.push('Theme defaultRoughness must be a finite non-negative number');
    }
    if (doc.theme.defaultFontSize !== undefined && !['s', 'm', 'l', 'xl'].includes(doc.theme.defaultFontSize)) {
      errors.push('Theme defaultFontSize must be one of: s, m, l, xl');
    }
    if (doc.theme.defaultFontFamily !== undefined && !['sans', 'serif', 'mono', 'hand'].includes(doc.theme.defaultFontFamily)) {
      errors.push('Theme defaultFontFamily must be one of: sans, serif, mono, hand');
    }
  }

  // Validate groups first so objects can validate groupId references
  if (!doc.groups || typeof doc.groups !== 'object' || Array.isArray(doc.groups)) {
    errors.push('Document groups must be a key-value record');
  } else {
    for (const [groupId, group] of Object.entries(doc.groups)) {
      if (!group || typeof group !== 'object' || Array.isArray(group)) {
        errors.push(`Group "${groupId}" must be an object`);
        continue;
      }
      if (group.id !== groupId) {
        errors.push(`Group id mismatch: key "${groupId}" does not match group.id "${group.id}"`);
      }
      checkUnknownProperties(group, GROUP_ALLOWED_FIELDS, `group "${groupId}"`, errors);
      if (group.name !== undefined && typeof group.name !== 'string') {
        errors.push(`Group "${groupId}" name must be a string`);
      }
      if (group.collapsed !== undefined && typeof group.collapsed !== 'boolean') {
        errors.push(`Group "${groupId}" collapsed must be a boolean`);
      }
    }
  }

  // Validate assets
  if (!doc.assets || typeof doc.assets !== 'object' || Array.isArray(doc.assets)) {
    errors.push('Document assets must be a key-value record');
  } else {
    for (const [assetId, asset] of Object.entries(doc.assets)) {
      if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
        errors.push(`Asset "${assetId}" must be an object`);
        continue;
      }
      if (asset.id !== assetId) {
        errors.push(`Asset id mismatch: key "${assetId}" does not match asset.id "${asset.id}"`);
      }
      checkUnknownProperties(asset, ASSET_ALLOWED_FIELDS, `asset "${assetId}"`, errors);
    }
  }

  // Validate objects
  if (!doc.objects || typeof doc.objects !== 'object' || Array.isArray(doc.objects)) {
    errors.push('Document objects must be a key-value record');
  } else {
    for (const [objId, obj] of Object.entries(doc.objects)) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        errors.push(`Object "${objId}" must be an object`);
        continue;
      }
      if (obj.id !== objId) {
        errors.push(`Object id mismatch: key "${objId}" does not match object.id "${obj.id}"`);
      }
      if (typeof obj.type !== 'string' || !OBJECT_TYPES.includes(obj.type)) {
        errors.push(`Unsupported object type "${obj.type}" on object "${objId}". Expected one of: ${OBJECT_TYPES.join(', ')}`);
        continue;
      }

      // Check unknown unnamespaced properties on this object
      checkUnknownProperties(obj, getAllowedFieldsForType(obj.type), `object "${objId}" (${obj.type})`, errors);

      // Common style/property validations
      if (obj.fill !== undefined && typeof obj.fill !== 'string') {
        errors.push(`Object "${objId}" fill must be a string`);
      }
      if (obj.stroke !== undefined && typeof obj.stroke !== 'string') {
        errors.push(`Object "${objId}" stroke must be a string`);
      }
      if (obj.strokeWidth !== undefined && (typeof obj.strokeWidth !== 'number' || !Number.isFinite(obj.strokeWidth) || obj.strokeWidth < 0)) {
        errors.push(`Object "${objId}" strokeWidth must be a finite non-negative number`);
      }
      if (obj.strokeStyle !== undefined && !STROKE_STYLES.includes(obj.strokeStyle)) {
        errors.push(`Object "${objId}" strokeStyle must be one of: ${STROKE_STYLES.join(', ')}`);
      }
      if (obj.opacity !== undefined && (typeof obj.opacity !== 'number' || !Number.isFinite(obj.opacity) || obj.opacity < 0 || obj.opacity > 1)) {
        errors.push(`Object "${objId}" opacity must be a finite number between 0 and 1`);
      }
      if (obj.roughness !== undefined && (typeof obj.roughness !== 'number' || !Number.isFinite(obj.roughness) || obj.roughness < 0)) {
        errors.push(`Object "${objId}" roughness must be a finite non-negative number`);
      }
      if (obj.seed !== undefined && (typeof obj.seed !== 'number' || !Number.isInteger(obj.seed) || obj.seed <= 0 || obj.seed > 2147483647)) {
        errors.push(`Object "${objId}" seed must be a positive integer in the supported range`);
      }
      if (obj.rotation !== undefined && (typeof obj.rotation !== 'number' || !Number.isFinite(obj.rotation))) {
        errors.push(`Object "${objId}" rotation must be a finite number`);
      }
      if (obj.locked !== undefined && typeof obj.locked !== 'boolean') {
        errors.push(`Object "${objId}" locked must be a boolean`);
      }
      if (obj.autoWidth !== undefined && typeof obj.autoWidth !== 'boolean') {
        errors.push(`Object "${objId}" autoWidth must be a boolean`);
      }
      if (obj.autoHeight !== undefined && typeof obj.autoHeight !== 'boolean') {
        errors.push(`Object "${objId}" autoHeight must be a boolean`);
      }
      if (obj.groupId !== undefined && obj.groupId !== null) {
        if (typeof obj.groupId !== 'string' || !doc.groups || !doc.groups[obj.groupId]) {
          errors.push(`Object "${objId}" references non-existent groupId: "${obj.groupId}"`);
        }
      }
      if (obj.text !== undefined && typeof obj.text !== 'string') {
        errors.push(`Object "${objId}" text must be a string`);
      }
      if (obj.textStyle !== undefined) {
        if (!obj.textStyle || typeof obj.textStyle !== 'object' || Array.isArray(obj.textStyle)) {
          errors.push(`Object "${objId}" textStyle must be an object`);
        } else {
          checkUnknownProperties(obj.textStyle, TEXT_STYLE_ALLOWED_FIELDS, `object "${objId}" textStyle`, errors);
          if (obj.textStyle.size !== undefined && !['s', 'm', 'l', 'xl'].includes(obj.textStyle.size)) {
            errors.push(`Object "${objId}" textStyle.size must be one of: s, m, l, xl`);
          }
          if (obj.textStyle.resolvedSize !== undefined && (typeof obj.textStyle.resolvedSize !== 'number' || !Number.isFinite(obj.textStyle.resolvedSize) || obj.textStyle.resolvedSize <= 0)) {
            errors.push(`Object "${objId}" textStyle.resolvedSize must be a finite positive number`);
          }
          if (obj.textStyle.bold !== undefined && typeof obj.textStyle.bold !== 'boolean') {
            errors.push(`Object "${objId}" textStyle.bold must be a boolean`);
          }
          if (obj.textStyle.align !== undefined && !['left', 'center', 'right'].includes(obj.textStyle.align)) {
            errors.push(`Object "${objId}" textStyle.align must be one of: left, center, right`);
          }
          if (obj.textStyle.fontFamily !== undefined && !['sans', 'serif', 'mono', 'hand'].includes(obj.textStyle.fontFamily)) {
            errors.push(`Object "${objId}" textStyle.fontFamily must be one of: sans, serif, mono, hand`);
          }
          if (obj.textStyle.color !== undefined && typeof obj.textStyle.color !== 'string') {
            errors.push(`Object "${objId}" textStyle.color must be a string`);
          }
        }
      }

      // Non-connectors require valid positive dimensions and coordinates
      if (obj.type !== 'connector') {
        if (typeof obj.x !== 'number' || !Number.isFinite(obj.x) || typeof obj.y !== 'number' || !Number.isFinite(obj.y)) {
          errors.push(`Object "${objId}" coordinates (x, y) must be finite numbers`);
        }
        if (typeof obj.width !== 'number' || !Number.isFinite(obj.width) || obj.width <= 0) {
          errors.push(`Object "${objId}" width must be a finite positive number`);
        }
        if (typeof obj.height !== 'number' || !Number.isFinite(obj.height) || obj.height <= 0) {
          errors.push(`Object "${objId}" height must be a finite positive number`);
        }
      }

      // Connector-specific validation
      if (obj.type === 'connector') {
        validateConnectorEndpoint(obj.from, 'from', objId, doc, errors);
        validateConnectorEndpoint(obj.to, 'to', objId, doc, errors);

        if (obj.routing !== undefined && !CONNECTOR_ROUTINGS.includes(obj.routing)) {
          errors.push(`Connector "${objId}" has unsupported routing: "${obj.routing}". Expected one of: ${CONNECTOR_ROUTINGS.join(', ')}`);
        }
        if (obj.curveSide !== undefined && obj.curveSide !== 1 && obj.curveSide !== -1) {
          errors.push(`Connector "${objId}" curveSide must be 1 or -1`);
        }
        if (obj.curveDistance !== undefined && obj.curveDistance !== null && (typeof obj.curveDistance !== 'number' || !Number.isFinite(obj.curveDistance) || obj.curveDistance < 0)) {
          errors.push(`Connector "${objId}" curveDistance must be a finite non-negative number`);
        }
        if (obj.elbowOffset !== undefined && obj.elbowOffset !== null && (typeof obj.elbowOffset !== 'number' || !Number.isFinite(obj.elbowOffset))) {
          errors.push(`Connector "${objId}" elbowOffset must be a finite number`);
        }
        if (obj.startArrow !== undefined && typeof obj.startArrow !== 'boolean') {
          errors.push(`Connector "${objId}" startArrow must be a boolean`);
        }
        if (obj.endArrow !== undefined && typeof obj.endArrow !== 'boolean') {
          errors.push(`Connector "${objId}" endArrow must be a boolean`);
        }
        if (obj.stacking !== undefined && !['front', 'back'].includes(obj.stacking)) {
          errors.push(`Connector "${objId}" stacking must be "front" or "back"`);
        }
      }

      // Path-specific validation
      if (obj.type === 'path') {
        if (!Array.isArray(obj.points) || obj.points.length < 2) {
          errors.push(`Path "${objId}" points must be an array of at least 2 points`);
        } else {
          for (let pIdx = 0; pIdx < obj.points.length; pIdx++) {
            const pt = obj.points[pIdx];
            if (Array.isArray(pt)) {
              if (pt.length < 2 || typeof pt[0] !== 'number' || !Number.isFinite(pt[0]) || typeof pt[1] !== 'number' || !Number.isFinite(pt[1])) {
                errors.push(`Path "${objId}" point at index ${pIdx} must have valid finite numeric coordinates [x, y]`);
              }
            } else if (pt && typeof pt === 'object') {
              checkUnknownProperties(pt, PATH_POINT_ALLOWED_FIELDS, `path "${objId}" point at index ${pIdx}`, errors);
              if (typeof pt.x !== 'number' || !Number.isFinite(pt.x) || typeof pt.y !== 'number' || !Number.isFinite(pt.y)) {
                errors.push(`Path "${objId}" point at index ${pIdx} must have valid finite numeric coordinates { x, y }`);
              }
            } else {
              errors.push(`Path "${objId}" point at index ${pIdx} is malformed`);
            }
          }
        }
        if (obj.closed !== undefined && typeof obj.closed !== 'boolean') {
          errors.push(`Path "${objId}" closed must be a boolean`);
        }
        if (obj.curveStyle !== undefined && obj.curveStyle !== 'sharp' && obj.curveStyle !== 'curved') {
          errors.push(`Path "${objId}" curveStyle must be "sharp" or "curved"`);
        }
        if (obj.startArrow !== undefined && typeof obj.startArrow !== 'boolean') {
          errors.push(`Path "${objId}" startArrow must be a boolean`);
        }
        if (obj.endArrow !== undefined && typeof obj.endArrow !== 'boolean') {
          errors.push(`Path "${objId}" endArrow must be a boolean`);
        }
      }
    }
  }

  // Order array validation: must be array, no duplicates, no missing references, and every object must be included
  if (!Array.isArray(doc.order)) {
    errors.push('Document order must be an array of object IDs');
  } else {
    const seen = new Set();
    for (const id of doc.order) {
      if (seen.has(id)) {
        errors.push(`Duplicate ID in order list: "${id}"`);
      }
      seen.add(id);
      if (doc.objects && !doc.objects[id]) {
        errors.push(`Order contains non-existent object ID: "${id}"`);
      }
    }

    if (doc.objects && typeof doc.objects === 'object' && !Array.isArray(doc.objects)) {
      for (const objId of Object.keys(doc.objects)) {
        if (!seen.has(objId)) {
          errors.push(`Object "${objId}" is missing from document order list`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Normalizes a valid document by filling in version-defined defaults
 * for any omitted optional properties.
 * Does not replace invalid values.
 * @param {Object} doc
 * @returns {Object}
 */
export function normalizeDocument(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  doc.theme = normalizeTheme(doc.theme);
  const theme = doc.theme;

  if (!doc.groups) doc.groups = {};
  if (!doc.assets) doc.assets = {};
  if (!doc.objects) doc.objects = {};
  if (!doc.order) doc.order = [];

  for (const [id, obj] of Object.entries(doc.objects)) {
    if (!obj || typeof obj !== 'object') continue;
    if (obj.stroke === undefined) obj.stroke = theme.defaultStroke;
    if (obj.strokeWidth === undefined) obj.strokeWidth = theme.defaultStrokeWidth;
    if (obj.strokeStyle === undefined) obj.strokeStyle = 'solid';
    if (obj.fill === undefined) obj.fill = theme.defaultFill;
    if (obj.opacity === undefined) obj.opacity = theme.defaultOpacity;
    if (obj.roughness === undefined) obj.roughness = theme.defaultRoughness;
    if (obj.seed === undefined) obj.seed = deterministicSeedFromId(obj.id);
    if (obj.locked === undefined) obj.locked = false;
    if (obj.groupId === undefined) obj.groupId = null;
    if (obj.rotation === undefined) obj.rotation = 0;
    if (obj.text === undefined) obj.text = '';

    if (obj.textStyle === undefined) {
      obj.textStyle = {
        size: theme.defaultFontSize,
        resolvedSize: FONT_SIZES[theme.defaultFontSize] || 20,
        fontFamily: theme.defaultFontFamily,
        bold: false,
        align: obj.type === 'text' ? 'left' : 'center',
        color: obj.stroke || theme.defaultStroke
      };
    } else {
      const fontSizeToken = obj.textStyle.size || theme.defaultFontSize;
      if (!obj.textStyle.size) obj.textStyle.size = fontSizeToken;
      if (!obj.textStyle.resolvedSize) obj.textStyle.resolvedSize = FONT_SIZES[fontSizeToken] || 20;
      if (!obj.textStyle.fontFamily) obj.textStyle.fontFamily = theme.defaultFontFamily;
      if (obj.textStyle.bold === undefined) obj.textStyle.bold = false;
      if (!obj.textStyle.align) obj.textStyle.align = obj.type === 'text' ? 'left' : 'center';
      if (!obj.textStyle.color) obj.textStyle.color = obj.stroke || theme.defaultStroke;
    }

    if (obj.type === 'connector') {
      if (!obj.routing) obj.routing = 'straight';
      if (obj.curveSide === undefined) obj.curveSide = 1;
      if (obj.startArrow === undefined) obj.startArrow = false;
      if (obj.endArrow === undefined) obj.endArrow = true;
    } else if (obj.type === 'path') {
      if (obj.closed === undefined) obj.closed = false;
      if (!obj.curveStyle) obj.curveStyle = 'sharp';
      if (obj.startArrow === undefined) obj.startArrow = false;
      if (obj.endArrow === undefined) obj.endArrow = false;
    }
  }

  return doc;
}

setDefaultNormalizeFn(normalizeDocument);

/**
 * Deep clones any JSON-compatible structure.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function cloneDocument(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Serializes an object canonically:
 * - Deterministic object key sorting at all levels
 * - Array order strictly preserved
 * - Indented with 2 spaces
 * - Encodes every literal '<' as '\u003C' to guarantee that user or AI-generated
 *   text cannot form HTML parser closing tags such as '</script>' regardless of casing.
 * @param {any} value
 * @returns {string}
 */
export function canonicalJson(value) {
  function sortKeys(val) {
    if (val === null || typeof val !== 'object') {
      return val;
    }
    if (Array.isArray(val)) {
      return val.map(sortKeys);
    }
    const sortedObj = {};
    const keys = Object.keys(val).sort();
    for (const key of keys) {
      sortedObj[key] = sortKeys(val[key]);
    }
    return sortedObj;
  }

  const sorted = sortKeys(value);
  const jsonStr = JSON.stringify(sorted, null, 2);
  // Safely encode every literal '<' as '\u003C'
  return jsonStr.replace(/</g, '\\u003C');
}
