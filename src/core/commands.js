/**
 * Sabura Command Engine: Atomic Reducer, Validation, and Inverse Generation.
 */

import { COMMANDS_SCHEMA_VERSION, FONT_SIZES, MIN_OBJECT_SIZE, THEME_PRESETS, IMAGE_OBJECT_TYPE } from './types.js';
import {
  cloneDocument,
  generateId,
  generateSeed,
  validateDocument,
  CONNECTOR_ENDPOINT_ID_ALLOWED_FIELDS,
  CONNECTOR_ENDPOINT_POINT_ALLOWED_FIELDS,
  CONNECTOR_ANCHOR_ALLOWED_FIELDS,
  CONNECTOR_POINT_ALLOWED_FIELDS,
  TEXT_STYLE_ALLOWED_FIELDS,
  PATH_POINT_ALLOWED_FIELDS
} from './document.js';
import { alignObjects, distributeObjects, measureText, resolveConnectorGeometry } from './geometry.js';

export const SUPPORTED_COMMAND_TYPES = new Set([
  'create_object',
  'create_asset',
  'create_image',
  'delete_asset',
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
  'restore_positions',
  'restore_styles',
  'restore_typography',
  'restore_order',
  'restore_groups',
  'restore_ungroup',
  'connect_objects',
  'reconnect_connector',
  'configure_connector',
  'configure_connector_endpoints',
  'duplicate_objects',
  'set_board_theme',
  'set_title',
  'update_path_points',
  'rotate_objects',
  'batch',
  'noop'
]);

