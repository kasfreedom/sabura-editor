/**
 * Sabura Top Bar: Board-level and file-level controls.
 * Supports distinct Reading mode (clean reading chrome) and Editing mode.
 */

import { THEME_PRESETS } from '../core/types.js';
import { renderSaburaIcon } from './wheel-icon-map.js';

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class TopBar {
  constructor(containerElement, callbacks) {
    this.container = containerElement;
    this.callbacks = callbacks;
    // callbacks: { onSetBoardTheme, onSetInterfaceTheme, onToggleGridVisible, onToggleGridSnap, onToggleFullscreen, onPresent, onUndo, onRedo, onSaveCopy, onSetMode }

    this.mode = 'reading'; // 'reading' | 'editing'
    this.barEl = document.createElement('header');
    this.barEl.className = 'sabura-topbar';
    this.container.appendChild(this.barEl);

    this.render();
  }

  update(doc, status = 'Saved', interfaceTheme = 'system', snapGrid = true, showGrid = true, mode = 'reading') {
    this.doc = doc;
    this.status = status;
    this.interfaceTheme = interfaceTheme;
    this.snapGrid = snapGrid;
    this.showGrid = showGrid;
    this.mode = mode;
    this.render();
  }

  render() {
    const isReading = this.mode === 'reading';
    const docThemeId = this.doc?.theme?.id || 'paper';
    const ifaceTheme = this.interfaceTheme || 'system';
    const status = this.status || 'Clean';
    const snapGrid = Boolean(this.snapGrid);
    const showGrid = this.showGrid !== false;
    const safeTitle = escapeXml(this.doc?.title || 'Untitled');
    const safeAppIdentity = escapeXml(`Sabura — ${this.doc?.title || 'Untitled'}`);

    let statusColor = '#2f9e44'; // Clean green
    if (status === 'Changed') statusColor = '#f08c00'; // Amber
    else if (status === 'Error') statusColor = '#e03131'; // Red
    else if (status.includes('copy') || status.includes('Copy')) statusColor = '#1971c2'; // Blue

    this.barEl.className = `sabura-topbar ${isReading ? 'mode-reading' : 'mode-editing'}`;

    const statusRegion = `
        <div class="status-region status-badge" data-status="${escapeXml(status)}" role="status" aria-live="polite" title="Document State: ${escapeXml(status)}">
          <span class="status-dot" style="background-color: ${statusColor};"></span>
          <span class="status-text">${escapeXml(status)}</span>
        </div>`;

    if (isReading) {
      // Clean reading header: Title, reading badge, status, and essential actions.
      this.barEl.innerHTML = `
        <div class="topbar-left">
          <div class="brand-title">
            <svg class="sabura-vs-app-mark" viewBox="0 0 1024 1024" role="img" aria-label="${safeAppIdentity}" title="${safeAppIdentity}" focusable="false"><use href="#sabura-vs-app-icon"></use></svg>
            <span class="brand-name">Sabura</span>
            <span class="doc-title" title="Board Title">${safeTitle}</span>
          </div>
          <span class="mode-badge" title="Mode: Reading">Reading</span>
        </div>

        <div class="topbar-center"></div>

        <div class="topbar-right">
          <!-- Edit action -->
          <button id="btn-edit" class="topbar-btn primary" title="Enter Editing Mode" aria-label="Enter Editing Mode">
            ${renderSaburaIcon('edit')}<span class="topbar-btn-label">Edit</span>
          </button>

          <!-- Browser fullscreen, without changing Reading mode -->
          <button id="btn-reading-fullscreen" class="topbar-btn" title="Toggle Fullscreen Reading" aria-label="Toggle Fullscreen Reading">
            ${renderSaburaIcon('fullscreen')}<span class="topbar-btn-label reading-fullscreen-label">Fullscreen</span>
          </button>

          <!-- Present -->
          <button id="btn-present" class="topbar-btn" title="Enter Presentation Mode (Laser pointer)" aria-label="Enter Presentation Mode">
            ${renderSaburaIcon('present')}<span class="topbar-btn-label">Present</span>
          </button>

          <!-- Save Copy -->
          <button id="btn-save" class="topbar-btn save-btn" title="Download self-contained offline HTML copy" aria-label="Save Copy">
            ${renderSaburaIcon('save-copy')}<span class="topbar-btn-label">Save Copy</span>
          </button>
        </div>
        ${statusRegion}
      `;

      this.barEl.querySelector('#btn-edit')?.addEventListener('click', () => {
        this.callbacks.onSetMode?.('editing');
      });

      this.barEl.querySelector('#btn-reading-fullscreen')?.addEventListener('click', () => {
        this.callbacks.onToggleFullscreen?.();
      });

      this.barEl.querySelector('#btn-present')?.addEventListener('click', () => {
        this.callbacks.onPresent?.();
      });

      this.barEl.querySelector('#btn-save')?.addEventListener('click', () => {
        this.callbacks.onSaveCopy?.();
      });
      return;
    }

    // Editing mode header
    this.barEl.innerHTML = `
      <div class="topbar-left">
        <div class="brand-title">
          <svg class="sabura-vs-app-mark" viewBox="0 0 1024 1024" role="img" aria-label="${safeAppIdentity}" title="${safeAppIdentity}" focusable="false"><use href="#sabura-vs-app-icon"></use></svg>
          <span class="brand-name">Sabura</span>
          <span class="doc-title" title="Board Title">${safeTitle}</span>
        </div>
        <!-- Return to reading mode -->
        <button id="btn-view" class="topbar-btn" title="Return to Reading Mode" aria-label="Return to Reading Mode">
          ${renderSaburaIcon('view')}<span class="topbar-btn-label">View</span>
        </button>
      </div>

      <div class="topbar-center">
        <!-- Board Theme -->
        <label class="control-label" title="Board Theme (persisted with document)">
          ${renderSaburaIcon('board')}<span class="control-prefix">Board:</span>
          <select id="select-board-theme" class="topbar-select" aria-label="Board Theme">
            <option value="paper" ${docThemeId === 'paper' ? 'selected' : ''}>Paper</option>
            <option value="blueprint" ${docThemeId === 'blueprint' ? 'selected' : ''}>Blueprint</option>
            <option value="night" ${docThemeId === 'night' ? 'selected' : ''}>Night</option>
            <option value="high-contrast" ${docThemeId === 'high-contrast' ? 'selected' : ''}>High Contrast</option>
          </select>
        </label>

        <!-- Interface Appearance -->
        <label class="control-label" title="Interface Appearance (local preference, never dirties board)">
          ${renderSaburaIcon('appearance')}<span class="control-prefix">UI:</span>
          <select id="select-ui-theme" class="topbar-select" aria-label="Interface Appearance">
            <option value="system" ${ifaceTheme === 'system' ? 'selected' : ''}>System</option>
            <option value="light" ${ifaceTheme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${ifaceTheme === 'dark' ? 'selected' : ''}>Dark</option>
          </select>
        </label>

        <!-- Grid visibility and snapping -->
        <div class="grid-controls-group">
          <button id="btn-grid-visible" class="topbar-btn ${showGrid ? 'active' : ''}" title="Toggle Grid Visibility (Currently ${showGrid ? 'On' : 'Off'})" aria-label="Grid ${showGrid ? 'On' : 'Off'}" aria-pressed="${showGrid}">
            ${renderSaburaIcon('grid')}<span class="topbar-btn-label">Grid ${showGrid ? 'On' : 'Off'}</span>
          </button>
          <button id="btn-grid-snap" class="topbar-btn ${snapGrid ? 'active' : ''}" title="Toggle Object & Grid Snapping (Currently ${snapGrid ? 'On' : 'Off'})" aria-label="Snap ${snapGrid ? 'On' : 'Off'}" aria-pressed="${snapGrid}">
            ${renderSaburaIcon('snap')}<span class="topbar-btn-label">Snap ${snapGrid ? 'On' : 'Off'}</span>
          </button>
        </div>
      </div>

      <div class="topbar-right">
        <div class="topbar-secondary-actions">
          <!-- Undo / Redo -->
          <button id="btn-undo" class="topbar-btn icon-only" title="Undo (Cmd+Z)" aria-label="Undo">${renderSaburaIcon('undo')}</button>
          <button id="btn-redo" class="topbar-btn icon-only" title="Redo (Cmd+Shift+Z)" aria-label="Redo">${renderSaburaIcon('redo')}</button>

          <div class="topbar-divider"></div>

          <!-- Fullscreen Editing -->
          <button id="btn-fullscreen" class="topbar-btn" title="Toggle Full-Screen Editing" aria-label="Toggle Full-Screen Editing">
            ${renderSaburaIcon('fullscreen')}<span class="topbar-btn-label">Fullscreen</span>
          </button>
        </div>

        <div class="topbar-primary-actions">
          <!-- Present -->
          <button id="btn-present" class="topbar-btn" title="Enter Presentation Mode (Laser pointer)" aria-label="Enter Presentation Mode">
            ${renderSaburaIcon('present')}<span class="topbar-btn-label">Present</span>
          </button>

          <!-- Save Copy -->
          <button id="btn-save" class="topbar-btn save-btn" title="Download self-contained offline HTML copy" aria-label="Save Copy">
            ${renderSaburaIcon('save-copy')}<span class="topbar-btn-label">Save Copy</span>
          </button>
        </div>
      </div>
      ${statusRegion}
    `;

    this.barEl.querySelector('#btn-view')?.addEventListener('click', () => {
      this.callbacks.onSetMode?.('reading');
    });

    this.barEl.querySelector('#select-board-theme')?.addEventListener('change', (e) => {
      this.callbacks.onSetBoardTheme(e.target.value);
    });

    this.barEl.querySelector('#select-ui-theme')?.addEventListener('change', (e) => {
      this.callbacks.onSetInterfaceTheme(e.target.value);
    });

    this.barEl.querySelector('#btn-grid-visible')?.addEventListener('click', () => {
      this.callbacks.onToggleGridVisible();
    });

    this.barEl.querySelector('#btn-grid-snap')?.addEventListener('click', () => {
      this.callbacks.onToggleGridSnap();
    });

    this.barEl.querySelector('#btn-undo')?.addEventListener('click', () => {
      this.callbacks.onUndo();
    });

    this.barEl.querySelector('#btn-redo')?.addEventListener('click', () => {
      this.callbacks.onRedo();
    });

    this.barEl.querySelector('#btn-fullscreen')?.addEventListener('click', () => {
      this.callbacks.onToggleFullscreen();
    });

    this.barEl.querySelector('#btn-present')?.addEventListener('click', () => {
      this.callbacks.onPresent();
    });

    this.barEl.querySelector('#btn-save')?.addEventListener('click', () => {
      this.callbacks.onSaveCopy();
    });
  }
}
