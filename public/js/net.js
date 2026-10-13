// WebSocket connection to the game server with a tiny event emitter.

export class Net {
  constructor() {
    this.handlers = new Map();
    this.id = null;
    this.open = false;
    this.queue = [];
    this.rtt = 60;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws.onopen = () => {
      this.open = true;
      for (const m of this.queue) this.ws.send(m);
      this.queue = [];
      this.emit('open');
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    };
    this.ws.onclose = () => {
      this.open = false;
      clearInterval(this.pingTimer);
      this.emit('close');
    };
    this.ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') this.id = m.id;
      if (m.t === 'pong') this.rtt = this.rtt * 0.7 + (performance.now() - m.c) * 0.3;
      this.emit(m.t, m);
      this.emit('*', m);
    };
  }

  send(msg) {
    const s = JSON.stringify(msg);
    if (this.open) this.ws.send(s);
    else this.queue.push(s);
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }

  emit(type, data) {
    const hs = this.handlers.get(type);
    if (hs) for (const fn of [...hs]) fn(data);
  }
}
