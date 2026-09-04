/**
 * Sabura Top Bar: Board-level and file-level controls.
 * Supports distinct Reading mode (clean reading chrome) and Editing mode.
 */

import { THEME_PRESETS } from '../core/types.js';

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

    let statusColor = '#2f9e44'; // Clean green
    if (status === 'Changed') statusColor = '#f08c00'; // Amber
    else if (status === 'Error') statusColor = '#e03131'; // Red
    else if (status.includes('copy') || status.includes('Copy')) statusColor = '#1971c2'; // Blue

    this.barEl.className = `sabura-topbar ${isReading ? 'mode-reading' : 'mode-editing'}`;

    if (isReading) {
      // Clean reading header: Title, reading badge, status, and essential actions.
      this.barEl.innerHTML = `
        <div class="topbar-left">
          <div class="brand-title">
            <span class="brand-name">Sabura</span>
            <span class="doc-title" title="Board Title">${safeTitle}</span>
          </div>
          <span class="mode-badge" title="Mode: Reading">Reading</span>
          <div class="status-badge" title="Document State: ${escapeXml(status)}">
            <span class="status-dot" style="background-color: ${statusColor};"></span>
            <span class="status-text">${escapeXml(status)}</span>
          </div>
        </div>

        <div class="topbar-center"></div>

        <div class="topbar-right">
          <!-- Edit action -->
          <button id="btn-edit" class="topbar-btn primary" title="Enter Editing Mode">
            ✎ Edit
          </button>

          <!-- Browser fullscreen, without changing Reading mode -->
          <button id="btn-reading-fullscreen" class="topbar-btn" title="Toggle Fullscreen Reading" aria-label="Toggle Fullscreen Reading">
            ⛶ <span class="reading-fullscreen-label">Fullscreen</span>
          </button>

          <!-- Present -->
          <button id="btn-present" class="topbar-btn" title="Enter Presentation Mode (Laser pointer)">
            ▶ Present
          </button>

          <!-- Save Copy -->
          <button id="btn-save" class="topbar-btn save-btn" title="Download self-contained offline HTML copy">
            ↓ Save Copy
          </button>
        </div>
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
          <span class="brand-name">Sabura</span>
          <span class="doc-title" title="Board Title">${safeTitle}</span>
        </div>
        <!-- Return to reading mode -->
        <button id="btn-view" class="topbar-btn" title="Return to Reading Mode">
          👁 View
        </button>
        <div class="status-badge" title="Document State: ${escapeXml(status)}">
          <span class="status-dot" style="background-color: ${statusColor};"></span>
          <span class="status-text">${escapeXml(status)}</span>
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

        <!-- Grid visibility and snapping -->
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
        <div class="topbar-secondary-actions">
          <!-- Undo / Redo -->
          <button id="btn-undo" class="topbar-btn" title="Undo (Cmd+Z)">↶</button>
          <button id="btn-redo" class="topbar-btn" title="Redo (Cmd+Shift+Z)">↷</button>

          <div class="topbar-divider"></div>

          <!-- Fullscreen Editing -->
          <button id="btn-fullscreen" class="topbar-btn" title="Toggle Full-Screen Editing">
            ⛶ Fullscreen
          </button>
        </div>

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
