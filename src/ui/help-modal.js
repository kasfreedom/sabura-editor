/**
 * Sabura Integrated Help & Shortcuts Modal.
 * 
 * Provides scannable, offline documentation for tools, editing, connectors,
 * view controls, and platform-specific keyboard shortcuts.
 */

import { getPlatform } from './shortcuts.js';

export class HelpModal {
  constructor(parentEl) {
    this.parentEl = parentEl;
    this.isOpen = false;
    this.modalEl = null;

    this.initDOM();
  }

  initDOM() {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'sabura-modal-backdrop';
    this.modalEl.id = 'help-modal';
    this.modalEl.setAttribute('role', 'dialog');
    this.modalEl.setAttribute('aria-modal', 'true');
    this.modalEl.setAttribute('aria-labelledby', 'help-title');
    this.modalEl.tabIndex = -1;

    // Close on outside backdrop click
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) {
        this.close();
      }
    });

    this.parentEl.appendChild(this.modalEl);
  }

  render() {
    const { modKey, modSymbol } = getPlatform();

    this.modalEl.innerHTML = `
      <div class="sabura-modal-dialog" role="document">
        <div class="help-header">
          <div class="help-title-group">
            <span class="help-logo">Sabura</span>
            <h2 id="help-title">Quick Guide & Shortcuts</h2>
          </div>
          <button class="help-close-btn" id="btn-close-help" title="Close Help (Escape)" aria-label="Close Help">✕</button>
        </div>

        <div class="help-body">
          <!-- Column 1: Tools & Editing -->
          <div class="help-column">
            <section class="help-section">
              <h3 class="help-section-title">Tools & Navigation</h3>
              <ul class="help-list">
                <li><span class="help-desc">Select</span> <kbd class="kbd-badge">V</kbd></li>
                <li><span class="help-desc">Hand / Pan</span> <kbd class="kbd-badge">H</kbd></li>
                <li><span class="help-desc">Temporary Pan</span> <kbd class="kbd-badge">Hold Space</kbd></li>
                <li><span class="help-desc">Rectangle</span> <kbd class="kbd-badge">R</kbd></li>
                <li><span class="help-desc">Ellipse</span> <kbd class="kbd-badge">E</kbd></li>
                <li><span class="help-desc">Text</span> <kbd class="kbd-badge">T</kbd></li>
                <li><span class="help-desc">Connector</span> <kbd class="kbd-badge">C</kbd></li>
                <li><span class="help-desc">Free Drawing</span> <kbd class="kbd-badge">P</kbd></li>
                <li><span class="help-desc">Contextual Wheel</span> <kbd class="kbd-badge">Q</kbd></li>
              </ul>
            </section>

            <section class="help-section">
              <h3 class="help-section-title">Editing & Modifiers</h3>
              <ul class="help-list">
                <li><span class="help-desc">Edit Text</span> <kbd class="kbd-badge">Enter</kbd> / <kbd class="kbd-badge">F2</kbd></li>
                <li><span class="help-desc">Delete</span> <kbd class="kbd-badge">Delete</kbd> / <kbd class="kbd-badge">Backspace</kbd></li>
                <li><span class="help-desc">Undo</span> <kbd class="kbd-badge">${modKey}+Z</kbd></li>
                <li><span class="help-desc">Redo</span> <kbd class="kbd-badge">${modKey}+Shift+Z</kbd></li>
                <li><span class="help-desc">Copy</span> <kbd class="kbd-badge">${modKey}+C</kbd></li>
                <li><span class="help-desc">Cut</span> <kbd class="kbd-badge">${modKey}+X</kbd></li>
                <li><span class="help-desc">Paste</span> <kbd class="kbd-badge">${modKey}+V</kbd></li>
                <li><span class="help-desc">Duplicate</span> <kbd class="kbd-badge">${modKey}+D</kbd></li>
                <li><span class="help-desc">Drag Duplicate</span> <kbd class="kbd-badge">Hold D</kbd> + drag</li>
                <li><span class="help-desc">Group / Ungroup</span> <kbd class="kbd-badge">${modKey}+G</kbd> / <kbd class="kbd-badge">Shift</kbd></li>
                <li><span class="help-desc">Arrange Front/Back</span> <kbd class="kbd-badge">${modKey}+]</kbd> / <kbd class="kbd-badge">[</kbd></li>
                <li><span class="help-desc">Select All</span> <kbd class="kbd-badge">${modKey}+A</kbd></li>
                <li><span class="help-desc">Nudge (10px)</span> <kbd class="kbd-badge">Arrows</kbd> (<kbd class="kbd-badge">Shift</kbd>)</li>
                <li><span class="help-desc">Proportional Resize</span> <kbd class="kbd-badge">Shift</kbd> + handle</li>
                <li><span class="help-desc">Centered Resize</span> <kbd class="kbd-badge">Alt / Option</kbd> + handle</li>
              </ul>
            </section>
          </div>

          <!-- Column 2: Connectors & View -->
          <div class="help-column">
            <section class="help-section">
              <h3 class="help-section-title">Connectors</h3>
              <ul class="help-list">
                <li><span class="help-desc">Attached Endpoints</span> Drag endpoint onto any shape</li>
                <li><span class="help-desc">Free Endpoints</span> Drag endpoint onto whitespace</li>
                <li><span class="help-desc">Movable Points</span> Drag handle along shape boundary</li>
                <li><span class="help-desc">Gentle Snapping</span> Snaps to side centers and corners</li>
                <li><span class="help-desc">Auto Reset</span> Wheel &rarr; Points &rarr; Auto All/From/To</li>
                <li><span class="help-desc">Routing & Arrows</span> Wheel &rarr; Route (Straight/Curved)</li>
                <li><span class="help-desc">Curved Depth</span> Drag arc handle to bend deeper</li>
                <li><span class="help-desc">Elbow Bypass</span> Drag middle handle to route around shapes</li>
                <li><span class="help-desc">Flip / Reset</span> Press <kbd class="kbd-badge">F</kbd> or Wheel &rarr; Route</li>
              </ul>
            </section>

            <section class="help-section">
              <h3 class="help-section-title">View & Controls</h3>
              <ul class="help-list">
                <li><span class="help-desc">Zoom In / Out</span> <kbd class="kbd-badge">+</kbd> / <kbd class="kbd-badge">−</kbd></li>
                <li><span class="help-desc">Pointer Zoom</span> <kbd class="kbd-badge">${modKey}+Wheel</kbd> / Pinch</li>
                <li><span class="help-desc">Reset 100%</span> <kbd class="kbd-badge">0</kbd> or click %</li>
                <li><span class="help-desc">Fit All Content</span> <kbd class="kbd-badge">1</kbd> or click Fit</li>
                <li><span class="help-desc">Toggle Help</span> <kbd class="kbd-badge">?</kbd></li>
                <li><span class="help-desc">Cancel / Dismiss</span> <kbd class="kbd-badge">Escape</kbd></li>
                <li><span class="help-desc">Grid & Snapping</span> Top bar controls</li>
                <li><span class="help-desc">Presentation</span> Laser pointer mode</li>
              </ul>
            </section>
          </div>
        </div>

        <div class="help-footer">
          <span class="help-hint">Tip: Press <kbd class="kbd-badge">Escape</kbd> or click anywhere outside to return to the board.</span>
        </div>
      </div>
    `;

    this.modalEl.querySelector('#btn-close-help').addEventListener('click', () => {
      this.close();
    });
  }

  open() {
    this.render();
    this.isOpen = true;
    this.modalEl.classList.add('visible');
    // Focus close button for accessibility
    setTimeout(() => {
      const closeBtn = this.modalEl.querySelector('#btn-close-help');
      if (closeBtn && typeof closeBtn.focus === 'function') closeBtn.focus();
    }, 20);
  }

  close() {
    this.isOpen = false;
    this.modalEl.classList.remove('visible');
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  destroy() {
    if (this.modalEl && this.modalEl.parentNode) {
      this.modalEl.parentNode.removeChild(this.modalEl);
    }
  }
}
