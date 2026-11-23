// Copied from src/core/color.js by scripts/build-plugin.js (sabura-app/sabura-editor, MIT). Do not edit.
/**
 * Shared color helpers for rendered and inline text.
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Bare keywords: `none`, `transparent`, `currentColor` and CSS named colors.
const KEYWORD_COLOR = /^[A-Za-z]{1,32}$/;
// Functional notation restricted to numeric arguments (digits, units, separators).
const FUNCTIONAL_COLOR = /^(?:rgba?|hsla?)\(\s*[0-9.+\-%\s,/]*(?:deg|turn|rad)?[0-9.+\-%\s,/]*\)$/;

/**
 * Returns true when `value` is a color string that is safe to place in SVG/HTML attributes
 * and CSS. Colors are document data, so this is a format allowlist rather than an escape:
 * anything that could close an attribute, start markup, or reference a URL is rejected.
 */
export function isSafeColor(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  return HEX_COLOR.test(value) || KEYWORD_COLOR.test(value) || FUNCTIONAL_COLOR.test(value);
}

function hexToLuminance(hex) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return 0.5;
  let value = hex.slice(1);
  if (value.length === 3) value = value.split('').map((part) => part + part).join('');
  const number = parseInt(value, 16);
  if (Number.isNaN(number)) return 0.5;
  const r = ((number >> 16) & 255) / 255;
  const g = ((number >> 8) & 255) / 255;
  const b = (number & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ensures text remains legible against the effective rendered background. */
export function resolveContrastColor(color, background, fallbackLight = '#ffffff', fallbackDark = '#1e1e1e') {
  if (!color || color === 'none') return color;
  const bgLum = hexToLuminance(background);
  const colorLum = hexToLuminance(color);
  if (bgLum < 0.25 && colorLum < 0.22) return fallbackLight;
  if (bgLum > 0.75 && colorLum > 0.78) return fallbackDark;
  return color;
}
