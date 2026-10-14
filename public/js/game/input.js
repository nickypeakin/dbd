// Keyboard/mouse input with pointer lock.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.buttons = new Set();
    this.events = [];
    this.mx = 0;
    this.my = 0;
    this.locked = false;
    this.handlers = [];
    const on = (t, ev, fn, opt) => { t.addEventListener(ev, fn, opt); this.handlers.push([t, ev, fn, opt]); };
    on(window, 'keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.events.push({ type: 'down', code: e.code });
    });
    on(window, 'keyup', (e) => {
      this.keys.delete(e.code);
      this.events.push({ type: 'up', code: e.code });
    });
    on(window, 'blur', () => {
      for (const k of this.keys) this.events.push({ type: 'up', code: k });
      for (const b of this.buttons) this.events.push({ type: 'up', code: 'Mouse' + b });
      this.keys.clear();
      this.buttons.clear();
    });
    on(canvas, 'mousedown', (e) => {
      if (!this.locked) { this.requestLock(); return; }
      this.buttons.add(e.button);
      this.events.push({ type: 'down', code: 'Mouse' + e.button });
    });
    on(window, 'mouseup', (e) => {
      if (!this.buttons.has(e.button)) return;
      this.buttons.delete(e.button);
      this.events.push({ type: 'up', code: 'Mouse' + e.button });
    });
    on(window, 'mousemove', (e) => {
      if (!this.locked) return;
      this.mx += e.movementX || 0;
      this.my += e.movementY || 0;
    });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        for (const b of this.buttons) this.events.push({ type: 'up', code: 'Mouse' + b });
        this.buttons.clear();
        this.events.push({ type: 'unlock' });
      } else this.events.push({ type: 'lock' });
    });
  }

  requestLock() {
    // Browsers without raw mouse input reject the option, so retry plainly.
    const plain = () => {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch {}
    };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(plain);
    } catch {
      plain();
    }
  }

  takeMouse() {
    const d = [this.mx, this.my];
    this.mx = 0;
    this.my = 0;
    return d;
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  dispose() {
    for (const [t, ev, fn, opt] of this.handlers) t.removeEventListener(ev, fn, opt);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
