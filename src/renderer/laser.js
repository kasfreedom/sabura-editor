/**
 * Sabura Laser Pointer: Canvas-based temporary laser pointer with glowing fading trail for Presentation mode.
 */

export class LaserPointer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.points = [];
    this.active = false;
    this.animId = null;
    this.decayMs = 600;

    this.render = this.render.bind(this);
    this.onResize = this.onResize.bind(this);
  }

  onResize() {
    if (this.active) {
      this.resize();
    }
  }

  start() {
    this.active = true;
    this.points = [];
    this.resize();
    window.addEventListener('resize', this.onResize);
    this.render();
  }

  stop() {
    this.active = false;
    window.removeEventListener('resize', this.onResize);
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    if (this.ctx && this.canvas) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.points = [];
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  addPoint(clientX, clientY) {
    if (!this.active || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const now = performance.now();
    this.points.push({ x, y, time: now });
  }

  render() {
    if (!this.active) return;
    const now = performance.now();
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || window.innerWidth;
    const h = rect.height || window.innerHeight;

    ctx.clearRect(0, 0, w, h);

    // Filter out expired points
    this.points = this.points.filter(p => now - p.time < this.decayMs);

    if (this.points.length > 1) {
      for (let i = 1; i < this.points.length; i++) {
        const p1 = this.points[i - 1];
        const p2 = this.points[i];
        const age = now - p2.time;
        const progress = Math.max(0, 1 - age / this.decayMs);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = `rgba(255, 59, 48, ${progress * 0.7})`;
        ctx.lineWidth = 4 * progress;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Inner glowing core
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = `rgba(255, 255, 255, ${progress * 0.9})`;
        ctx.lineWidth = 1.5 * progress;
        ctx.stroke();
      }

      // Tip dot
      const tip = this.points[this.points.length - 1];
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 59, 48, 0.9)';
      ctx.shadowColor = '#ff3b30';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    this.animId = requestAnimationFrame(this.render);
  }
}
