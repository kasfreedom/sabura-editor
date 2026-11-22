/**
 * Escapes a value for use in HTML/SVG text content or a double- or single-quoted
 * attribute. `null` and `undefined` become the empty string.
 */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