/**
 * Validates an individual command structure against canonical constraints.
 * Rejects unknown command types, invalid coordinates, invalid styles, and structural mismatches.
 * @param {any} cmd
 * @param {Object} [doc] Optional document context for document-aware target validation
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCommand(cmd, doc = null) {
  const errors = [];
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) {
    return { valid: false, errors: ['Command must be an object'] };
  }
  if (typeof cmd.type !== 'string' || !cmd.type.trim()) {
    errors.push('Command must have a non-empty type string');
    return { valid: false, errors };
  }
  if (!SUPPORTED_COMMAND_TYPES.has(cmd.type)) {
    errors.push(`Unknown command type: "${cmd.type}". Supported command types are: ${Array.from(SUPPORTED_COMMAND_TYPES).join(', ')}`);
    return { valid: false, errors };
  }

  const isValidFinite = (n) => typeof n === 'number' && Number.isFinite(n);
  const isValidPoint = (pt) => {
    if (!pt || typeof pt !== 'object' || Array.isArray(pt)) return false;
    return isValidFinite(pt.x) && isValidFinite(pt.y);
  };

  const validatePointsList = (points, name) => {
    if (!Array.isArray(points) || points.length < 2) {
      errors.push(`${name} must be an array of at least 2 points`);
      return;
    }
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (Array.isArray(pt)) {
        if (pt.length < 2 || !isValidFinite(pt[0]) || !isValidFinite(pt[1])) {
          errors.push(`${name}[${i}] must have valid finite numeric coordinates [x, y]`);
        }
      } else if (pt && typeof pt === 'object') {
        for (const k of Object.keys(pt)) {
          if (!PATH_POINT_ALLOWED_FIELDS.has(k) && !k.startsWith('ext:')) {
            errors.push(`Unknown property "${k}" on ${name}[${i}]`);
          }
        }
        if (!isValidFinite(pt.x) || !isValidFinite(pt.y)) {
          errors.push(`${name}[${i}] must have finite numeric coordinates`);
        }
      } else {
        errors.push(`${name}[${i}] must be a valid point object or coordinate pair`);
      }
    }
  };

  const validateBounds = (bounds, name) => {
    if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) {
      errors.push(`${name} requires a bounds object`);
      return;
    }
    if (!isValidFinite(bounds.x) || !isValidFinite(bounds.y)) {
      errors.push(`${name} bounds must have finite numeric x and y`);
    }
    if (!isValidFinite(bounds.width) || bounds.width < 0 || !isValidFinite(bounds.height) || bounds.height < 0) {
      errors.push(`${name} bounds must have non-negative finite numeric width and height`);
    }
  };

  const validateTextStylePayload = (textStyle, name) => {
    if (!textStyle || typeof textStyle !== 'object' || Array.isArray(textStyle)) {
      errors.push(`${name} must be an object`);
      return;
    }
    for (const key of Object.keys(textStyle)) {
      if (!TEXT_STYLE_ALLOWED_FIELDS.has(key) && !key.startsWith('ext:')) {
        errors.push(`Unknown property "${key}" on ${name}`);
      }
    }
    if (textStyle.size !== undefined && !['s', 'm', 'l', 'xl'].includes(textStyle.size)) {
      errors.push(`${name}.size must be one of: s, m, l, xl`);
    }
    if (textStyle.resolvedSize !== undefined) {
      if (!isValidFinite(textStyle.resolvedSize) || textStyle.resolvedSize <= 0) {
        errors.push(`${name}.resolvedSize must be a finite positive number`);
      }
    }
    if (textStyle.fontFamily !== undefined && !['hand', 'sans', 'serif', 'mono'].includes(textStyle.fontFamily)) {
      errors.push(`${name}.fontFamily must be one of: hand, sans, serif, mono`);
    }
    if (textStyle.bold !== undefined && typeof textStyle.bold !== 'boolean') {
      errors.push(`${name}.bold must be a boolean`);
    }
    if (textStyle.align !== undefined && !['left', 'center', 'right'].includes(textStyle.align)) {
      errors.push(`${name}.align must be one of: left, center, right`);
    }
    if (textStyle.color !== undefined && typeof textStyle.color !== 'string') {
      errors.push(`${name}.color must be a string`);
    }
  };

  const validateEndpoint = (endpoint, name) => {
    if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) {
      errors.push(`${name} must be a valid endpoint object`);
      return;
    }
    const hasId = typeof endpoint.id === 'string' && endpoint.id.trim().length > 0;
    const hasPoint = endpoint.point !== undefined;

    if (hasId && hasPoint) {
      errors.push(`${name} must not specify both "id" and "point"`);
      return;
    } else if (!hasId && !hasPoint) {
      errors.push(`${name} must specify either "id" or "point"`);
      return;
    }

    if (hasId) {
      for (const k of Object.keys(endpoint)) {
        if (!CONNECTOR_ENDPOINT_ID_ALLOWED_FIELDS.has(k) && !k.startsWith('ext:')) {
          errors.push(`Unknown property "${k}" on ${name}`);
        }
      }
      if (endpoint.anchor !== undefined) {
        if (!endpoint.anchor || typeof endpoint.anchor !== 'object' || Array.isArray(endpoint.anchor)) {
          errors.push(`${name}.anchor must be an object`);
        } else {
          for (const k of Object.keys(endpoint.anchor)) {
            if (!CONNECTOR_ANCHOR_ALLOWED_FIELDS.has(k) && !k.startsWith('ext:')) {
              errors.push(`Unknown property "${k}" on ${name}.anchor`);
            }
          }
          if (!isValidFinite(endpoint.anchor.x) || !isValidFinite(endpoint.anchor.y) ||
              endpoint.anchor.x < 0 || endpoint.anchor.x > 1 || endpoint.anchor.y < 0 || endpoint.anchor.y > 1) {
            errors.push(`${name}.anchor coordinates must be finite numbers between 0 and 1`);
          }
        }
      }
      if (doc && doc.objects) {
        const targetObj = doc.objects[endpoint.id];
        if (!targetObj) {
          errors.push(`${name} references non-existent object ID "${endpoint.id}"`);
        } else if (targetObj.type === 'connector') {
          errors.push(`${name} cannot attach to another connector "${endpoint.id}"`);
        }
      }
    } else if (hasPoint) {
      for (const k of Object.keys(endpoint)) {
        if (!CONNECTOR_ENDPOINT_POINT_ALLOWED_FIELDS.has(k) && !k.startsWith('ext:')) {
          errors.push(`Unknown property "${k}" on ${name}`);
        }
      }
      const pt = endpoint.point;
      if (!pt || typeof pt !== 'object' || Array.isArray(pt)) {
        errors.push(`${name}.point must be an object with { x, y }`);
      } else {
        for (const k of Object.keys(pt)) {
          if (!CONNECTOR_POINT_ALLOWED_FIELDS.has(k) && !k.startsWith('ext:')) {
            errors.push(`Unknown property "${k}" on ${name}.point`);
          }
        }
        if (!isValidFinite(pt.x) || !isValidFinite(pt.y)) {
          errors.push(`${name}.point must have finite numeric coordinates`);
        }
      }
    }
  };

  // Type-specific field validations
  if (cmd.type === 'create_object') {
    if (!cmd.object || typeof cmd.object !== 'object' || Array.isArray(cmd.object)) {
      errors.push('create_object requires a valid object payload');
    }
  } else if (cmd.type === 'create_asset') {
    if (!cmd.asset || typeof cmd.asset !== 'object' || Array.isArray(cmd.asset)) {
      errors.push('create_asset requires a valid asset payload');
    }
  } else if (cmd.type === 'create_image') {
    if (!cmd.object || typeof cmd.object !== 'object' || Array.isArray(cmd.object) || cmd.object.type !== IMAGE_OBJECT_TYPE) {
      errors.push('create_image requires an image object payload');
    }
    if (!cmd.asset || typeof cmd.asset !== 'object' || Array.isArray(cmd.asset) || cmd.asset.type !== 'raster') {
      errors.push('create_image requires a raster asset payload');
    }
    if (cmd.object?.assetId !== undefined && cmd.asset?.id !== undefined && cmd.object.assetId !== cmd.asset.id) {
      errors.push('create_image object.assetId must match asset.id');
    }
    if (doc && cmd.asset?.id && doc.assets?.[cmd.asset.id]) errors.push(`create_image asset ID already exists: "${cmd.asset.id}"`);
    if (doc && cmd.object?.id && doc.objects?.[cmd.object.id]) errors.push(`create_image object ID already exists: "${cmd.object.id}"`);
  } else if (cmd.type === 'set_image_fit') {
    if (typeof cmd.id !== 'string' || !cmd.id.trim()) errors.push('set_image_fit requires a string id');
    if (cmd.fit !== 'contain' && cmd.fit !== 'cover') errors.push('set_image_fit fit must be "contain" or "cover"');
    if (doc?.objects?.[cmd.id] && doc.objects[cmd.id].type !== IMAGE_OBJECT_TYPE) errors.push(`set_image_fit target "${cmd.id}" is not an image`);
  } else if (cmd.type === 'set_image_opacity') {
    if (typeof cmd.id !== 'string' || !cmd.id.trim()) errors.push('set_image_opacity requires a string id');
    if (typeof cmd.opacity !== 'number' || !Number.isFinite(cmd.opacity) || cmd.opacity < 0 || cmd.opacity > 1) errors.push('set_image_opacity opacity must be between 0 and 1');
    if (doc?.objects?.[cmd.id] && doc.objects[cmd.id].type !== IMAGE_OBJECT_TYPE) errors.push(`set_image_opacity target "${cmd.id}" is not an image`);
  } else if (cmd.type === 'delete_objects') {
    if (!Array.isArray(cmd.ids)) {
      errors.push('delete_objects requires an array of ids');
    }
  } else if (cmd.type === 'move_objects') {
    if (!Array.isArray(cmd.ids)) errors.push('move_objects requires an array of ids');
    if (!isValidFinite(cmd.dx) || !isValidFinite(cmd.dy)) {
      errors.push('move_objects requires numeric dx and dy deltas');
    }
  } else if (cmd.type === 'resize_object') {
    if (typeof cmd.id !== 'string' || !cmd.id.trim()) errors.push('resize_object requires a string id');
    validateBounds(cmd.bounds, 'resize_object');
    if (cmd.points !== undefined && cmd.points !== null) {
      validatePointsList(cmd.points, 'resize_object points');
      if (doc && doc.objects && doc.objects[cmd.id] && doc.objects[cmd.id].type !== 'path') {
        errors.push(`Cannot apply path points to non-path object "${cmd.id}" of type "${doc.objects[cmd.id].type}"`);
      }
    }
    if (cmd.textStyle !== undefined && cmd.textStyle !== null) {
      validateTextStylePayload(cmd.textStyle, 'resize_object textStyle');
    }
    if (cmd.restoreTextStyle !== undefined && cmd.restoreTextStyle !== null) {
      validateTextStylePayload(cmd.restoreTextStyle, 'resize_object restoreTextStyle');
    }
  } else if (cmd.type === 'set_text') {
    if (typeof cmd.id !== 'string' || !cmd.id.trim()) errors.push('set_text requires a string id');
    if (typeof cmd.text !== 'string') errors.push('set_text requires string text');
  } else if (cmd.type === 'configure_connector') {
    if (typeof cmd.id !== 'string' || !cmd.id.trim()) errors.push('configure_connector requires a string id');
  } else if (cmd.type === 'configure_connector_endpoints') {
    if (typeof cmd.id !== 'string' || !cmd.id.trim()) errors.push('configure_connector_endpoints requires a string id');
    validateEndpoint(cmd.from, 'configure_connector_endpoints from');
    validateEndpoint(cmd.to, 'configure_connector_endpoints to');
  } else if (cmd.type === 'reconnect_connector') {
    if (typeof cmd.id !== 'string' || !cmd.id.trim()) errors.push('reconnect_connector requires a string id');
    if (cmd.endpoint !== 'from' && cmd.endpoint !== 'to') errors.push('reconnect_connector endpoint must be "from" or "to"');
    validateEndpoint(cmd.target, 'reconnect_connector target');
  } else if (cmd.type === 'set_board_theme') {
    if (!cmd.theme && !cmd.themeId) errors.push('set_board_theme requires theme or themeId');
  } else if (cmd.type === 'update_path_points') {
    if (typeof cmd.id !== 'string' || !cmd.id.trim()) errors.push('update_path_points requires a string id');
    validatePointsList(cmd.points, 'update_path_points points');
    if (cmd.bounds !== undefined && cmd.bounds !== null) {
      validateBounds(cmd.bounds, 'update_path_points bounds');
    }
    if (doc && doc.objects && doc.objects[cmd.id] && doc.objects[cmd.id].type !== 'path') {
      errors.push(`Cannot update path points on non-path object "${cmd.id}" of type "${doc.objects[cmd.id].type}"`);
    }
  } else if (cmd.type === 'rotate_objects') {
    if (!cmd.objects || typeof cmd.objects !== 'object' || Array.isArray(cmd.objects)) {
      errors.push('rotate_objects requires an objects map');
    } else {
      const keys = Object.keys(cmd.objects);
      if (keys.length === 0) {
        errors.push('rotate_objects requires at least one object entry');
      }
      for (const [id, entry] of Object.entries(cmd.objects)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          errors.push(`rotate_objects entry for "${id}" must be an object`);
          continue;
        }
        if (typeof entry.rotation !== 'number' || !Number.isFinite(entry.rotation)) {
          errors.push(`rotate_objects entry for "${id}" requires a finite numeric rotation`);
        }
        if (entry.x !== undefined || entry.y !== undefined) {
          if (!isValidFinite(entry.x) || !isValidFinite(entry.y)) {
            errors.push(`rotate_objects entry for "${id}" position coordinates must be finite numbers`);
          }
        }
        if (doc && doc.objects) {
          const target = doc.objects[id];
          if (!target) {
            errors.push(`rotate_objects references non-existent object ID "${id}"`);
          } else if (target.locked) {
            errors.push(`Cannot rotate locked object "${id}"`);
          } else if (target.type === 'connector') {
            errors.push(`Cannot directly rotate connector "${id}"`);
          }
        }
      }
    }
    if (cmd.freeEndpoints !== undefined) {
      if (cmd.freeEndpoints === null || typeof cmd.freeEndpoints !== 'object' || Array.isArray(cmd.freeEndpoints)) {
        errors.push('rotate_objects freeEndpoints must be a non-null object');
      } else {
        for (const [connId, ep] of Object.entries(cmd.freeEndpoints)) {
          if (doc && doc.objects) {
            const target = doc.objects[connId];
            if (!target) {
              errors.push(`rotate_objects freeEndpoints references non-existent connector ID "${connId}"`);
            } else if (target.type !== 'connector') {
              errors.push(`rotate_objects freeEndpoints ID "${connId}" is not a connector`);
            }
          }
          if (!ep || typeof ep !== 'object' || Array.isArray(ep)) {
            errors.push(`rotate_objects freeEndpoints entry for "${connId}" must be an object`);
            continue;
          }
          if (!ep.from && !ep.to) {
            errors.push(`rotate_objects freeEndpoints entry for "${connId}" must contain "from" or "to" endpoint`);
          }
          if (ep.from !== undefined) {
            if (!ep.from || typeof ep.from !== 'object' || Array.isArray(ep.from) || !isValidFinite(ep.from.x) || !isValidFinite(ep.from.y)) {
              errors.push(`rotate_objects freeEndpoints "${connId}".from must be an object with finite numeric coordinates`);
            }
          }
          if (ep.to !== undefined) {
            if (!ep.to || typeof ep.to !== 'object' || Array.isArray(ep.to) || !isValidFinite(ep.to.x) || !isValidFinite(ep.to.y)) {
              errors.push(`rotate_objects freeEndpoints "${connId}".to must be an object with finite numeric coordinates`);
            }
          }
        }
      }
    }
  } else if (cmd.type === 'batch') {
    if (!Array.isArray(cmd.commands)) {
      errors.push('batch requires an array of commands');
    } else {
      for (let i = 0; i < cmd.commands.length; i++) {
        const sub = validateCommand(cmd.commands[i], doc);
        if (!sub.valid) {
          errors.push(`batch command [${i}]: ${sub.errors.join(', ')}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function hexToLuminance(hex) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return 0.5;
  let c = hex.slice(1);
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  if (isNaN(num)) return 0.5;
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1, hex2) {
  const l1 = hexToLuminance(hex1);
  const l2 = hexToLuminance(hex2);
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
}

/**
 * Applies an individual command to a Sabura document immutably, returning the updated document
 * and the exact inverse command to undo the operation.
 *
 * @param {Object} doc - Current Sabura document
 * @param {Object} cmd - Command to apply
 * @returns {{ doc: Object, inverseCmd: Object }}
 */
