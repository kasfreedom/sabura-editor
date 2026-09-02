/**
 * Sabura Document Management: Schema, Validation, Factory, and Canonical Serialization.
 */

import { CANVAS_SCHEMA_VERSION, THEME_PRESETS, FONT_SIZES, MIN_OBJECT_SIZE } from './types.js';
import { measureText } from './geometry.js';

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
  const id = overrides.id || generateId(type.slice(0, 4));
  const seed = overrides.seed !== undefined ? overrides.seed : generateSeed();
  const fontSizeToken = overrides.textStyle?.size || theme.defaultFontSize || 'm';
  const resolvedSize = FONT_SIZES[fontSizeToken] || 20;

  let defaultWidth = type === 'text' ? 80 : 160;
  let defaultHeight = type === 'text' ? 32 : 100;
  if (type === 'text' && overrides.text) {
    const familyToken = overrides.textStyle?.fontFamily || theme.defaultFontFamily || 'hand';
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
    fill: overrides.fill !== undefined ? overrides.fill : theme.defaultFill,
    stroke: overrides.stroke !== undefined ? overrides.stroke : theme.defaultStroke,
    strokeWidth: overrides.strokeWidth !== undefined ? overrides.strokeWidth : theme.defaultStrokeWidth,
    strokeStyle: overrides.strokeStyle || 'solid',
    opacity: overrides.opacity !== undefined ? overrides.opacity : theme.defaultOpacity,
    roughness: overrides.roughness !== undefined ? overrides.roughness : theme.defaultRoughness,
    seed,
    locked: overrides.locked || false,
    groupId: overrides.groupId || null,
    text: overrides.text !== undefined ? overrides.text : '',
    textStyle: {
      size: fontSizeToken,
      resolvedSize,
      fontFamily: overrides.textStyle?.fontFamily || theme.defaultFontFamily || 'sans',
      bold: overrides.textStyle?.bold || false,
      align: overrides.textStyle?.align || (type === 'text' ? 'left' : 'center'),
      color: overrides.textStyle?.color || overrides.stroke || theme.defaultStroke
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
      baseObject.points = Array.isArray(overrides.points) ? overrides.points : [];
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
export function validateDocument(doc) {
  const errors = [];

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { valid: false, errors: ['Document must be an object'] };
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

  if (!doc.theme || typeof doc.theme !== 'object') {
    errors.push('Document theme must be an object');
  } else {
    if (!doc.theme.background || typeof doc.theme.background !== 'string') {
      errors.push('Theme background must be a valid string');
    }
    if (!Array.isArray(doc.theme.palette) || doc.theme.palette.length === 0) {
      errors.push('Theme palette must be a non-empty array of color strings');
    }
  }

  if (!doc.objects || typeof doc.objects !== 'object' || Array.isArray(doc.objects)) {
    errors.push('Document objects must be a key-value record');
  } else {
    for (const [objId, obj] of Object.entries(doc.objects)) {
      if (!obj || typeof obj !== 'object') {
        errors.push(`Object "${objId}" must be an object`);
        continue;
      }
      if (obj.id !== objId) {
        errors.push(`Object id mismatch: key "${objId}" does not match object.id "${obj.id}"`);
      }
      if (typeof obj.type !== 'string' || !obj.type.trim()) {
        errors.push(`Object "${objId}" must have a valid type string`);
      }
      if (obj.type !== 'connector') {
        if (typeof obj.x !== 'number' || isNaN(obj.x) || typeof obj.y !== 'number' || isNaN(obj.y)) {
          errors.push(`Object "${objId}" coordinates (x, y) must be valid numbers`);
        }
        if (typeof obj.width !== 'number' || isNaN(obj.width) || typeof obj.height !== 'number' || isNaN(obj.height)) {
          errors.push(`Object "${objId}" dimensions (width, height) must be valid numbers`);
        }
      }
      if (typeof obj.seed !== 'number' || isNaN(obj.seed)) {
        errors.push(`Object "${objId}" seed must be a valid number`);
      }
      if (obj.type === 'connector') {
        if (!obj.from || typeof obj.from !== 'object') {
          errors.push(`Connector "${objId}" must have a valid "from" definition`);
        } else if (obj.from.anchor && (typeof obj.from.anchor.x !== 'number' || typeof obj.from.anchor.y !== 'number')) {
          errors.push(`Connector "${objId}" from.anchor must have numeric x and y`);
        }
        if (!obj.to || typeof obj.to !== 'object') {
          errors.push(`Connector "${objId}" must have a valid "to" definition`);
        } else if (obj.to.anchor && (typeof obj.to.anchor.x !== 'number' || typeof obj.to.anchor.y !== 'number')) {
          errors.push(`Connector "${objId}" to.anchor must have numeric x and y`);
        }
        if (obj.curveSide !== undefined && obj.curveSide !== 1 && obj.curveSide !== -1) {
          errors.push(`Connector "${objId}" curveSide must be 1 or -1`);
        }
        if (obj.curveDistance !== undefined && obj.curveDistance !== null && (typeof obj.curveDistance !== 'number' || isNaN(obj.curveDistance) || obj.curveDistance < 0)) {
          errors.push(`Connector "${objId}" curveDistance must be a non-negative number`);
        }
        if (obj.elbowOffset !== undefined && obj.elbowOffset !== null && (typeof obj.elbowOffset !== 'number' || isNaN(obj.elbowOffset))) {
          errors.push(`Connector "${objId}" elbowOffset must be a number`);
        }
      }
    }
  }

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
  }

  if (!doc.groups || typeof doc.groups !== 'object' || Array.isArray(doc.groups)) {
    errors.push('Document groups must be a key-value record');
  }

  if (!doc.assets || typeof doc.assets !== 'object' || Array.isArray(doc.assets)) {
    errors.push('Document assets must be a key-value record');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

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
 * - Safely escapes closing script tags to prevent HTML injection/parsing breaks.
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
  // Prevent breaking closing HTML script tags
  const scriptEndRegex = new RegExp('<\\/' + 'script', 'gi');
  return jsonStr.replace(scriptEndRegex, '<\\/script');
}
