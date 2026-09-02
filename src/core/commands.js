/**
 * Sabura Command Engine: Atomic Reducer, Validation, and Inverse Generation.
 */

import { COMMANDS_SCHEMA_VERSION, FONT_SIZES, MIN_OBJECT_SIZE, THEME_PRESETS } from './types.js';
import { cloneDocument, generateId, generateSeed } from './document.js';
import { alignObjects, distributeObjects, measureText, resolveConnectorGeometry } from './geometry.js';

export const SUPPORTED_COMMAND_TYPES = new Set([
  'create_object',
  'delete_objects',
  'move_objects',
  'resize_object',
  'set_style',
  'set_typography',
  'set_text',
  'change_shape',
  'group_objects',
  'ungroup_objects',
  'lock_objects',
  'reorder_objects',
  'align_objects',
  'distribute_objects',
  'reconnect_connector',
  'configure_connector',
  'configure_connector_endpoints',
  'duplicate_objects',
  'set_board_theme',
  'set_title',
  'update_path_points',
  'batch',
  'noop'
]);

/**
 * Validates an individual command structure.
 * Rejects unknown command types with a descriptive error.
 * @param {any} cmd 
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCommand(cmd) {
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

  // Type-specific field validations
  if (cmd.type === 'create_object') {
    if (!cmd.object || typeof cmd.object !== 'object' || Array.isArray(cmd.object)) {
      errors.push('create_object requires a valid object payload');
    }
  } else if (cmd.type === 'delete_objects') {
    if (!Array.isArray(cmd.ids)) {
      errors.push('delete_objects requires an array of ids');
    }
  } else if (cmd.type === 'move_objects') {
    if (!Array.isArray(cmd.ids)) errors.push('move_objects requires an array of ids');
    if (typeof cmd.dx !== 'number' || typeof cmd.dy !== 'number') {
      errors.push('move_objects requires numeric dx and dy deltas');
    }
  } else if (cmd.type === 'resize_object') {
    if (typeof cmd.id !== 'string' || !cmd.id.trim()) errors.push('resize_object requires a string id');
    if (!cmd.bounds || typeof cmd.bounds !== 'object') errors.push('resize_object requires a bounds object');
  } else if (cmd.type === 'set_text') {
    if (typeof cmd.id !== 'string' || !cmd.id.trim()) errors.push('set_text requires a string id');
    if (typeof cmd.text !== 'string') errors.push('set_text requires string text');
  } else if (cmd.type === 'configure_connector') {
    if (typeof cmd.id !== 'string' || !cmd.id.trim()) errors.push('configure_connector requires a string id');
  } else if (cmd.type === 'reconnect_connector') {
    if (typeof cmd.id !== 'string' || !cmd.id.trim()) errors.push('reconnect_connector requires a string id');
    if (cmd.endpoint !== 'from' && cmd.endpoint !== 'to') errors.push('reconnect_connector endpoint must be "from" or "to"');
    if (!cmd.target || typeof cmd.target !== 'object') errors.push('reconnect_connector requires a target object');
    else if (!cmd.target.id && !cmd.target.point) errors.push('reconnect_connector target must specify an id or point');
    if (cmd.target?.anchor && (typeof cmd.target.anchor.x !== 'number' || typeof cmd.target.anchor.y !== 'number')) {
      errors.push('reconnect_connector target.anchor must have numeric x and y');
    }
  } else if (cmd.type === 'set_board_theme') {
    if (!cmd.theme && !cmd.themeId) errors.push('set_board_theme requires theme or themeId');
  } else if (cmd.type === 'update_path_points') {
    if (!cmd.id) errors.push('update_path_points requires an id');
    if (!Array.isArray(cmd.points)) errors.push('update_path_points requires an array of points');
  } else if (cmd.type === 'batch') {
    if (!Array.isArray(cmd.commands)) {
      errors.push('batch requires an array of commands');
    } else {
      for (let i = 0; i < cmd.commands.length; i++) {
        const sub = validateCommand(cmd.commands[i]);
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
  const newDoc = cloneDocument(doc);

  switch (cmd.type) {
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

    case 'delete_objects': {
      const idsToDelete = (cmd.ids || []).filter(id => Boolean(newDoc.objects[id]));
      if (idsToDelete.length === 0) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }

      const savedObjects = [];
      for (const id of idsToDelete) {
        const index = newDoc.order.indexOf(id);
        savedObjects.push({
          object: cloneDocument(newDoc.objects[id]),
          orderIndex: index
        });
        delete newDoc.objects[id];
      }

      newDoc.order = newDoc.order.filter(id => !idsToDelete.includes(id));

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
      const ids = (cmd.ids || []).filter(id => Boolean(newDoc.objects[id]));
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
      if (!obj || obj.locked) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }

      const prevBounds = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
      const prevTextStyle = obj.textStyle ? cloneDocument(obj.textStyle) : null;

      obj.x = cmd.bounds.x !== undefined ? cmd.bounds.x : obj.x;
      obj.y = cmd.bounds.y !== undefined ? cmd.bounds.y : obj.y;
      obj.width = Math.max(MIN_OBJECT_SIZE, cmd.bounds.width !== undefined ? cmd.bounds.width : obj.width);
      obj.height = Math.max(MIN_OBJECT_SIZE, cmd.bounds.height !== undefined ? cmd.bounds.height : obj.height);

      if (cmd.restoreTextStyle) {
        obj.textStyle = cloneDocument(cmd.restoreTextStyle);
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
        if (!obj) continue;
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
      return { doc: newDoc, inverseCmd: { type: 'restore_positions', positions: prev } };
    }

    case 'set_text': {
      const obj = newDoc.objects[cmd.id];
      if (!obj || obj.locked) {
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
      const ids = (cmd.ids || []).filter(id => newDoc.objects[id] && !newDoc.objects[id].locked);
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
          endArrow: obj.endArrow
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

        // If stroke is changed and textStyle color matches previous stroke, update text color
        if (cmd.updates.stroke !== undefined && obj.textStyle && obj.textStyle.color === prevStyles[id].stroke) {
          obj.textStyle.color = cmd.updates.stroke;
        }
      }

      const inverseCmd = {
        type: 'restore_styles',
        styles: prevStyles
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'restore_styles': {
      const styles = cmd.styles || {};
      const prevStyles = {};
      for (const [id, style] of Object.entries(styles)) {
        const obj = newDoc.objects[id];
        if (!obj) continue;
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
          endArrow: obj.endArrow
        };
        Object.assign(obj, style);
      }
      return { doc: newDoc, inverseCmd: { type: 'restore_styles', styles: prevStyles } };
    }

    case 'set_typography': {
      const ids = (cmd.ids || []).filter(id => newDoc.objects[id] && !newDoc.objects[id].locked);
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
        if (!obj) continue;
        prev[id] = cloneDocument(obj.textStyle);
        obj.textStyle = cloneDocument(style);
      }
      return { doc: newDoc, inverseCmd: { type: 'restore_typography', typography: prev } };
    }

    case 'change_shape': {
      const obj = newDoc.objects[cmd.id];
      if (!obj || obj.locked) {
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
      const ids = (cmd.ids || []).filter(id => Boolean(newDoc.objects[id]));
      const locked = Boolean(cmd.locked);
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
      const ids = (cmd.ids || []).filter(id => newDoc.objects[id]);
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

      const inverseCmd = {
        type: 'restore_order',
        order: prevOrder
      };
      return { doc: newDoc, inverseCmd };
    }

    case 'restore_order': {
      const prevOrder = [...newDoc.order];
      newDoc.order = [...cmd.order];
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
      for (const [id, gId] of Object.entries(cmd.groupIds || {})) {
        if (newDoc.objects[id]) newDoc.objects[id].groupId = gId;
      }
      if (cmd.removeGroup) {
        delete newDoc.groups[cmd.removeGroup];
      }
      return { doc: newDoc, inverseCmd: { type: 'noop' } };
    }

    case 'restore_ungroup': {
      for (const [gId, gData] of Object.entries(cmd.groups || {})) {
        newDoc.groups[gId] = gData;
      }
      for (const [id, gId] of Object.entries(cmd.members || {})) {
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
      if (!conn || conn.type !== 'connector' || conn.locked) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
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
      if (!conn || conn.type !== 'connector' || conn.locked) {
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
      if (!conn || conn.type !== 'connector') {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
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
      if (!obj || obj.type !== 'path' || obj.locked) {
        return { doc: newDoc, inverseCmd: { type: 'noop' } };
      }
      const prevPoints = cloneDocument(obj.points);
      const prevBounds = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
      obj.points = cloneDocument(cmd.points);
      if (cmd.bounds) {
        obj.x = cmd.bounds.x;
        obj.y = cmd.bounds.y;
        obj.width = cmd.bounds.width;
        obj.height = cmd.bounds.height;
      }
      return {
        doc: newDoc,
        inverseCmd: {
          type: 'update_path_points',
          id: cmd.id,
          points: prevPoints,
          bounds: prevBounds
        }
      };
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
      const commands = cmd.commands || [];
      const inverseList = [];
      let currentDoc = newDoc;
      for (const subCmd of commands) {
        const result = applyCommand(currentDoc, subCmd);
        currentDoc = result.doc;
        if (result.inverseCmd && result.inverseCmd.type !== 'noop') {
          inverseList.push(result.inverseCmd);
        }
      }
      inverseList.reverse();
      const inverseCmd = {
        type: 'batch',
        commands: inverseList
      };
      return { doc: currentDoc, inverseCmd };
    }

    case 'noop':
      return { doc: newDoc, inverseCmd: { type: 'noop' } };

    default:
      throw new Error(`Unsupported command type: "${cmd.type}". Supported command types are: ${Array.from(SUPPORTED_COMMAND_TYPES).join(', ')}`);
  }
}

/**
 * Applies a batch of commands sequentially and atomically.
 * Validates all commands first and rolls back completely on any error.
 * @param {Object} doc 
 * @param {Array<Object>} commands 
 * @returns {{ doc: Object, inverseBatch: Object }}
 */
export function applyCommandBatch(doc, commands) {
  if (!Array.isArray(commands)) {
    throw new Error('Commands must be an array');
  }

  // Validate all commands upfront
  for (let i = 0; i < commands.length; i++) {
    const val = validateCommand(commands[i]);
    if (!val.valid) {
      throw new Error(`Validation failed for command [${i}] (${commands[i]?.type || 'unknown'}): ${val.errors.join(', ')}`);
    }
  }

  const initialClone = cloneDocument(doc);
  const inverseList = [];
  let currentDoc = initialClone;

  for (let i = 0; i < commands.length; i++) {
    try {
      const result = applyCommand(currentDoc, commands[i]);
      currentDoc = result.doc;
      if (result.inverseCmd && result.inverseCmd.type !== 'noop') {
        inverseList.push(result.inverseCmd);
      }
    } catch (err) {
      // Abort without mutation
      throw new Error(`Batch execution failed at command [${i}] (${commands[i]?.type || 'unknown'}): ${err.message}`);
    }
  }

  inverseList.reverse();
  const inverseCmd = {
    type: 'batch',
    commands: inverseList
  };
  return { doc: currentDoc, inverseCmd };
}
