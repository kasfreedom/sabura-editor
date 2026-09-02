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

/**
 * Validates a Sabura document structure against the canonical v1 schema.
 * Rejects unknown unnamespaced properties, broken references, malformed geometry, etc.
 * @param {any} doc 
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDocument(doc) {
  const errors = [];

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { valid: false, errors: ['Document must be an object'] };
  }

  // Reject unknown unnamespaced properties at the document root
  checkUnknownProperties(doc, DOCUMENT_ALLOWED_FIELDS, 'document', errors);

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
    if (!doc.theme.background || typeof doc.theme.background !== 'string') {
      errors.push('Theme background must be a valid string');
    }
    if (!Array.isArray(doc.theme.palette) || doc.theme.palette.length === 0) {
      errors.push('Theme palette must be a non-empty array of color strings');
    } else {
      for (let i = 0; i < doc.theme.palette.length; i++) {
        if (typeof doc.theme.palette[i] !== 'string') {
          errors.push(`Theme palette entry at index ${i} must be a string`);
        }
      }
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
      if (obj.stroke !== undefined && typeof obj.stroke !== 'string') {
        errors.push(`Object "${objId}" stroke must be a string`);
      }
      if (obj.strokeWidth !== undefined && (typeof obj.strokeWidth !== 'number' || isNaN(obj.strokeWidth) || obj.strokeWidth < 0)) {
        errors.push(`Object "${objId}" strokeWidth must be a non-negative number`);
      }
      if (obj.strokeStyle !== undefined && !STROKE_STYLES.includes(obj.strokeStyle)) {
        errors.push(`Object "${objId}" strokeStyle must be one of: ${STROKE_STYLES.join(', ')}`);
      }
      if (obj.opacity !== undefined && (typeof obj.opacity !== 'number' || isNaN(obj.opacity) || obj.opacity < 0 || obj.opacity > 1)) {
        errors.push(`Object "${objId}" opacity must be a number between 0 and 1`);
      }
      if (obj.roughness !== undefined && (typeof obj.roughness !== 'number' || isNaN(obj.roughness) || obj.roughness < 0)) {
        errors.push(`Object "${objId}" roughness must be a non-negative number`);
      }
      if (obj.seed !== undefined && (typeof obj.seed !== 'number' || isNaN(obj.seed))) {
        errors.push(`Object "${objId}" seed must be a valid number`);
      }
      if (obj.rotation !== undefined && (typeof obj.rotation !== 'number' || isNaN(obj.rotation))) {
        errors.push(`Object "${objId}" rotation must be a valid number`);
      }
      if (obj.locked !== undefined && typeof obj.locked !== 'boolean') {
        errors.push(`Object "${objId}" locked must be a boolean`);
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
          if (obj.textStyle.resolvedSize !== undefined && (typeof obj.textStyle.resolvedSize !== 'number' || isNaN(obj.textStyle.resolvedSize) || obj.textStyle.resolvedSize <= 0)) {
            errors.push(`Object "${objId}" textStyle.resolvedSize must be a positive number`);
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
        if (typeof obj.x !== 'number' || isNaN(obj.x) || typeof obj.y !== 'number' || isNaN(obj.y)) {
          errors.push(`Object "${objId}" coordinates (x, y) must be valid numbers`);
        }
        if (typeof obj.width !== 'number' || isNaN(obj.width) || obj.width <= 0) {
          errors.push(`Object "${objId}" width must be a positive number`);
        }
        if (typeof obj.height !== 'number' || isNaN(obj.height) || obj.height <= 0) {
          errors.push(`Object "${objId}" height must be a positive number`);
        }
      }

      // Connector-specific validation
      if (obj.type === 'connector') {
        if (!obj.from || typeof obj.from !== 'object' || Array.isArray(obj.from)) {
          errors.push(`Connector "${objId}" must have a valid "from" definition`);
        } else {
          const hasId = typeof obj.from.id === 'string' && obj.from.id.trim().length > 0;
          const hasPoint = obj.from.point && typeof obj.from.point === 'object' && typeof obj.from.point.x === 'number' && !isNaN(obj.from.point.x) && typeof obj.from.point.y === 'number' && !isNaN(obj.from.point.y);
          if (!hasId && !hasPoint) {
            errors.push(`Connector "${objId}" from must specify a valid object "id" or numeric "point" { x, y }`);
          }
          if (hasId && (!doc.objects || !doc.objects[obj.from.id])) {
            errors.push(`Connector "${objId}" from references non-existent object ID: "${obj.from.id}"`);
          }
          if (obj.from.anchor !== undefined) {
            if (!obj.from.anchor || typeof obj.from.anchor !== 'object' || Array.isArray(obj.from.anchor) || typeof obj.from.anchor.x !== 'number' || isNaN(obj.from.anchor.x) || typeof obj.from.anchor.y !== 'number' || isNaN(obj.from.anchor.y)) {
              errors.push(`Connector "${objId}" from.anchor must have numeric x and y`);
            } else if (obj.from.anchor.x < 0 || obj.from.anchor.x > 1 || obj.from.anchor.y < 0 || obj.from.anchor.y > 1) {
              errors.push(`Connector "${objId}" from.anchor (x, y) must be normalized between 0 and 1`);
            }
          }
        }

        if (!obj.to || typeof obj.to !== 'object' || Array.isArray(obj.to)) {
          errors.push(`Connector "${objId}" must have a valid "to" definition`);
        } else {
          const hasId = typeof obj.to.id === 'string' && obj.to.id.trim().length > 0;
          const hasPoint = obj.to.point && typeof obj.to.point === 'object' && typeof obj.to.point.x === 'number' && !isNaN(obj.to.point.x) && typeof obj.to.point.y === 'number' && !isNaN(obj.to.point.y);
          if (!hasId && !hasPoint) {
            errors.push(`Connector "${objId}" to must specify a valid object "id" or numeric "point" { x, y }`);
          }
          if (hasId && (!doc.objects || !doc.objects[obj.to.id])) {
            errors.push(`Connector "${objId}" to references non-existent object ID: "${obj.to.id}"`);
          }
          if (obj.to.anchor !== undefined) {
            if (!obj.to.anchor || typeof obj.to.anchor !== 'object' || Array.isArray(obj.to.anchor) || typeof obj.to.anchor.x !== 'number' || isNaN(obj.to.anchor.x) || typeof obj.to.anchor.y !== 'number' || isNaN(obj.to.anchor.y)) {
              errors.push(`Connector "${objId}" to.anchor must have numeric x and y`);
            } else if (obj.to.anchor.x < 0 || obj.to.anchor.x > 1 || obj.to.anchor.y < 0 || obj.to.anchor.y > 1) {
              errors.push(`Connector "${objId}" to.anchor (x, y) must be normalized between 0 and 1`);
            }
          }
        }

        if (obj.routing !== undefined && !CONNECTOR_ROUTINGS.includes(obj.routing)) {
          errors.push(`Connector "${objId}" has unsupported routing: "${obj.routing}". Expected one of: ${CONNECTOR_ROUTINGS.join(', ')}`);
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
              if (pt.length < 2 || typeof pt[0] !== 'number' || isNaN(pt[0]) || typeof pt[1] !== 'number' || isNaN(pt[1])) {
                errors.push(`Path "${objId}" point at index ${pIdx} must have valid numeric coordinates [x, y]`);
              }
            } else if (pt && typeof pt === 'object') {
              if (typeof pt.x !== 'number' || isNaN(pt.x) || typeof pt.y !== 'number' || isNaN(pt.y)) {
                errors.push(`Path "${objId}" point at index ${pIdx} must have valid numeric coordinates { x, y }`);
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
  const theme = doc.theme || THEME_PRESETS.paper;

  if (!doc.groups) doc.groups = {};
  if (!doc.assets) doc.assets = {};
  if (!doc.objects) doc.objects = {};
  if (!doc.order) doc.order = [];

  for (const [id, obj] of Object.entries(doc.objects)) {
    if (!obj || typeof obj !== 'object') continue;
    if (obj.stroke === undefined) obj.stroke = theme.defaultStroke || '#1e1e1e';
    if (obj.strokeWidth === undefined) obj.strokeWidth = theme.defaultStrokeWidth || 2;
    if (obj.strokeStyle === undefined) obj.strokeStyle = 'solid';
    if (obj.fill === undefined) obj.fill = theme.defaultFill || 'none';
    if (obj.opacity === undefined) obj.opacity = theme.defaultOpacity !== undefined ? theme.defaultOpacity : 1.0;
    if (obj.roughness === undefined) obj.roughness = theme.defaultRoughness !== undefined ? theme.defaultRoughness : 1;
    if (obj.seed === undefined) obj.seed = generateSeed();
    if (obj.locked === undefined) obj.locked = false;
    if (obj.groupId === undefined) obj.groupId = null;
    if (obj.rotation === undefined) obj.rotation = 0;
    if (obj.text === undefined) obj.text = '';

    if (obj.textStyle === undefined) {
      obj.textStyle = {
        size: theme.defaultFontSize || 'm',
        resolvedSize: FONT_SIZES[theme.defaultFontSize || 'm'] || 20,
        fontFamily: theme.defaultFontFamily || 'hand',
        bold: false,
        align: obj.type === 'text' ? 'left' : 'center',
        color: obj.stroke || theme.defaultStroke || '#1e1e1e'
      };
    } else {
      const fontSizeToken = obj.textStyle.size || theme.defaultFontSize || 'm';
      if (!obj.textStyle.size) obj.textStyle.size = fontSizeToken;
      if (!obj.textStyle.resolvedSize) obj.textStyle.resolvedSize = FONT_SIZES[fontSizeToken] || 20;
      if (!obj.textStyle.fontFamily) obj.textStyle.fontFamily = theme.defaultFontFamily || 'hand';
      if (obj.textStyle.bold === undefined) obj.textStyle.bold = false;
      if (!obj.textStyle.align) obj.textStyle.align = obj.type === 'text' ? 'left' : 'center';
      if (!obj.textStyle.color) obj.textStyle.color = obj.stroke || theme.defaultStroke || '#1e1e1e';
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
