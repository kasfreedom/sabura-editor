/**
 * Shared color helpers for rendered and inline text.
 */

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
