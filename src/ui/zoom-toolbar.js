import { renderSaburaIcon } from './wheel-icon-map.js';

/**
 * Sabura Compact Zoom and Help Toolbar.
 *
 * Positioned in the bottom-left corner with sketch-inspired styling.
 * Contains: Zoom Out, Current Zoom Percentage, Zoom In, Fit, Help icon.
 */

export class ZoomToolbar {
  constructor(parentEl, handlers) {
    this.parentEl = parentEl;
    this.handlers = handlers || {};
    this.zoom = 1.0;

    this.toolbarEl = document.createElement('div');
    this.toolbarEl.className = 'zoom-help-toolbar';
    this.toolbarEl.id = 'zoom-help-toolbar';
    this.parentEl.appendChild(this.toolbarEl);

    this.render();
  }

  setZoom(zoom) {
    if (typeof zoom === 'number' && !isNaN(zoom)) {
      this.zoom = zoom;
      const pctEl = this.toolbarEl.querySelector('#btn-zoom-reset');
      if (pctEl) {
        pctEl.textContent = `${Math.round(this.zoom * 100)}%`;
      }
    }
  }

  render() {
    const pct = `${Math.round(this.zoom * 100)}%`;
    this.toolbarEl.innerHTML = `
      <button class="zoom-btn" id="btn-zoom-out" title="Zoom Out (-)" aria-label="Zoom Out">${renderSaburaIcon('zoom-out')}</button>
      <button class="zoom-btn zoom-percent" id="btn-zoom-reset" title="Reset Zoom to 100% (0)" aria-label="Reset Zoom to 100%">${pct}</button>
      <button class="zoom-btn" id="btn-zoom-in" title="Zoom In (+)" aria-label="Zoom In">${renderSaburaIcon('zoom-in')}</button>
      <button class="zoom-btn zoom-fit" id="btn-zoom-fit" title="Fit All Content (1)" aria-label="Fit to Content">${renderSaburaIcon('fit')}</button>
      <button class="zoom-btn zoom-help" id="btn-help-toggle" title="Help & Shortcuts (?)" aria-label="Help and Shortcuts">${renderSaburaIcon('help')}</button>
    `;

    this.toolbarEl.querySelector('#btn-zoom-out').addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onZoomOut?.();
    });

    this.toolbarEl.querySelector('#btn-zoom-reset').addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onResetZoom?.();
    });

    this.toolbarEl.querySelector('#btn-zoom-in').addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onZoomIn?.();
    });

    this.toolbarEl.querySelector('#btn-zoom-fit').addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onFit?.();
    });

    this.toolbarEl.querySelector('#btn-help-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onOpenHelp?.();
    });
  }

  destroy() {
    if (this.toolbarEl && this.toolbarEl.parentNode) {
      this.toolbarEl.parentNode.removeChild(this.toolbarEl);
    }
  }
}
