/**
 * Sabura In-Place Text Editor: Floating textarea positioned over target object for inline text editing.
 */

import { FONT_FAMILIES } from '../core/types.js';
import { resolveContrastColor } from '../core/color.js';

export class TextEditor {
  constructor(containerElement, onCommit) {
    this.container = containerElement;
    this.onCommit = onCommit; // Callback (objectId, newText)
    this.targetObject = null;
    this.initialText = '';

    this.textarea = document.createElement('textarea');
    this.textarea.id = 'sabura-inline-text-editor';
    this.textarea.name = 'sabura-inline-text-editor';
    this.textarea.className = 'sabura-inline-text-editor';
    this.textarea.setAttribute('aria-label', 'Edit shape or canvas text');
    this.textarea.setAttribute('autocomplete', 'off');
    this.textarea.setAttribute('autocorrect', 'off');
    this.textarea.setAttribute('autocapitalize', 'off');
    this.textarea.setAttribute('spellcheck', 'false');
    this.textarea.style.display = 'none';
    this.container.appendChild(this.textarea);

    this.onBlur = this.onBlur.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);

    this.textarea.addEventListener('blur', this.onBlur);
    this.textarea.addEventListener('keydown', this.onKeyDown);
  }

  open(object, camera = { x: 0, y: 0, zoom: 1 }, theme = {}) {
    this.targetObject = object;
    this.initialText = object.text || '';

    const textStyle = object.textStyle || {};
    const fontSize = (textStyle.resolvedSize || 20) * camera.zoom;
    const fontFamily = FONT_FAMILIES[textStyle.fontFamily] || FONT_FAMILIES.sans;
    const fontWeight = textStyle.bold ? 'bold' : 'normal';
    const align = textStyle.align || (object.type === 'text' ? 'left' : 'center');
    const rawColor = textStyle.color || object.stroke || '#1e1e1e';
    const background = object.type === 'text' || !object.fill || object.fill === 'none'
      ? (theme.background || '#ffffff')
      : object.fill;
    const color = resolveContrastColor(rawColor, background, '#ffffff', '#1e1e1e');

    const rot = object.rotation || 0;
    const centerScreenX = (object.x + object.width / 2) * camera.zoom + camera.x;
    const centerScreenY = (object.y + object.height / 2) * camera.zoom + camera.y;

    const screenW = Math.max(120, object.width * camera.zoom);
    const screenH = Math.max(40, object.height * camera.zoom);
    const screenX = centerScreenX - screenW / 2;
    const screenY = centerScreenY - screenH / 2;

    this.textarea.style.display = 'block';
    this.textarea.style.left = `${screenX}px`;
    this.textarea.style.top = `${screenY}px`;
    this.textarea.style.width = `${screenW}px`;
    this.textarea.style.height = `${screenH}px`;
    this.textarea.style.transform = rot !== 0 ? `rotate(${rot}deg)` : 'none';
    this.textarea.style.transformOrigin = '50% 50%';
    this.textarea.style.fontSize = `${fontSize}px`;
    this.textarea.style.fontFamily = fontFamily;
    this.textarea.style.fontWeight = fontWeight;
    this.textarea.style.textAlign = align;
    this.textarea.style.color = color;
    this.textarea.style.backgroundColor = background;

    this.textarea.value = this.initialText;
    this.textarea.focus();
    this.textarea.select();
  }

  close(commit = true) {
    if (this.textarea.style.display === 'none') return;
    const newText = this.textarea.value;
    const objId = this.targetObject?.id;
    this.textarea.style.display = 'none';
    this.textarea.style.transform = 'none';

    if (commit && objId && newText !== this.initialText) {
      this.onCommit(objId, newText);
    }
    this.targetObject = null;
  }

  onBlur() {
    this.close(true);
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.close(false); // Cancel without saving
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || this.targetObject?.type !== 'text')) {
      // Cmd+Enter or Enter inside shapes commits
      e.preventDefault();
      this.close(true);
    }
  }
}