export function applyCommand(doc, cmd) {
  const val = validateCommand(cmd, doc);
  if (!val.valid) {
    if (!cmd || typeof cmd !== 'object' || !SUPPORTED_COMMAND_TYPES.has(cmd.type)) {
      throw new Error(`Unsupported command type: "${cmd?.type}". ${val.errors.join(', ')}`);
    }
    throw new Error(`Command validation failed for ${cmd?.type || 'unknown'}: ${val.errors.join(', ')}`);
  }

  const newDoc = cloneDocument(doc);

  switch (cmd.type) {
    case 'create_asset': {
      const asset = cloneDocument(cmd.asset);
      if (!asset.id) asset.id = generateId('asset');
      if (newDoc.assets[asset.id]) throw new Error(`Asset ID already exists: "${asset.id}"`);
      newDoc.assets[asset.id] = asset;
      return { doc: newDoc, inverseCmd: { type: 'delete_asset', id: asset.id } };
    }

    case 'create_image': {
      const asset = cloneDocument(cmd.asset);
      const obj = cloneDocument(cmd.object);
      if (!asset.id) asset.id = generateId('asset');
      if (!obj.id) obj.id = generateId('image');
      if (obj.assetId !== asset.id) {
        throw new Error('create_image object.assetId must match asset.id');
      }
      if (newDoc.assets[asset.id]) throw new Error(`Asset ID already exists: "${asset.id}"`);
      if (newDoc.objects[obj.id]) throw new Error(`Object ID already exists: "${obj.id}"`);
      newDoc.assets[asset.id] = asset;
      newDoc.objects[obj.id] = obj;
      const atIndex = typeof cmd.atIndex === 'number' ? Math.max(0, Math.min(newDoc.order.length, cmd.atIndex)) : newDoc.order.length;
      newDoc.order.splice(atIndex, 0, obj.id);
      const finalVal = validateDocument(newDoc);
      if (!finalVal.valid) throw new Error(`create_image produced an invalid document: ${finalVal.errors.join(', ')}`);
      return {
        doc: newDoc,
        inverseCmd: { type: 'delete_objects', ids: [obj.id] }
      };
    }

    case 'create_object': {
      const obj = cloneDocument(cmd.object);
      if (!obj.id) obj.id = generateId(obj.type || 'obj');
      if (obj.seed === undefined) obj.seed = generateSeed();

      newDoc.objects[obj.id] = obj;
      const atIndex = typeof cmd.atIndex === 'number' ? Math.max(0, Math.min(newDoc.order.length, cmd.atIndex)) : newDoc.order.length;
      newDoc.order.splice(atIndex, 0, obj.id);

      const inverseCmd = {
        type: 'delete_objects',
        ids: [obj.id]
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'delete_asset': {
      const asset = newDoc.assets[cmd.id];
      if (!asset) return { doc: newDoc, inverseCmd: { type: 'noop' } };
      if (Object.values(newDoc.objects).some(obj => obj?.assetId === cmd.id)) {
        throw new Error(`Cannot delete referenced asset "${cmd.id}"`);
      }
      delete newDoc.assets[cmd.id];
      return { doc: newDoc, inverseCmd: { type: 'create_asset', asset } };
    }

    case 'delete_objects': {
      const idsToDelete = (cmd.ids || []).filter(id => Boolean(newDoc.objects[id]) && !newDoc.objects[id].locked);
      if (idsToDelete.length === 0) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }

      const savedObjects = [];
      const deletedImageAssetIds = new Set(idsToDelete
        .map(id => newDoc.objects[id])
        .filter(obj => obj?.type === IMAGE_OBJECT_TYPE && obj.assetId)
        .map(obj => obj.assetId));
      const savedAssets = [];
      for (const id of idsToDelete) {
        const index = newDoc.order.indexOf(id);
        savedObjects.push({
          object: cloneDocument(newDoc.objects[id]),
          orderIndex: index
        });
        delete newDoc.objects[id];
      }

      newDoc.order = newDoc.order.filter(id => !idsToDelete.includes(id));

      // Assets are owned by the document, not by an individual command. Remove
      // only those whose final live image reference was deleted, and retain
      // shared assets for the remaining objects.
      for (const assetId of deletedImageAssetIds) {
        const stillReferenced = Object.values(newDoc.objects).some(obj => obj?.type === IMAGE_OBJECT_TYPE && obj.assetId === assetId);
        if (!stillReferenced && newDoc.assets[assetId]) {
          savedAssets.push({ id: assetId, asset: cloneDocument(newDoc.assets[assetId]) });
          delete newDoc.assets[assetId];
        }
      }

      if (Array.isArray(cmd.removeGroups)) {
        for (const gId of cmd.removeGroups) {
          delete newDoc.groups[gId];
        }
      }

      // Reconnect connectors that referenced deleted objects to static points
      const affectedConnectors = [];
      for (const [cId, conn] of Object.entries(newDoc.objects)) {
        if (conn.type !== 'connector') continue;
        let modified = false;
        const prevFrom = cloneDocument(conn.from);
        const prevTo = cloneDocument(conn.to);

        if (conn.from && conn.from.id && idsToDelete.includes(conn.from.id)) {
          // Disconnect from object
          conn.from = { point: conn.from.point || { x: conn.x, y: conn.y } };
          modified = true;
        }
        if (conn.to && conn.to.id && idsToDelete.includes(conn.to.id)) {
          conn.to = { point: conn.to.point || { x: conn.x + conn.width, y: conn.y + conn.height } };
          modified = true;
        }
        if (modified) {
          affectedConnectors.push({ id: cId, prevFrom, prevTo });
        }
      }

      const inverseCmd = {
        type: 'batch',
        commands: [
          ...savedAssets.map(item => ({
            type: 'create_asset',
            asset: item.asset
          })),
          ...savedObjects.map(item => ({
            type: 'create_object',
            object: item.object,
            atIndex: item.orderIndex
          })),
          ...affectedConnectors.map(ac => ({
            type: 'configure_connector_endpoints',
            id: ac.id,
            from: ac.prevFrom,
            to: ac.prevTo
          }))
        ]
      };

      return { doc: newDoc, inverseCmd };
    }

    case 'duplicate_objects': {
      const ids = (cmd.ids || []).filter(id => Boolean(newDoc.objects[id]) && !newDoc.objects[id].locked);
      if (ids.length === 0) return { doc: newDoc, inverseCmd: { type: 'noop' } };
      const offset = cmd.offset || { x: 24, y: 24 };
      const duplicatedIds = [];
      const newObjects = [];
      const idMap = {};
      const groupMap = {};

      // 1. First pass: clone objects, assign new IDs, and clone groups
      for (const id of ids) {
        const source = newDoc.objects[id];
        const newId = generateId(source.type || 'dup');
        idMap[id] = newId;

        const dup = cloneDocument(source);
        dup.id = newId;
        if (typeof dup.x === 'number') dup.x += offset.x;
        if (typeof dup.y === 'number') dup.y += offset.y;
        dup.seed = generateSeed();
        dup.locked = false; // Duplicated objects are unlocked by default

        if (dup.groupId) {
          if (!groupMap[dup.groupId]) {
            const newGid = generateId('grp');
            groupMap[dup.groupId] = newGid;
            const origGroup = newDoc.groups[dup.groupId];
            newDoc.groups[newGid] = { id: newGid, name: origGroup?.name || 'Group' };
          }
          dup.groupId = groupMap[dup.groupId];
        }

        newDoc.objects[newId] = dup;
        newDoc.order.push(newId);
        duplicatedIds.push(newId);
        newObjects.push(dup);
      }

      // 2. Second pass: Rebind connector endpoints
      for (const dup of newObjects) {
        if (dup.type === 'connector') {
          // Rebind 'from' endpoint
          if (dup.from) {
            if (dup.from.id && idMap[dup.from.id]) {
              dup.from.id = idMap[dup.from.id];
            } else if (dup.from.id) {
              // Connected to external uncopied object: convert to free point offset by (dx, dy)
              const origId = Object.keys(idMap).find(k => idMap[k] === dup.id);
              const origConn = doc.objects[origId] || dup;
              const resolved = resolveConnectorGeometry(doc, origConn);
              dup.from = {
                point: {
                  x: resolved.start.x + offset.x,
                  y: resolved.start.y + offset.y
                }
              };
            } else if (dup.from.point) {
              dup.from.point.x += offset.x;
              dup.from.point.y += offset.y;
            }
          }

          // Rebind 'to' endpoint
          if (dup.to) {
            if (dup.to.id && idMap[dup.to.id]) {
              dup.to.id = idMap[dup.to.id];
            } else if (dup.to.id) {
              // Connected to external uncopied object: convert to free point offset by (dx, dy)
              const origId = Object.keys(idMap).find(k => idMap[k] === dup.id);
              const origConn = doc.objects[origId] || dup;
              const resolved = resolveConnectorGeometry(doc, origConn);
              dup.to = {
                point: {
                  x: resolved.end.x + offset.x,
                  y: resolved.end.y + offset.y
                }
              };
            } else if (dup.to.point) {
              dup.to.point.x += offset.x;
              dup.to.point.y += offset.y;
            }
          }
        }
      }

      const createdGroupIds = Object.values(groupMap);
      const inverseCmd = {
        type: 'delete_objects',
        ids: duplicatedIds,
        removeGroups: createdGroupIds
      };
      return { doc: newDoc, inverseCmd, duplicatedIds };
    }

    case 'move_objects': {
      const dx = Number(cmd.dx) || 0;
      const dy = Number(cmd.dy) || 0;
      const ids = (cmd.ids || []).filter(id => newDoc.objects[id] && !newDoc.objects[id].locked);
      if (ids.length === 0) return { doc: newDoc, inverseCmd: { type: 'noop' } };

      for (const id of ids) {
        const obj = newDoc.objects[id];
        if (typeof obj.x === 'number') obj.x += dx;
        if (typeof obj.y === 'number') obj.y += dy;

        // If it's a connector with point endpoints, translate the points
        if (obj.type === 'connector') {
          if (obj.from && obj.from.point) {
            obj.from.point.x += dx;
            obj.from.point.y += dy;
          }
          if (obj.to && obj.to.point) {
            obj.to.point.x += dx;
            obj.to.point.y += dy;
          }
        }
      }

      const inverseCmd = {
        type: 'move_objects',
        ids,
        dx: -dx,
        dy: -dy
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'resize_object': {
      const obj = newDoc.objects[cmd.id];
      if (!obj) {
        throw new Error(`Cannot resize non-existent object "${cmd.id}"`);
      }
      if (obj.locked) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }
      if (cmd.points !== undefined && cmd.points !== null && obj.type !== 'path') {
        throw new Error(`Cannot apply path points to non-path object "${cmd.id}" of type "${obj.type}"`);
      }

      const prevBounds = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
      const prevTextStyle = obj.textStyle ? cloneDocument(obj.textStyle) : null;
      const prevPoints = obj.type === 'path' && Array.isArray(obj.points) ? cloneDocument(obj.points) : null;

      obj.x = cmd.bounds.x !== undefined ? cmd.bounds.x : obj.x;
      obj.y = cmd.bounds.y !== undefined ? cmd.bounds.y : obj.y;
      obj.width = Math.max(MIN_OBJECT_SIZE, cmd.bounds.width !== undefined ? cmd.bounds.width : obj.width);
      obj.height = Math.max(MIN_OBJECT_SIZE, cmd.bounds.height !== undefined ? cmd.bounds.height : obj.height);

      if (cmd.points && Array.isArray(cmd.points)) {
        obj.points = cloneDocument(cmd.points);
      } else if (obj.type === 'path' && Array.isArray(obj.points) && prevBounds.width > 0 && prevBounds.height > 0) {
        const scaleX = obj.width / prevBounds.width;
        const scaleY = obj.height / prevBounds.height;
        obj.points = obj.points.map(pt => {
          const px = Array.isArray(pt) ? pt[0] : pt.x;
          const py = Array.isArray(pt) ? pt[1] : pt.y;
          return {
            x: Math.round(px * scaleX),
            y: Math.round(py * scaleY)
          };
        });
      }

      if (cmd.textStyle || cmd.restoreTextStyle) {
        obj.textStyle = cloneDocument(cmd.textStyle || cmd.restoreTextStyle);
      } else if (cmd.scaleText && obj.textStyle && prevBounds.width > 0 && prevBounds.height > 0) {
        const scaleX = obj.width / prevBounds.width;
        const scaleY = obj.height / prevBounds.height;
        const scale = (scaleX + scaleY) / 2;
        const newSize = Math.max(10, Math.min(120, Math.round((obj.textStyle.resolvedSize || 20) * scale)));
        obj.textStyle.resolvedSize = newSize;

        if (obj.type === 'text') {
          const familyToken = obj.textStyle?.fontFamily || 'hand';
          const m = measureText(obj.text, newSize, familyToken);
          obj.width = m.width;
          obj.height = m.height;
        }
      }

      const inverseCmd = {
        type: 'resize_object',
        id: cmd.id,
        bounds: prevBounds,
        scaleText: false,
        restoreTextStyle: prevTextStyle
      };
      if (prevPoints) {
        inverseCmd.points = prevPoints;
      }

      return { doc: newDoc, inverseCmd };
    }

    case 'align_objects': {
      const spatialIds = (cmd.ids || []).filter(id => {
        const o = newDoc.objects[id];
        return o && o.type !== 'connector' && !o.locked;
      });
      if (spatialIds.length < 2) return { doc: newDoc, inverseCmd: { type: 'noop' } };
      const objects = spatialIds.map(id => newDoc.objects[id]);
      const deltas = alignObjects(objects, cmd.alignment);
      const prevPositions = {};
      for (const id of spatialIds) {
        const d = deltas[id] || { dx: 0, dy: 0 };
        const obj = newDoc.objects[id];
        prevPositions[id] = { x: obj.x, y: obj.y };
        obj.x += d.dx;
        obj.y += d.dy;
      }
      const inverseCmd = {
        type: 'restore_positions',
        positions: prevPositions
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'distribute_objects': {
      const spatialIds = (cmd.ids || []).filter(id => {
        const o = newDoc.objects[id];
        return o && o.type !== 'connector' && !o.locked;
      });
      if (spatialIds.length < 3) return { doc: newDoc, inverseCmd: { type: 'noop' } };
      const objects = spatialIds.map(id => newDoc.objects[id]);
      const deltas = distributeObjects(objects, cmd.direction);
      const prevPositions = {};
      for (const id of spatialIds) {
        const d = deltas[id] || { dx: 0, dy: 0 };
        const obj = newDoc.objects[id];
        prevPositions[id] = { x: obj.x, y: obj.y };
        obj.x += d.dx;
        obj.y += d.dy;
      }
      const inverseCmd = {
        type: 'restore_positions',
        positions: prevPositions
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'restore_positions': {
      const prev = {};
      for (const [id, pos] of Object.entries(cmd.positions || {})) {
        const obj = newDoc.objects[id];
        if (!obj || obj.locked) continue;
        prev[id] = {
          x: obj.x,
          y: obj.y,
          fromPoint: obj.type === 'connector' && obj.from?.point ? { ...obj.from.point } : null,
          toPoint: obj.type === 'connector' && obj.to?.point ? { ...obj.to.point } : null
        };
        obj.x = pos.x;
        obj.y = pos.y;
        if (obj.type === 'connector') {
          if (pos.fromPoint && obj.from) obj.from.point = { ...pos.fromPoint };
          if (pos.toPoint && obj.to) obj.to.point = { ...pos.toPoint };
        }
      }
      return { doc: newDoc, inverseCmd: Object.keys(prev).length > 0
        ? { type: 'restore_positions', positions: prev }
        : { type: 'noop' } };
    }

    case 'set_text': {
      const obj = newDoc.objects[cmd.id];
      if (!obj || obj.locked || obj.type === IMAGE_OBJECT_TYPE) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }
      const prevText = obj.text || '';
      const prevBounds = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
      obj.text = String(cmd.text !== undefined ? cmd.text : '');

      if (cmd.prevBounds) {
        // Restore bounds during undo
        obj.x = cmd.prevBounds.x;
        obj.y = cmd.prevBounds.y;
        obj.width = cmd.prevBounds.width;
        obj.height = cmd.prevBounds.height;
      } else if (obj.type === 'text') {
        // Auto-fit bounds to text content
        const fontSize = obj.textStyle?.resolvedSize || 20;
        const familyToken = obj.textStyle?.fontFamily || 'hand';
        const m = measureText(obj.text, fontSize, familyToken);
        obj.width = m.width;
        obj.height = m.height;
      }

      const inverseCmd = {
        type: 'set_text',
        id: cmd.id,
        text: prevText,
        prevBounds
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'set_style': {
      const ids = (cmd.ids || []).filter(id => newDoc.objects[id] && !newDoc.objects[id].locked && newDoc.objects[id].type !== IMAGE_OBJECT_TYPE);
      if (ids.length === 0) return { doc: newDoc, inverseCmd: { type: 'noop' } };
      const prevStyles = {};

      for (const id of ids) {
        const obj = newDoc.objects[id];
        prevStyles[id] = {
          fill: obj.fill,
          stroke: obj.stroke,
          strokeWidth: obj.strokeWidth,
          strokeStyle: obj.strokeStyle,
          opacity: obj.opacity,
          roughness: obj.roughness,
          curveStyle: obj.curveStyle,
          closed: obj.closed,
          startArrow: obj.startArrow,
          endArrow: obj.endArrow,
          textStyle: obj.textStyle ? cloneDocument(obj.textStyle) : null
        };

        if (cmd.updates.fill !== undefined) obj.fill = cmd.updates.fill;
        if (cmd.updates.stroke !== undefined) obj.stroke = cmd.updates.stroke;
        if (cmd.updates.strokeWidth !== undefined) obj.strokeWidth = cmd.updates.strokeWidth;
        if (cmd.updates.strokeStyle !== undefined) obj.strokeStyle = cmd.updates.strokeStyle;
        if (cmd.updates.opacity !== undefined) obj.opacity = cmd.updates.opacity;
        if (cmd.updates.roughness !== undefined) obj.roughness = cmd.updates.roughness;
        if (cmd.updates.curveStyle !== undefined) obj.curveStyle = cmd.updates.curveStyle;
        if (cmd.updates.closed !== undefined) obj.closed = cmd.updates.closed;
        if (cmd.updates.startArrow !== undefined) obj.startArrow = cmd.updates.startArrow;
        if (cmd.updates.endArrow !== undefined) obj.endArrow = cmd.updates.endArrow;

        // If stroke is changed, update text color reliably for standalone text and shapes matching prior stroke
        if (cmd.updates.stroke !== undefined) {
          if (obj.type === 'text') {
            if (!obj.textStyle) obj.textStyle = {};
            obj.textStyle.color = cmd.updates.stroke;
          } else if (obj.textStyle && obj.textStyle.color === prevStyles[id].stroke) {
            obj.textStyle.color = cmd.updates.stroke;
          }
        }
      }

      const inverseCmd = {
        type: 'restore_styles',
        styles: prevStyles
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'set_image_fit': {
      const obj = newDoc.objects[cmd.id];
      if (!obj || obj.type !== IMAGE_OBJECT_TYPE || obj.locked) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }
      const previousFit = obj.fit || 'contain';
      obj.fit = cmd.fit;
      return {
        doc: newDoc,
        inverseCmd: { type: 'set_image_fit', id: cmd.id, fit: previousFit }
      };
    }

    case 'set_image_opacity': {
      const obj = newDoc.objects[cmd.id];
      if (!obj || obj.type !== IMAGE_OBJECT_TYPE || obj.locked) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }
      const previousOpacity = obj.opacity !== undefined ? obj.opacity : 1;
      obj.opacity = cmd.opacity;
      return {
        doc: newDoc,
        inverseCmd: { type: 'set_image_opacity', id: cmd.id, opacity: previousOpacity }
      };
    }

    case 'restore_styles': {
      const styles = cmd.styles || {};
      const prevStyles = {};
      for (const [id, style] of Object.entries(styles)) {
        const obj = newDoc.objects[id];
        // Image presentation is intentionally not a shape style surface. In
        // particular, never let an inverse restore add fill/stroke/text fields
        // to an image or mutate one while it is locked.
        if (!obj || obj.locked || obj.type === IMAGE_OBJECT_TYPE) continue;
        prevStyles[id] = {
          fill: obj.fill,
          stroke: obj.stroke,
          strokeWidth: obj.strokeWidth,
          strokeStyle: obj.strokeStyle,
          opacity: obj.opacity,
          roughness: obj.roughness,
          curveStyle: obj.curveStyle,
          closed: obj.closed,
          startArrow: obj.startArrow,
          endArrow: obj.endArrow,
          textStyle: obj.textStyle ? cloneDocument(obj.textStyle) : null
        };
        const { textStyle, ...rest } = style;
        Object.assign(obj, rest);
        if (textStyle !== undefined) {
          if (textStyle) obj.textStyle = cloneDocument(textStyle);
          else delete obj.textStyle;
        }
      }
      return { doc: newDoc, inverseCmd: Object.keys(prevStyles).length > 0
        ? { type: 'restore_styles', styles: prevStyles }
        : { type: 'noop' } };
    }

    case 'set_typography': {
      const ids = (cmd.ids || []).filter(id => newDoc.objects[id] && !newDoc.objects[id].locked && newDoc.objects[id].type !== IMAGE_OBJECT_TYPE);
      const prevTypography = {};

      for (const id of ids) {
        const obj = newDoc.objects[id];
        if (!obj.textStyle) continue;
        prevTypography[id] = cloneDocument(obj.textStyle);

        if (cmd.updates.size !== undefined) {
          obj.textStyle.size = cmd.updates.size;
          obj.textStyle.resolvedSize = FONT_SIZES[cmd.updates.size] || obj.textStyle.resolvedSize || 20;
        }
        if (cmd.updates.resolvedSize !== undefined) obj.textStyle.resolvedSize = cmd.updates.resolvedSize;
        if (cmd.updates.fontFamily !== undefined) obj.textStyle.fontFamily = cmd.updates.fontFamily;
        if (cmd.updates.bold !== undefined) obj.textStyle.bold = cmd.updates.bold;
        if (cmd.updates.align !== undefined) obj.textStyle.align = cmd.updates.align;
        if (cmd.updates.color !== undefined) obj.textStyle.color = cmd.updates.color;
      }

      if (Object.keys(prevTypography).length === 0) return { doc: newDoc, inverseCmd: { type: 'noop' } };
      const inverseCmd = {
        type: 'restore_typography',
        typography: prevTypography
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'restore_typography': {
      const prev = {};
      for (const [id, style] of Object.entries(cmd.typography || {})) {
        const obj = newDoc.objects[id];
        if (!obj || obj.locked || obj.type === IMAGE_OBJECT_TYPE) continue;
        prev[id] = cloneDocument(obj.textStyle);
        obj.textStyle = cloneDocument(style);
      }
      return { doc: newDoc, inverseCmd: Object.keys(prev).length > 0
        ? { type: 'restore_typography', typography: prev }
        : { type: 'noop' } };
    }

    case 'change_shape': {
      const obj = newDoc.objects[cmd.id];
      if (!obj || obj.locked || obj.type === IMAGE_OBJECT_TYPE) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }
      const prevType = obj.type;
      obj.type = cmd.newType;

      const inverseCmd = {
        type: 'change_shape',
        id: cmd.id,
        newType: prevType
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'lock_objects': {
      const locked = Boolean(cmd.locked);
      const ids = (cmd.ids || []).filter(id => Boolean(newDoc.objects[id]) && newDoc.objects[id].locked !== locked);
      if (ids.length === 0) return { doc: newDoc, inverseCmd: { type: 'noop' } };
      for (const id of ids) {
        newDoc.objects[id].locked = locked;
      }
      const inverseCmd = {
        type: 'lock_objects',
        ids,
        locked: !locked
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'reorder_objects': {
      const ids = (cmd.ids || []).filter(id => newDoc.objects[id] && !newDoc.objects[id].locked);
      if (ids.length === 0) return { doc: newDoc, inverseCmd: { type: 'noop' } };

      const prevOrder = [...newDoc.order];
      const action = cmd.action; // 'front' | 'back' | 'forward' | 'backward'

      if (action === 'front') {
        newDoc.order = newDoc.order.filter(id => !ids.includes(id)).concat(ids);
      } else if (action === 'back') {
        newDoc.order = ids.concat(newDoc.order.filter(id => !ids.includes(id)));
      } else if (action === 'forward') {
        // Move each target forward by 1 index from top to bottom
        for (let i = newDoc.order.length - 2; i >= 0; i--) {
          const curr = newDoc.order[i];
          const next = newDoc.order[i + 1];
          if (ids.includes(curr) && !ids.includes(next)) {
            newDoc.order[i] = next;
            newDoc.order[i + 1] = curr;
          }
        }
      } else if (action === 'backward') {
        // Move each target backward by 1 index from bottom to top
        for (let i = 1; i < newDoc.order.length; i++) {
          const curr = newDoc.order[i];
          const prev = newDoc.order[i - 1];
          if (ids.includes(curr) && !ids.includes(prev)) {
            newDoc.order[i] = prev;
            newDoc.order[i - 1] = curr;
          }
        }
      }

      if (ids.length === 0) return { doc: newDoc, inverseCmd: { type: 'noop' } };
      const inverseCmd = {
        type: 'restore_order',
        order: prevOrder
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'restore_order': {
      const requestedOrder = [...cmd.order];
      const movesLockedImage = Object.values(newDoc.objects).some(object =>
        object?.type === IMAGE_OBJECT_TYPE && object.locked &&
        newDoc.order.indexOf(object.id) !== requestedOrder.indexOf(object.id)
      );
      if (movesLockedImage) return { doc: newDoc, inverseCmd: { type: 'noop' } };
      const prevOrder = [...newDoc.order];
      newDoc.order = requestedOrder;
      return { doc: newDoc, inverseCmd: { type: 'restore_order', order: prevOrder } };
    }

    case 'group_objects': {
      const ids = (cmd.ids || []).filter(id => newDoc.objects[id] && !newDoc.objects[id].locked);
      if (ids.length < 2) return { doc: newDoc, inverseCmd: { type: 'noop' } };

      const groupId = cmd.groupId || generateId('grp');
      const prevGroupIds = {};

      for (const id of ids) {
        prevGroupIds[id] = newDoc.objects[id].groupId;
        newDoc.objects[id].groupId = groupId;
      }
      newDoc.groups[groupId] = { id: groupId, name: cmd.name || 'Group' };

      const inverseCmd = {
        type: 'restore_groups',
        groupIds: prevGroupIds,
        removeGroup: groupId
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'ungroup_objects': {
      const groupIds = cmd.groupIds || [];
      const lockedImageMember = Object.values(newDoc.objects).some(object =>
        object?.type === IMAGE_OBJECT_TYPE && object.locked && groupIds.includes(object.groupId)
      );
      if (lockedImageMember) return { doc: newDoc, inverseCmd: { type: 'noop' } };
      const restoredGroups = {};
      const restoredMembers = {};

      for (const gId of groupIds) {
        if (newDoc.groups[gId]) {
          restoredGroups[gId] = cloneDocument(newDoc.groups[gId]);
          delete newDoc.groups[gId];
        }
      }

      for (const [id, obj] of Object.entries(newDoc.objects)) {
        if (obj.groupId && groupIds.includes(obj.groupId)) {
          restoredMembers[id] = obj.groupId;
          obj.groupId = null;
        }
      }

      const inverseCmd = {
        type: 'restore_ungroup',
        groups: restoredGroups,
        members: restoredMembers
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'restore_groups': {
      const groupIds = cmd.groupIds || {};
      const lockedImageGroupIds = new Set(Object.values(newDoc.objects)
        .filter(object => object?.type === IMAGE_OBJECT_TYPE && object.locked && object.groupId)
        .map(object => object.groupId));
      const affectsLockedImage = Object.entries(groupIds).some(([id, gId]) => {
        const object = newDoc.objects[id];
        if (!object || object.groupId === gId) return false;
        return (object.type === IMAGE_OBJECT_TYPE && object.locked) ||
          lockedImageGroupIds.has(object.groupId) || lockedImageGroupIds.has(gId);
      }) || (cmd.removeGroup && lockedImageGroupIds.has(cmd.removeGroup));
      if (affectsLockedImage) return { doc: newDoc, inverseCmd: { type: 'noop' } };
      for (const [id, gId] of Object.entries(groupIds)) {
        if (newDoc.objects[id]) newDoc.objects[id].groupId = gId;
      }
      if (cmd.removeGroup) {
        delete newDoc.groups[cmd.removeGroup];
      }
      return { doc: newDoc, inverseCmd: { type: 'noop' } };
    }

    case 'restore_ungroup': {
      const groups = cmd.groups || {};
      const members = cmd.members || {};
      const lockedImageGroupIds = new Set(Object.values(newDoc.objects)
        .filter(object => object?.type === IMAGE_OBJECT_TYPE && object.locked && object.groupId)
        .map(object => object.groupId));
      const affectsLockedImage = Object.keys(groups).some(groupId => lockedImageGroupIds.has(groupId)) ||
        Object.entries(members).some(([id, groupId]) => {
          const object = newDoc.objects[id];
          if (!object || object.groupId === groupId) return false;
          return (object.type === IMAGE_OBJECT_TYPE && object.locked) ||
            lockedImageGroupIds.has(object.groupId) || lockedImageGroupIds.has(groupId);
        });
      if (affectsLockedImage) return { doc: newDoc, inverseCmd: { type: 'noop' } };
      for (const [gId, gData] of Object.entries(groups)) {
        newDoc.groups[gId] = gData;
      }
      for (const [id, gId] of Object.entries(members)) {
        if (newDoc.objects[id]) newDoc.objects[id].groupId = gId;
      }
      return { doc: newDoc, inverseCmd: { type: 'noop' } };
    }

    case 'connect_objects': {
      const cId = cmd.connectorId || generateId('conn');
      const prevConnector = newDoc.objects[cId] ? cloneDocument(newDoc.objects[cId]) : null;

      const connectorObj = {
        id: cId,
        type: 'connector',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        stroke: cmd.stroke || newDoc.theme.defaultStroke,
        strokeWidth: cmd.strokeWidth || newDoc.theme.defaultStrokeWidth,
        strokeStyle: cmd.strokeStyle || 'solid',
        opacity: cmd.opacity !== undefined ? cmd.opacity : 1.0,
        roughness: cmd.roughness !== undefined ? cmd.roughness : newDoc.theme.defaultRoughness,
        seed: generateSeed(),
        locked: false,
        from: { id: cmd.fromId, side: cmd.fromSide },
        to: { id: cmd.toId, side: cmd.toSide },
        routing: cmd.routing || 'straight',
        startArrow: cmd.startArrow || false,
        endArrow: cmd.endArrow !== undefined ? cmd.endArrow : true
      };

      newDoc.objects[cId] = connectorObj;
      if (!newDoc.order.includes(cId)) {
        newDoc.order.push(cId);
      }

      const inverseCmd = prevConnector
        ? { type: 'create_object', object: prevConnector }
        : { type: 'delete_objects', ids: [cId] };

      return { doc: newDoc, inverseCmd };
    }

    case 'reconnect_connector': {
      const conn = newDoc.objects[cmd.id];
      if (!conn) {
        throw new Error(`Cannot reconnect non-existent connector "${cmd.id}"`);
      }
      if (conn.type !== 'connector') {
        throw new Error(`Object "${cmd.id}" is not a connector`);
      }
      if (conn.locked) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }
      if (cmd.target?.id) {
        const target = newDoc.objects[cmd.target.id];
        if (!target) {
          throw new Error(`Target object "${cmd.target.id}" for connector "${cmd.id}" not found`);
        }
        if (target.type === 'connector') {
          throw new Error(`Connector "${cmd.id}" cannot attach to another connector "${cmd.target.id}"`);
        }
      }
      const endpoint = cmd.endpoint; // 'from' | 'to'
      const prevTarget = cloneDocument(conn[endpoint]);
      conn[endpoint] = cloneDocument(cmd.target);

      const inverseCmd = {
        type: 'reconnect_connector',
        id: cmd.id,
        endpoint,
        target: prevTarget
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'configure_connector': {
      const conn = newDoc.objects[cmd.id];
      if (!conn) {
        throw new Error(`Cannot configure non-existent connector "${cmd.id}"`);
      }
      if (conn.type !== 'connector') {
        throw new Error(`Object "${cmd.id}" is not a connector`);
      }
      if (conn.locked) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }
      const prevConfig = {
        routing: conn.routing,
        curveSide: conn.curveSide !== undefined ? conn.curveSide : 1,
        curveDistance: conn.curveDistance !== undefined ? conn.curveDistance : null,
        elbowOffset: conn.elbowOffset !== undefined ? conn.elbowOffset : null,
        startArrow: conn.startArrow,
        endArrow: conn.endArrow,
        stacking: conn.stacking
      };

      if (cmd.routing !== undefined) conn.routing = cmd.routing;
      if (cmd.curveSide !== undefined) conn.curveSide = cmd.curveSide;
      if (cmd.curveDistance !== undefined) {
        if (cmd.curveDistance === null) delete conn.curveDistance;
        else conn.curveDistance = cmd.curveDistance;
      }
      if (cmd.elbowOffset !== undefined) {
        if (cmd.elbowOffset === null) delete conn.elbowOffset;
        else conn.elbowOffset = cmd.elbowOffset;
      }
      if (cmd.startArrow !== undefined) conn.startArrow = cmd.startArrow;
      if (cmd.endArrow !== undefined) conn.endArrow = cmd.endArrow;
      if (cmd.stacking !== undefined) conn.stacking = cmd.stacking;

      const inverseCmd = {
        type: 'configure_connector',
        id: cmd.id,
        ...prevConfig
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'configure_connector_endpoints': {
      const conn = newDoc.objects[cmd.id];
      if (!conn) {
        throw new Error(`Cannot configure endpoints on non-existent connector "${cmd.id}"`);
      }
      if (conn.type !== 'connector') {
        throw new Error(`Object "${cmd.id}" is not a connector`);
      }
      if (conn.locked) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }
      if (cmd.from?.id) {
        const target = newDoc.objects[cmd.from.id];
        if (!target) {
          throw new Error(`Target object "${cmd.from.id}" for connector "${cmd.id}" from endpoint not found`);
        }
        if (target.type === 'connector') {
          throw new Error(`Connector "${cmd.id}" cannot attach to another connector "${cmd.from.id}"`);
        }
      }
      if (cmd.to?.id) {
        const target = newDoc.objects[cmd.to.id];
        if (!target) {
          throw new Error(`Target object "${cmd.to.id}" for connector "${cmd.id}" to endpoint not found`);
        }
        if (target.type === 'connector') {
          throw new Error(`Connector "${cmd.id}" cannot attach to another connector "${cmd.to.id}"`);
        }
      }
      const prevFrom = cloneDocument(conn.from);
      const prevTo = cloneDocument(conn.to);
      conn.from = cloneDocument(cmd.from);
      conn.to = cloneDocument(cmd.to);

      return {
        doc: newDoc,
        inverseCmd: {
          type: 'configure_connector_endpoints',
          id: cmd.id,
          from: prevFrom,
          to: prevTo
        }
      };
    }

    case 'update_path_points': {
      const obj = newDoc.objects[cmd.id];
      if (!obj) {
        throw new Error(`Cannot update path points on non-existent object "${cmd.id}"`);
      }
      if (obj.type !== 'path') {
        throw new Error(`Cannot update path points on non-path object "${cmd.id}" of type "${obj.type}"`);
      }
      if (obj.locked) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }

      const prevPoints = cloneDocument(obj.points);
      const prevBounds = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };

      obj.points = cloneDocument(cmd.points);
      if (cmd.bounds) {
        obj.x = cmd.bounds.x !== undefined ? cmd.bounds.x : obj.x;
        obj.y = cmd.bounds.y !== undefined ? cmd.bounds.y : obj.y;
        obj.width = Math.max(MIN_OBJECT_SIZE, cmd.bounds.width !== undefined ? cmd.bounds.width : obj.width);
        obj.height = Math.max(MIN_OBJECT_SIZE, cmd.bounds.height !== undefined ? cmd.bounds.height : obj.height);
      }

      const inverseCmd = {
        type: 'update_path_points',
        id: cmd.id,
        points: prevPoints,
        bounds: prevBounds
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'rotate_objects': {
      const prevObjects = {};
      const prevFreeEndpoints = {};

      if (cmd.objects && typeof cmd.objects === 'object') {
        for (const [id, entry] of Object.entries(cmd.objects)) {
          const obj = newDoc.objects[id];
          if (!obj || obj.locked) continue;
          prevObjects[id] = {
            rotation: obj.rotation !== undefined ? obj.rotation : 0,
            x: obj.x,
            y: obj.y
          };
          obj.rotation = entry.rotation;
          if (entry.x !== undefined && typeof obj.x === 'number') obj.x = entry.x;
          if (entry.y !== undefined && typeof obj.y === 'number') obj.y = entry.y;
        }
      }

      if (cmd.freeEndpoints && typeof cmd.freeEndpoints === 'object') {
        for (const [connId, ep] of Object.entries(cmd.freeEndpoints)) {
          const conn = newDoc.objects[connId];
          if (!conn || conn.locked || conn.type !== 'connector') continue;
          const prevEp = {};
          if (ep.from && conn.from && conn.from.point) {
            prevEp.from = { x: conn.from.point.x, y: conn.from.point.y };
            conn.from.point.x = ep.from.x;
            conn.from.point.y = ep.from.y;
          }
          if (ep.to && conn.to && conn.to.point) {
            prevEp.to = { x: conn.to.point.x, y: conn.to.point.y };
            conn.to.point.x = ep.to.x;
            conn.to.point.y = ep.to.y;
          }
          if (Object.keys(prevEp).length > 0) {
            prevFreeEndpoints[connId] = prevEp;
          }
        }
      }

      const inverseCmd = {
        type: 'rotate_objects',
        objects: prevObjects,
        freeEndpoints: prevFreeEndpoints
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'set_title': {
      const prevTitle = newDoc.title;
      newDoc.title = typeof cmd.title === 'string' ? cmd.title : newDoc.title;
      return { doc: newDoc, inverseCmd: { type: 'set_title', title: prevTitle } };
    }

    case 'set_board_theme': {
      const prevTheme = cloneDocument(newDoc.theme);
      let targetTheme = cmd.theme;
      if (!targetTheme && cmd.themeId && THEME_PRESETS[cmd.themeId]) {
        targetTheme = THEME_PRESETS[cmd.themeId];
      }
      if (!targetTheme) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }
      newDoc.theme = { ...newDoc.theme, ...targetTheme };

      const prevObjectStyles = {};

      if (cmd.restoreObjects) {
        for (const [id, st] of Object.entries(cmd.restoreObjects)) {
          if (newDoc.objects[id]) {
            if (st.stroke !== undefined) newDoc.objects[id].stroke = st.stroke;
            if (st.fill !== undefined) newDoc.objects[id].fill = st.fill;
            if (st.textColor !== undefined && newDoc.objects[id].textStyle) {
              newDoc.objects[id].textStyle.color = st.textColor;
            }
          }
        }
      } else {
        // Restyle complete existing board coherently across shapes, text, and connectors
        const oldStroke = prevTheme.defaultStroke;
        const newStroke = newDoc.theme.defaultStroke;
        const oldBg = prevTheme.background;
        const newBg = newDoc.theme.background;

        for (const [id, obj] of Object.entries(newDoc.objects)) {
          const styleBackup = {};

          // 1. Stroke (shapes & connectors)
          const strokeLum = hexToLuminance(obj.stroke);
          const bgLum = hexToLuminance(newBg);
          const isDarkOnDark = bgLum < 0.25 && strokeLum < 0.15;
          const isLightOnLight = bgLum > 0.75 && strokeLum > 0.85;
          const matchesOldStroke = obj.stroke === oldStroke || obj.stroke === prevTheme.palette?.[0] || obj.stroke === '#1e1e1e';
          if (matchesOldStroke || isDarkOnDark || isLightOnLight) {
            styleBackup.stroke = obj.stroke;
            obj.stroke = newStroke;
          }

          // 2. Fill (shapes)
          if (obj.fill === oldBg) {
            styleBackup.fill = obj.fill;
            obj.fill = newBg;
          } else if (prevTheme.defaultFill && obj.fill === prevTheme.defaultFill) {
            styleBackup.fill = obj.fill;
            obj.fill = newDoc.theme.defaultFill || 'none';
          } else if (obj.fill && obj.fill !== 'none') {
            const fillContrast = contrastRatio(obj.fill, newBg);
            if (fillContrast < 1.15 && (obj.fill === '#ffffff' || obj.fill === '#0c192e' || obj.fill === '#18181b' || obj.fill === '#fcfaf6')) {
              styleBackup.fill = obj.fill;
              obj.fill = newBg;
            }
          }

          // 3. Text (standalone or inside shape)
          const effectiveBg = (obj.fill && obj.fill !== 'none') ? obj.fill : newBg;
          const curTextColor = obj.textStyle?.color || obj.stroke;
          const textLum = hexToLuminance(curTextColor);
          const effBgLum = hexToLuminance(effectiveBg);
          const textDarkOnDark = effBgLum < 0.25 && textLum < 0.15;
          const textLightOnLight = effBgLum > 0.75 && textLum > 0.85;
          if (obj.textStyle?.color === oldStroke || textDarkOnDark || textLightOnLight) {
            styleBackup.textColor = obj.textStyle?.color;
            if (!obj.textStyle) obj.textStyle = {};
            obj.textStyle.color = newStroke;
          }

          if (Object.keys(styleBackup).length > 0) {
            prevObjectStyles[id] = styleBackup;
          }
        }
      }

      const inverseCmd = {
        type: 'set_board_theme',
        theme: prevTheme,
        restoreObjects: prevObjectStyles
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'batch': {
      const batchResult = applyCommandBatch(newDoc, cmd.commands || []);
      return { doc: batchResult.doc, inverseCmd: batchResult.inverseCmd };
    }

    case 'noop':
      return { doc: newDoc, inverseCmd: { type: 'noop' } };

    default:
      throw new Error(`Unsupported command type: "${cmd.type}". Supported command types are: ${Array.from(SUPPORTED_COMMAND_TYPES).join(', ')}`);
  }
}

/**
 * Applies a batch of commands sequentially and atomically.
 * Validates all commands and document transitions first and rolls back completely on any error.
 * @param {Object} doc
 * @param {Array<Object>} commands
 * @returns {{ doc: Object, inverseBatch: Object }}
 */
export function applyCommandBatch(doc, commands) {
  if (!Array.isArray(commands)) {
    throw new Error('Commands must be an array');
  }

  // 1. Dry run simulation to validate document-dependent transitions
  let simDoc = cloneDocument(doc);
  for (let i = 0; i < commands.length; i++) {
    const subCmd = commands[i];
    const val = validateCommand(subCmd, simDoc);
    if (!val.valid) {
      throw new Error(`Validation failed for command [${i}] (${subCmd?.type || 'unknown'}): ${val.errors.join(', ')}`);
    }
    const simRes = applyCommand(simDoc, subCmd);
    simDoc = simRes.doc;
  }

  const finalVal = validateDocument(simDoc);
  if (!finalVal.valid) {
    throw new Error(`Batch execution failed: resulting document is invalid: ${finalVal.errors.join(', ')}`);
  }

  // 2. Real application on clean clone
  const initialClone = cloneDocument(doc);
  const inverseList = [];
  let currentDoc = initialClone;

  for (let i = 0; i < commands.length; i++) {
    const result = applyCommand(currentDoc, commands[i]);
    currentDoc = result.doc;
    if (result.inverseCmd && result.inverseCmd.type !== 'noop') {
      inverseList.push(result.inverseCmd);
    }
  }

  inverseList.reverse();
  const inverseCmd = inverseList.length > 0
    ? { type: 'batch', commands: inverseList }
    : { type: 'noop' };
  return { doc: currentDoc, inverseCmd };
}
