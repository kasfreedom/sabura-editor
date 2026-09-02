/**
 * Sabura Keyboard Shortcuts Coordinator.
 */

export function getPlatform() {
  if (typeof navigator === 'undefined') return { isMac: false, modKey: 'Ctrl', modSymbol: 'Ctrl' };
  const isMac = (navigator.platform || '').toUpperCase().indexOf('MAC') >= 0 ||
                (navigator.userAgent || '').toUpperCase().indexOf('MAC') >= 0;
  return {
    isMac,
    modKey: isMac ? 'Cmd' : 'Ctrl',
    modSymbol: isMac ? '⌘' : 'Ctrl'
  };
}

export class ShortcutsCoordinator {
  constructor(handlers) {
    this.handlers = handlers;
    this.isSpacePressed = false;
    this.lastPointerPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointermove', this.onPointerMove);
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointermove', this.onPointerMove);
  }

  onPointerMove(e) {
    this.lastPointerPos = { x: e.clientX, y: e.clientY };
  }

  onKeyDown(e) {
    // Check if user is typing in input, textarea, contenteditable, or in-place text editor
    const activeEl = document.activeElement;
    const isTyping = ['INPUT', 'TEXTAREA'].includes(activeEl?.tagName) ||
      Boolean(activeEl?.isContentEditable) ||
      Boolean(this.handlers.isTextEditing?.());

    if (isTyping) {
      // In text editing, Escape commits/cancels the text editor
      if (e.key === 'Escape') {
        this.handlers.onEscape?.();
      }
      return;
    }

    const { isMac } = getPlatform();
    const mod = isMac ? e.metaKey : e.ctrlKey;

    // Temporary Space-to-Pan
    if (e.key === ' ' && !this.isSpacePressed && !mod) {
      this.isSpacePressed = true;
      this.handlers.onSpaceHold?.(true);
      return;
    }

    // --- Tools & Navigation ---
    if (e.key.toLowerCase() === 'q' && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onTriggerWheel?.(this.lastPointerPos.x, this.lastPointerPos.y);
      return;
    }

    if (e.key.toLowerCase() === 'v' && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onSelectTool?.('select');
      return;
    }

    if (e.key.toLowerCase() === 'h' && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onSelectTool?.('hand');
      return;
    }

    if (e.key.toLowerCase() === 'r' && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onSelectTool?.('rectangle');
      return;
    }

    if (e.key.toLowerCase() === 'e' && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onSelectTool?.('ellipse');
      return;
    }

    if (e.key.toLowerCase() === 't' && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onSelectTool?.('text');
      return;
    }

    if (e.key.toLowerCase() === 'c' && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onSelectTool?.('connector');
      return;
    }

    if (e.key.toLowerCase() === 'p' && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onSelectTool?.('draw');
      return;
    }

    // --- View Shortcuts ---
    if ((e.key === '+' || e.key === '=') && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onZoomIn?.();
      return;
    }

    if ((e.key === '-' || e.key === '_') && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onZoomOut?.();
      return;
    }

    if (e.key === '0' && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onResetZoom?.();
      return;
    }

    if (e.key === '1' && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onFitContent?.();
      return;
    }

    if (e.key === '?' && !mod && !e.altKey) {
      e.preventDefault();
      this.handlers.onToggleHelp?.();
      return;
    }

    // --- Editing Shortcuts ---
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        this.handlers.onRedo?.();
      } else {
        this.handlers.onUndo?.();
      }
      return;
    }

    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.handlers.onRedo?.();
      return;
    }

    if ((e.key === 'Enter' || e.key === 'F2') && !mod) {
      e.preventDefault();
      this.handlers.onEditText?.();
      return;
    }

    if (e.key.toLowerCase() === 'd' && !mod && !e.altKey) {
      this.handlers.onDHold?.(true);
    }

    if (e.key.toLowerCase() === 'f' && !mod && !e.altKey) {
      this.handlers.onFlipCurve?.();
      return;
    }

    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      this.handlers.onCopy?.();
      return;
    }

    if (mod && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      this.handlers.onCut?.();
      return;
    }

    if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      this.handlers.onPaste?.();
      return;
    }

    if (mod && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      if (e.shiftKey) {
        this.handlers.onUngroup?.();
      } else {
        this.handlers.onGroup?.();
      }
      return;
    }

    if (mod && (e.key === ']' || e.key === '}')) {
      e.preventDefault();
      if (e.shiftKey || e.altKey) {
        this.handlers.onBringToFront?.();
      } else {
        this.handlers.onBringForward?.();
      }
      return;
    }

    if (mod && (e.key === '[' || e.key === '{')) {
      e.preventDefault();
      if (e.shiftKey || e.altKey) {
        this.handlers.onSendToBack?.();
      } else {
        this.handlers.onSendBackward?.();
      }
      return;
    }

    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.handlers.onDuplicate?.();
      return;
    }

    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.handlers.onSelectAll?.();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.handlers.onDelete?.();
      return;
    }

    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      if (e.key === 'ArrowRight') dx = step;
      if (e.key === 'ArrowUp') dy = -step;
      if (e.key === 'ArrowDown') dy = step;
      this.handlers.onNudge?.(dx, dy);
      return;
    }

    if (e.key === 'Escape') {
      this.handlers.onEscape?.();
      return;
    }
  }

  onKeyUp(e) {
    if (e.key === ' ' && this.isSpacePressed) {
      this.isSpacePressed = false;
      this.handlers.onSpaceHold?.(false);
    }

    if (e.key.toLowerCase() === 'd') {
      this.handlers.onDHold?.(false);
    }
  }
}
