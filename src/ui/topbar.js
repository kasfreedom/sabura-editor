/**
 * Sabura Top Bar: Board-level and file-level controls only.
 * Appearance, Interface theme, Grid, Present, Undo/Redo, Status, and Save Copy.
 */

import { THEME_PRESETS } from '../core/types.js';

export class TopBar {
  constructor(containerElement, callbacks) {
    this.container = containerElement;
    this.callbacks = callbacks;
    // callbacks: { onSetBoardTheme, onSetInterfaceTheme, onToggleGrid, onPresent, onUndo, onRedo, onSaveCopy }

    this.barEl = document.createElement('header');
    this.barEl.className = 'sabura-topbar';
    this.container.appendChild(this.barEl);

    this.render();
  }

  update(doc, status = 'Saved', interfaceTheme = 'system', snapGrid = true, showGrid = true) {
    this.doc = doc;
    this.status = status;
    this.interfaceTheme = interfaceTheme;
    this.snapGrid = snapGrid;
    this.showGrid = showGrid;
    this.render();
  }

  render() {
    const docThemeId = this.doc?.theme?.id || 'paper';
    const ifaceTheme = this.interfaceTheme || 'system';
    const status = this.status || 'Clean';
    const snapGrid = Boolean(this.snapGrid);
    const showGrid = this.showGrid !== false;

    let statusColor = '#2f9e44'; // Clean green
    if (status === 'Changed') statusColor = '#f08c00'; // Amber
    else if (status === 'Error') statusColor = '#e03131'; // Red
    else if (status.includes('copy') || status.includes('Copy')) statusColor = '#1971c2'; // Blue

    this.barEl.innerHTML = `
      <div class="topbar-left">
        <div class="brand-title">
          <span class="brand-name">Sabura</span>
          <span class="doc-title" title="Board Title">${this.doc?.title || 'Untitled'}</span>
        </div>
        <div class="status-badge" title="Document State: ${status}">
          <span class="status-dot" style="background-color: ${statusColor};"></span>
          <span class="status-text">${status}</span>
        </div>
      </div>

      <div class="topbar-center">
        <!-- Board Theme -->
        <label class="control-label" title="Board Theme (persisted with document)">
          <span>Board:</span>
          <select id="select-board-theme" class="topbar-select">
            <option value="paper" ${docThemeId === 'paper' ? 'selected' : ''}>Paper</option>
            <option value="blueprint" ${docThemeId === 'blueprint' ? 'selected' : ''}>Blueprint</option>
            <option value="night" ${docThemeId === 'night' ? 'selected' : ''}>Night</option>
            <option value="high-contrast" ${docThemeId === 'high-contrast' ? 'selected' : ''}>High Contrast</option>
          </select>
        </label>

        <!-- Interface Appearance -->
        <label class="control-label" title="Interface Appearance (local preference, never dirties board)">
          <span>UI:</span>
          <select id="select-ui-theme" class="topbar-select">
            <option value="system" ${ifaceTheme === 'system' ? 'selected' : ''}>System</option>
            <option value="light" ${ifaceTheme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${ifaceTheme === 'dark' ? 'selected' : ''}>Dark</option>
          </select>
        </label>

        <!-- Grid visibility and snapping (explicit controls) -->
        <div class="grid-controls-group">
          <button id="btn-grid-visible" class="topbar-btn ${showGrid ? 'active' : ''}" title="Toggle Grid Visibility (Currently ${showGrid ? 'On' : 'Off'})">
            Grid ${showGrid ? 'On' : 'Off'}
          </button>
          <button id="btn-grid-snap" class="topbar-btn ${snapGrid ? 'active' : ''}" title="Toggle Object & Grid Snapping (Currently ${snapGrid ? 'On' : 'Off'})">
            Snap ${snapGrid ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      <div class="topbar-right">
        <!-- Undo / Redo -->
        <button id="btn-undo" class="topbar-btn" title="Undo (Cmd+Z)">↶</button>
        <button id="btn-redo" class="topbar-btn" title="Redo (Cmd+Shift+Z)">↷</button>

        <div class="topbar-divider"></div>

        <!-- Fullscreen Editing -->
        <button id="btn-fullscreen" class="topbar-btn" title="Toggle Full-Screen Editing (retraining controls)">
          ⛶ Fullscreen
        </button>

        <!-- Present -->
        <button id="btn-present" class="topbar-btn primary" title="Enter Presentation Mode (Laser pointer)">
          ▶ Present
        </button>

        <!-- Save Copy -->
        <button id="btn-save" class="topbar-btn save-btn" title="Download self-contained offline HTML copy">
          ↓ Save Copy
        </button>
      </div>
    `;

    // Event listeners
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
