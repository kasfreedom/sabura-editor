/**
 * Per-viewer interface preferences kept in browser storage.
 *
 * Storage is optional. In a sandboxed iframe (MCP Apps hosts, embeds), a data:
 * URL, or with site data blocked, even reading `window.localStorage` throws a
 * SecurityError, so every access goes through a getter and a try/catch. A
 * failure only means the preference is not remembered; the editor keeps working.
 */

export const UI_THEME_KEY = 'sabura_ui_theme';
const UI_THEMES = new Set(['light', 'dark', 'system']);

/** The browser's localStorage, or a throw where it is blocked. */
export const browserStorage = () => globalThis.localStorage;

/**
 * @param {() => Storage|undefined} getStorage may throw where storage is blocked
 * @returns {'light'|'dark'|'system'} the saved theme, or 'system'
 */
export function readInterfaceTheme(getStorage = browserStorage) {
  try {
    const saved = getStorage()?.getItem(UI_THEME_KEY);
    return UI_THEMES.has(saved) ? saved : 'system';
  } catch (_) {
    return 'system';
  }
}

/**
 * @param {() => Storage|undefined} getStorage may throw where storage is blocked
 * @param {string} theme
 * @returns {boolean} whether the theme was saved
 */
export function writeInterfaceTheme(getStorage, theme) {
  try {
    const storage = getStorage();
    if (!storage) return false;
    storage.setItem(UI_THEME_KEY, theme);
    return true;
  } catch (_) {
    return false;
  }
}
