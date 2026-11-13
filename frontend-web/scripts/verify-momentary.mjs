// Deterministic store regression: local fake REST, 10 ms scan and 100 ms WS.
// No PLC, backend, browser, extra dependency or wall-clock sleeps are used.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  root,
  configFile: false,
  logLevel: "silent",
  ssr: { noExternal: true },
  define: {
    "import.meta.env": JSON.stringify({ VITE_API_BASE: "http://fake.invalid" }),
  },
  build: {
    ssr: fileURLToPath(new URL("../src/store/usePlcStore.ts", import.meta.url)),
    write: false,
    minify: false,
  },
});
const code = bundle.output.find((item) => item.type === "chunk").code;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const originals = {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  now: Date.now,
  performanceNow: performance.now,
  fetch: globalThis.fetch,
  WebSocket: globalThis.WebSocket,
  window: globalThis.window,
  document: globalThis.document,
};
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

class Clock {
  now = 10000;
  serial = 0;
  tasks = new Map();
  schedule(callback, delay, interval = 0) {
    const id = ++this.serial;
    this.tasks.set(id, { callback, due: this.now + delay, interval });
    return id;
  }
  install() {
    globalThis.setTimeout = (fn, delay = 0) => this.schedule(fn, delay);
    globalThis.clearTimeout = (id) => this.tasks.delete(id);
    globalThis.setInterval = (fn, delay) => this.schedule(fn, delay, delay);
    globalThis.clearInterval = (id) => this.tasks.delete(id);
    Date.now = () => this.now;
    performance.now = () => this.now;
  }
  async advance(milliseconds) {
    const end = this.now + milliseconds;
    for (;;) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.due <= end)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      const [id, task] = next;
      this.now = task.due;
      this.tasks.delete(id);
      if (task.interval)
        this.tasks.set(id, { ...task, due: this.now + task.interval });
      task.callback();
      await settle();
    }
    this.now = end;
    await settle();
  }
}

let cases = 0;
async function check(name, run, options = {}) {
  const clock = new Clock();
  clock.install();
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false });
  globalThis.window = window;
  globalThis.document = document;
  const virtual = Array(32).fill(false);
  let inputs = Array(32).fill(false);
  const outputs = Array(32).fill(false);
  const writes = [];
  const samples = [];
  const sockets = [];
  let enabled = false;
  let virtualSource = false;
  let failTrue = options.failTrue ?? false;
  let store;
  globalThis.fetch = async (url, request = {}) => {
    const body = request.body && JSON.parse(request.body);
    if (String(url).endsWith("/input")) {
      virtual[body.index] = body.value;
      writes.push({ ...body, at: clock.now, keepalive: !!request.keepalive });
      if (body.index < 2 && body.value && failTrue) {
        failTrue = false;
        throw new Error("Uncertain true write");
      }
      if (body.index < 2 && body.value && options.ackDelay)
        await new Promise((resolve) => setTimeout(resolve, options.ackDelay));
    }
    if (String(url).endsWith("/command")) {
      enabled = body.enable;
      virtualSource = body.use_virtual_inputs;
    }
    return {
      ok: true,
      json: async () =>
        String(url).endsWith("/health")
          ? { status: "ok", plc_connected: false, simulation_mode: true }
          : { status: "ok" },
    };
  };
  globalThis.WebSocket = class {
    constructor() {
      sockets.push(this);
    }
    close() {
      this.closed = true;
      this.onclose?.();
    }
    snapshot() {
      if (this.closed) return;
      samples.push({ at: clock.now, inputs: [...inputs] });
      this.onmessage?.({
        data: JSON.stringify({
          plc_connected: false,
          active_instructions: 18,
          inputs: [...inputs],
          outputs: [...outputs],
          markers: Array(64).fill(false),
        }),
      });
    }
  };
  ({ usePlcStore: store } = await import(`${moduleUrl}#case-${cases++}`));
  const cleanup = store.getState().connect();
  const scan = setInterval(() => {
    inputs = virtualSource ? [...virtual] : Array(32).fill(false);
    // The filling preset's first rung plus its STOP/thermal interlocks.
    outputs[0] =
      enabled &&
      (inputs[0] || outputs[0]) &&
      !inputs[1] &&
      !inputs[2] &&
      !inputs[4];
  }, 10);
  const ws = setInterval(() => sockets.at(-1).snapshot(), 100);
  sockets[0].snapshot();
  await store.getState().command({ enable: true, use_virtual_inputs: true });
  await settle();
  try {
    await run({
      clock,
      store,
      virtual,
      outputs,
      writes,
      samples,
      sockets,
      window,
      document,
    });
    console.log(`PASS ${name}`);
  } finally {
    cleanup();
    clearInterval(scan);
    clearInterval(ws);
  }
}

