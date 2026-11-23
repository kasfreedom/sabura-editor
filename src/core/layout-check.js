/**
 * Layout warnings for a board: labels that don't fit inside their shape, and
 * labelled shapes or text that overlap. Pure and deterministic. It mirrors the renderer's text
 * wrapping (svg-renderer.js wrapText: ~0.55 em per character, 1.25 line
 * height) and is an estimate, not a pixel measurement: fonts differ between
 * machines. Warnings never block a board; they tell an agent what to resize.
 */

import { getBoundingBox } from './geometry.js';

const CHAR_WIDTH_EM = 0.55;
const LINE_HEIGHT_EM = 1.25;
const DEFAULT_FONT_SIZE = 20;
const OVERLAP_TOLERANCE = 4;
const LABELLED_SHAPES = new Set(['rectangle', 'ellipse', 'diamond', 'triangle']);
const SOLID_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'text', 'image']);

/**
 * The area a label can use inside a shape. Ellipses keep their inscribed
 * rectangle (1/sqrt 2 of each axis); diamonds and triangles about half.
 */
function labelArea(obj) {
  const w = obj.width || 0;
  const h = obj.height || 0;
  switch (obj.type) {
    case 'ellipse': return { width: w * 0.7, height: h * 0.7 };
    case 'diamond': return { width: w * 0.5, height: h * 0.5 };
    case 'triangle': return { width: w * 0.5, height: h * 0.5 };
    default: return { width: w - 16, height: h - 8 };
  }
}

function wrap(text, maxChars) {
  const lines = [];
  let longestWord = 0;
  for (const raw of String(text).split('\n')) {
    let current = '';
    for (const word of raw.split(' ')) {
      longestWord = Math.max(longestWord, word.length);
      if (!current) current = word;
      else if ((current + ' ' + word).length <= maxChars) current += ' ' + word;
      else { lines.push(current); current = word; }
    }
    lines.push(current);
  }
  return { lines, longestWord };
}

/** How the label of `obj` wraps inside its shape at its current size. */
function measureLabel(obj, fontSize) {
  const area = labelArea(obj);
  const maxChars = Math.max(1, Math.floor(area.width / (fontSize * CHAR_WIDTH_EM)));
  const { lines, longestWord } = wrap(obj.text, maxChars);
  return {
    lines: lines.length,
    wordsFit: longestWord <= maxChars,
    heightFits: lines.length * fontSize * LINE_HEIGHT_EM <= area.height,
  };
}

/**
 * A size that fits the label: widen until every word fits and it wraps to at
 * most 2 lines (up to 3x the width), then grow the height. Rounded to 10.
 */
function suggestedSize(obj, fontSize) {
  let width = obj.width;
  let height = obj.height;
  for (let step = 0; step < 40; step++) {
    const m = measureLabel({ ...obj, width, height }, fontSize);
    if (m.wordsFit && m.heightFits) break;
    if ((!m.wordsFit || m.lines > 2) && width < obj.width * 3) width *= 1.1;
    else height *= 1.1;
  }
  const round = (n) => Math.ceil(n / 10) * 10;
  return { width: round(width), height: round(height) };
}

function textWarnings(obj) {
  if (!LABELLED_SHAPES.has(obj.type) || !obj.text || !obj.text.trim()) return [];
  const fontSize = obj.textStyle?.resolvedSize || DEFAULT_FONT_SIZE;
  const m = measureLabel(obj, fontSize);
  if (m.wordsFit && m.heightFits) return [];
  const size = suggestedSize(obj, fontSize);
  return [{
    code: 'TEXT_OVERFLOW',
    ids: [obj.id],
    message: `"${obj.id}" (${obj.type} ${obj.width}x${obj.height}): its label needs ${m.lines} line(s) and does not fit. Make it about ${size.width}x${size.height}, shorten the label, or use a smaller text size.`,
  }];
}

function overlapWarnings(doc, objects) {
  // Only labelled objects: two boxes or captions on top of each other is a
  // collision, while drawings are built from unlabelled overlapping parts.
  const boxes = objects
    .filter((o) => SOLID_TYPES.has(o.type) && typeof o.text === 'string' && o.text.trim() !== '')
    .map((o) => ({ obj: o, box: getBoundingBox(o, doc) }))
    .filter((b) => b.box && b.box.width > 0 && b.box.height > 0);
  const contains = (a, b) => a.x <= b.x && a.y <= b.y && a.right >= b.right && a.bottom >= b.bottom;
  const warnings = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].box;
      const b = boxes[j].box;
      const overlapX = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (overlapX <= OVERLAP_TOLERANCE || overlapY <= OVERLAP_TOLERANCE) continue;
      // One shape placed inside another (a label on a panel, a badge) is deliberate.
      if (contains(a, b) || contains(b, a)) continue;
      const ids = [boxes[i].obj.id, boxes[j].obj.id];
      warnings.push({
        code: 'OVERLAP',
        ids,
        message: `"${ids[0]}" and "${ids[1]}" overlap by ${Math.round(overlapX)}x${Math.round(overlapY)}. Move one of them, or place one fully inside the other if that is intended.`,
      });
    }
  }
  return warnings;
}

/**
 * Returns layout warnings for `doc`, text problems first, in board order.
 * @returns {{ code: 'TEXT_OVERFLOW'|'OVERLAP', ids: string[], message: string }[]}
 */
export function checkLayout(doc) {
  const objects = (doc.order || Object.keys(doc.objects || {}))
    .map((id) => doc.objects?.[id])
    .filter(Boolean);
  return [...objects.flatMap(textWarnings), ...overlapWarnings(doc, objects)];
}
