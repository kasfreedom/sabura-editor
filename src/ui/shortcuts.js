/**
 * Sabura Keyboard Shortcuts Coordinator.
 */

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
    // Ignore shortcuts when user is typing in input or textarea
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      return;
    }

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const mod = isMac ? e.metaKey : e.ctrlKey;

    if (e.key === ' ' && !this.isSpacePressed) {
      this.isSpacePressed = true;
      this.handlers.onSpaceHold?.(true);
      return;
    }

    if (e.key.toLowerCase() === 'q' && !mod) {
      e.preventDefault();
      this.handlers.onTriggerWheel?.(this.lastPointerPos.x, this.lastPointerPos.y);
      return;
    }

    if (e.key.toLowerCase() === 'h' && !mod) {
      e.preventDefault();
      this.handlers.onSelectTool?.('hand');
      return;
    }

    if (e.key.toLowerCase() === 'v' && !mod) {
      e.preventDefault();
      this.handlers.onSelectTool?.('select');
      return;
    }

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        this.handlers.onRedo?.();
      } else {
        this.handlers.onUndo?.();
      }
      return;
    }

    if (mod && (e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      this.handlers.onRedo?.();
      return;
    }

    if ((e.key === 'Enter' || e.key === 'F2') && !mod) {
      e.preventDefault();
      this.handlers.onEditText?.();
      return;
    }

    if (e.key.toLowerCase() === 'd' && !mod) {
      this.handlers.onDHold?.(true);
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