try {
  for (const duration of [0, 1, 16, 80]) {
    await check(
      `normal click ${duration} ms is scanned and released`,
      async ({ clock, store, virtual, outputs, writes, samples, window }) => {
        store.getState().setInput(0, true);
        await settle();
        await clock.advance(duration);
        store.getState().setInput(0, false);
        // The global pointerup must preserve the same minimum as the component.
        window.dispatchEvent(new Event("pointerup"));
        await clock.advance(149 - duration);
        assert.equal(virtual[0], true);
        assert.ok(store.getState().inputPending.includes(0));
        await clock.advance(1);
        assert.equal(virtual[0], false);
        await clock.advance(60);
        assert.equal(outputs[0], true, "The PLC scan must latch P_101");
        assert.ok(samples.some((sample) => sample.inputs[0]));
        assert.equal(samples.at(-1).inputs[0], false);
        assert.deepEqual(
          writes
            .filter((write) => write.index === 0)
            .map((write) => write.value),
          [true, false],
        );
      },
    );
  }
  await check(
    "minimum starts at true ACK, not pointerdown",
    async ({ clock, store, virtual, writes }) => {
      store.getState().setInput(0, true);
      store.getState().setInput(0, false);
      await clock.advance(189);
      assert.equal(virtual[0], true);
      await clock.advance(1);
      assert.equal(virtual[0], false);
      assert.equal(
        writes.find((write) => write.index === 0 && !write.value).at,
        10190,
      );
    },
    { ackDelay: 40 },
  );
  await check(
    "long keyboard hold remains held until keyup",
    async ({ clock, store, virtual, writes }) => {
      // keydown/keyup call the same store API as pointerdown/pointerup.
      store.getState().setInput(0, true);
      await settle();
      await clock.advance(500);
      assert.equal(virtual[0], true);
      store.getState().setInput(0, false);
      await settle();
      assert.equal(virtual[0], false);
      assert.equal(
        writes.find((write) => write.index === 0 && !write.value).at,
        10500,
      );
    },
  );
  await check(
    "quick STOP is scanned and clears the filling latch",
    async ({ clock, store, outputs, virtual, samples }) => {
      store.getState().setInput(0, true);
      store.getState().setInput(0, false);
      await clock.advance(210);
      assert.equal(outputs[0], true);
      store.getState().setInput(1, true);
      store.getState().setInput(1, false);
      await clock.advance(210);
      assert.equal(outputs[0], false);
      assert.equal(virtual[1], false);
      assert.ok(samples.some((sample) => sample.inputs[1]));
      assert.equal(samples.at(-1).inputs[1], false);
    },
  );
  for (const event of [
    "pointercancel",
    "blur",
    "visibilitychange",
    "pagehide",
    "pointerleave",
  ]) {
    await check(
      `${event} cancels the minimum immediately`,
      async ({ clock, store, virtual, window, document, writes }) => {
        store.getState().setInput(0, true);
        await settle();
        store.getState().setInput(0, false);
        await clock.advance(20);
        if (event === "visibilitychange") {
          document.hidden = true;
          document.dispatchEvent(new Event(event));
        } else if (event === "pointerleave") {
          store.getState().setInput(0, false, { immediate: true });
        } else window.dispatchEvent(new Event(event));
        await settle();
        assert.equal(virtual[0], false);
        await clock.advance(200);
        assert.equal(virtual[0], false);
        assert.equal(
          writes.filter((write) => write.index === 0 && write.value).length,
          1,
        );
      },
    );
  }
  await check(
    "cancel before true ACK has no delayed pulse",
    async ({ clock, store, virtual }) => {
      store.getState().setInput(0, true);
      await clock.advance(20);
      store.getState().setInput(0, false, { immediate: true });
      await clock.advance(20);
      assert.equal(virtual[0], false);
      await clock.advance(200);
      assert.equal(virtual[0], false);
    },
    { ackDelay: 40 },
  );
  await check(
    "disconnect releases and stale timer cannot clear a new press",
    async ({ clock, store, virtual, sockets, writes }) => {
      store.getState().setInput(0, true);
      await settle();
      store.getState().setInput(0, false);
      await clock.advance(25);
      sockets[0].close();
      await settle();
      assert.equal(virtual[0], false);
      assert.equal(store.getState().engine, null);
      // Reconnect manually before the old 150 ms timer's former deadline.
      store.getState().reconnect();
      sockets.at(-1).snapshot();
      await store
        .getState()
        .command({ enable: true, use_virtual_inputs: true });
      store.getState().setInput(0, true);
      await settle();
      await clock.advance(125);
      assert.equal(virtual[0], true);
      await clock.advance(50);
      assert.equal(
        virtual[0],
        true,
        "Holding the new press must outlive its minimum",
      );
      store.getState().setInput(0, false);
      await settle();
      assert.equal(virtual[0], false);
      assert.equal(
        writes.filter((write) => write.index === 0 && write.value).length,
        2,
      );
    },
  );
  await check(
    "uncertain true failure releases instead of replaying the press",
    async ({ clock, store, virtual, writes }) => {
      store.getState().setInput(0, true);
      store.getState().setInput(0, false);
      await settle();
      assert.equal(virtual[0], false);
      await clock.advance(1200);
      assert.equal(virtual[0], false);
      assert.equal(
        writes.filter((write) => write.index === 0 && write.value).length,
        1,
      );
      assert.match(store.getState().error, /Uncertain true write/);
    },
    { failTrue: true },
  );
  console.log(
    `${cases} momentary regressions passed. No network or real PLC used.`,
  );
} finally {
  Object.assign(globalThis, {
    setTimeout: originals.setTimeout,
    clearTimeout: originals.clearTimeout,
    setInterval: originals.setInterval,
    clearInterval: originals.clearInterval,
    fetch: originals.fetch,
    WebSocket: originals.WebSocket,
    window: originals.window,
    document: originals.document,
  });
  Date.now = originals.now;
  performance.now = originals.performanceNow;
}
