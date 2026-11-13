import { create } from "zustand";
import { API_BASE, api, errorText, WS_URL } from "../lib/api";
import { copyProgram, PRESETS, validateProgram } from "../lib/ladder";
import type {
  Command,
  Health,
  LadderProgramPayload,
  Telemetry,
} from "../types";

type Connection = "connecting" | "live" | "reconnecting" | "offline";
interface Message {
  role: "operator" | "assistant";
  text: string;
}
interface PlcStore {
  program: LadderProgramPayload;
  deployedSignature: string | null;
  deployedName: string | null;
  telemetry: Telemetry | null;
  health: Health | null;
  connection: Connection;
  fresh: boolean;
  lastTelemetry: number | null;
  engine: boolean | null;
  virtualInputs: boolean | null;
  commandBusy: boolean;
  deploying: boolean;
  generating: boolean;
  error: string | null;
  notice: string | null;
  sensorError: string | null;
  sensorPending: boolean;
  level: number;
  chat: Message[];
  inputPending: number[];
  generatedDraft: LadderProgramPayload | null;
  setProgram: (program: LadderProgramPayload) => void;
  clearError: () => void;
  applyGenerated: () => void;
  connect: () => () => void;
  reconnect: () => void;
  deploy: () => Promise<void>;
  generate: (prompt: string) => Promise<void>;
  command: (patch: Partial<Command>) => Promise<void>;
  setInput: (index: number, value: boolean) => void;
  setLevel: (level: number) => void;
}
const EMPTY_PROGRAM = PRESETS[0]!.program;
const desired = new Map<
  number,
  {
    value: boolean;
    sent: boolean | undefined;
    busy: boolean;
    attempt: number;
    request: number;
  }
>();
let lifetime: AbortController | null = null;
let retryConnection: (() => void) | null = null;
let epoch = 0;

function validTelemetry(value: unknown): value is Telemetry {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Partial<Telemetry>;
  return (
    typeof t.plc_connected === "boolean" &&
    Number.isInteger(t.active_instructions) &&
    t.active_instructions! >= 0 &&
    t.active_instructions! <= 200 &&
    [
      [t.inputs, 32],
      [t.outputs, 32],
      [t.markers, 64],
    ].every(
      ([bits, length]) =>
        Array.isArray(bits) &&
        bits.length === length &&
        bits.every((bit) => typeof bit === "boolean"),
    )
  );
}
export function canAnimate(
  state: Pick<PlcStore, "fresh" | "engine" | "telemetry" | "health">,
) {
  return (
    state.fresh &&
    state.engine === true &&
    !!state.telemetry &&
    (state.telemetry.plc_connected || state.health?.simulation_mode === true)
  );
}

function updateSensorStatus() {
  const pending = [...desired.entries()].some(
    ([index, entry]) =>
      (index === 2 || index === 3) && entry.sent !== entry.value,
  );
  const inputPending = [...desired.entries()]
    .filter(
      ([index, entry]) =>
        index !== 2 &&
        index !== 3 &&
        (entry.busy || entry.sent !== entry.value),
    )
    .map(([index]) => index);
  const previous = usePlcStore.getState();
  if (
    previous.sensorPending !== pending ||
    previous.inputPending.join() !== inputPending.join()
  ) {
    usePlcStore.setState({ sensorPending: pending, inputPending });
  }
}
function queueInput(index: number, value: boolean) {
  const existing = desired.get(index);
  if (existing) existing.value = value;
  else
    desired.set(index, {
      value,
      sent: undefined,
      busy: false,
      attempt: 0,
      request: 0,
    });
  updateSensorStatus();
  flushInputs();
}
function syncSensors() {
  const { level } = usePlcStore.getState();
  queueInput(2, level >= 0.9);
  queueInput(3, level > 0.1);
}
function flushInputs() {
  const state = usePlcStore.getState();
  if (!state.fresh || !lifetime || lifetime.signal.aborted) return;
  for (const [index, entry] of desired) {
    const sensor = index === 2 || index === 3;
    if (sensor && state.virtualInputs !== true) continue;
    if (
      entry.busy ||
      entry.sent === entry.value ||
      Date.now() - entry.attempt < 1000
    )
      continue;
    const value = entry.value;
    const requestEpoch = epoch;
    const requestId = ++entry.request;
    entry.busy = true;
    entry.attempt = Date.now();
    void api("/api/plc/input", { index, value }, lifetime.signal)
      .then(() => {
        if (requestEpoch !== epoch) return;
        entry.sent = value;
        entry.attempt = 0;
        if (
          sensor &&
          [2, 3].every((sensorIndex) => {
            const item = desired.get(sensorIndex);
            return !!item && item.sent === item.value;
          })
        )
          usePlcStore.setState({ sensorError: null });
      })
      .catch((error: unknown) => {
        if (requestEpoch !== epoch || lifetime?.signal.aborted) return;
        if (sensor)
          usePlcStore.setState({
            sensorError: `Sensores HIL: ${errorText(error)}. Reintento automático.`,
          });
        else
          usePlcStore.setState({
            error: `Entrada I[${index}]: ${errorText(error)}. La liberación pendiente se reintentará.`,
          });
      })
      .finally(() => {
        if (requestId !== entry.request) return;
        entry.busy = false;
        updateSensorStatus();
        if (entry.sent !== entry.value && entry.sent === value) {
          entry.attempt = 0;
          flushInputs();
        }
      });
  }
}

export const usePlcStore = create<PlcStore>((set, get) => ({
  program: copyProgram(EMPTY_PROGRAM),
  deployedSignature: null,
  deployedName: null,
  telemetry: null,
  health: null,
  connection: "connecting",
  fresh: false,
  lastTelemetry: null,
  engine: null,
  virtualInputs: null,
  commandBusy: false,
  deploying: false,
  generating: false,
  error: null,
  notice: null,
  sensorError: null,
  sensorPending: true,
  level: 0.32,
  chat: [],
  inputPending: [],
  generatedDraft: null,
  setProgram: (program) => set({ program }),
  clearError: () => set({ error: null }),
  applyGenerated: () => {
    const program = get().generatedDraft;
    if (program)
      set({
        program: copyProgram(program),
        generatedDraft: null,
        notice:
          "Resultado de IA cargado al borrador. Revisa y pulsa Deploy para enviarlo.",
      });
  },
  setLevel: (level) => {
    set({ level: Math.max(0, Math.min(1, level)) });
    syncSensors();
  },
  setInput: queueInput,
  reconnect: () => retryConnection?.(),
  connect: () => {
    lifetime?.abort();
    const controller = new AbortController();
    lifetime = controller;
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let lastTick = performance.now();
    const invalidate = () => {
      epoch++;
      set({
        fresh: false,
        engine: null,
        virtualInputs: null,
        commandBusy: false,
      });
      for (const [index, entry] of desired) {
        entry.sent = undefined;
        entry.attempt = 0;
        entry.busy = false;
        entry.request++;
        if (index === 0 || index === 1) entry.value = false;
      }
    };
    const pollHealth = async () => {
      try {
        const health = await api<Health>(
          "/api/health",
          undefined,
          controller.signal,
          4000,
        );
        if (
          !disposed &&
          health.status === "ok" &&
          typeof health.simulation_mode === "boolean" &&
          typeof health.plc_connected === "boolean"
        )
          set({ health });
      } catch {
        if (!disposed) set({ health: null });
      }
    };
    const open = () => {
      if (disposed) return;
      clearTimeout(retryTimer);
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      }
      invalidate();
      set({ connection: attempts ? "reconnecting" : "connecting" });
      void pollHealth();
      const ws = new WebSocket(WS_URL);
      socket = ws;
      ws.onmessage = (event) => {
        if (disposed || socket !== ws) return;
        try {
          const payload: unknown = JSON.parse(String(event.data));
          if (!validTelemetry(payload))
            throw new Error(
              "Se esperaba telemetría con arrays I32 / Q32 / M64.",
            );
          attempts = 0;
          set({
            telemetry: payload,
            fresh: true,
            lastTelemetry: Date.now(),
            connection: "live",
          });
          flushInputs();
        } catch (error) {
          set({ error: `Telemetría inválida: ${errorText(error)}` });
          ws.close();
        }
      };
      ws.onerror = () => {
        if (!disposed && socket === ws) ws.close();
      };
      ws.onclose = () => {
        if (disposed || socket !== ws) return;
        invalidate();
        attempts++;
        set({ connection: attempts >= 3 ? "offline" : "reconnecting" });
        retryTimer = setTimeout(
          open,
          Math.min(8000, 1000 * 2 ** Math.min(attempts - 1, 3)),
        );
      };
    };
    retryConnection = open;
    open();
    const healthTimer = setInterval(() => void pollHealth(), 5000);
    const tick = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTick) / 1000);
      lastTick = now;
      const state = get();
      if (
        state.fresh &&
        state.lastTelemetry &&
        Date.now() - state.lastTelemetry > 1200
      ) {
        invalidate();
        set({ connection: "reconnecting" });
        socket?.close();
        return;
      }
      if (canAnimate(state)) {
        const outputs = state.telemetry!.outputs;
        const rate = (outputs[0] ? 0.045 : 0) - (outputs[3] ? 0.06 : 0);
        if (rate)
          set({ level: Math.max(0, Math.min(1, state.level + rate * dt)) });
      }
      if (state.fresh && state.virtualInputs === true) syncSensors();
      flushInputs();
    }, 50);
    const release = () => {
      for (const index of [0, 1])
        if (desired.has(index)) queueInput(index, false);
    };
    const releaseFinal = () => {
      for (const index of [0, 1]) {
        if (!desired.has(index)) continue;
        queueInput(index, false);
        void fetch(`${API_BASE}/api/plc/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index, value: false }),
          keepalive: true,
        }).catch(() => undefined);
      }
    };
    const visibility = () => {
      if (document.hidden) release();
    };
    window.addEventListener("blur", release);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("pagehide", releaseFinal);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      releaseFinal();
      disposed = true;
      retryConnection = null;
      clearInterval(healthTimer);
      clearInterval(tick);
      clearTimeout(retryTimer);
      controller.abort();
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      }
      window.removeEventListener("blur", release);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("pagehide", releaseFinal);
      document.removeEventListener("visibilitychange", visibility);
      invalidate();
    };
  },
  command: async (patch) => {
    if (get().commandBusy || !get().fresh) return;
    const command: Command = {
      enable: get().engine === true,
      reset: false,
      use_virtual_inputs: get().virtualInputs === true,
      ...patch,
    };
    const requestEpoch = epoch;
    set({ commandBusy: true, error: null });
    try {
      await api("/api/plc/command", command, lifetime?.signal);
      if (requestEpoch !== epoch) return;
      set({
        engine: command.enable,
        virtualInputs: command.use_virtual_inputs,
        notice: command.reset
          ? "ResetAll enviado: programa, Q/M y temporizadores se borran; vuelve a desplegar."
          : `Motor ${command.enable ? "RUN" : "STOP"} · entradas ${command.use_virtual_inputs ? "virtuales" : "físicas"} confirmadas por API.`,
      });
      if (command.reset) set({ deployedSignature: null, deployedName: null });
      if (command.use_virtual_inputs) {
        for (const entry of desired.values()) entry.sent = undefined;
        syncSensors();
      }
    } catch (error) {
      if (requestEpoch === epoch)
        set({
          engine: null,
          virtualInputs: null,
          error: `Comando no confirmado: ${errorText(error)}`,
        });
    } finally {
      if (requestEpoch === epoch) set({ commandBusy: false });
    }
  },
  deploy: async () => {
    if (get().deploying) return;
    const program = copyProgram(get().program);
    const requestEpoch = epoch;
    try {
      validateProgram(program);
    } catch (error) {
      set({ error: errorText(error) });
      return;
    }
    set({ deploying: true, error: null });
    try {
      const response = await api<{ status: string; instructions: number }>(
        "/api/plc/deploy",
        program,
        lifetime?.signal,
      );
      if (requestEpoch !== epoch) {
        set({
          notice:
            "La conexión cambió durante el despliegue. Verifica el programa en PLC antes de reenviar.",
        });
        return;
      }
      set({
        deployedSignature: JSON.stringify(program),
        deployedName: program.project_name,
        notice: `Hot-reload enviado: ${response.instructions} instrucciones. El contador de telemetría confirma la carga. Q/M se conservan.`,
      });
    } catch (error) {
      if (requestEpoch === epoch && !lifetime?.signal.aborted)
        set({ error: `Despliegue: ${errorText(error)}` });
    } finally {
      set({ deploying: false });
    }
  },
  generate: async (prompt) => {
    if (!prompt.trim() || get().generating) return;
    const originalSignature = JSON.stringify(get().program);
    set((state) => ({
      generating: true,
      error: null,
      chat: [...state.chat, { role: "operator", text: prompt }],
    }));
    try {
      const program = await api<unknown>(
        "/api/ai/generate",
        { prompt },
        lifetime?.signal,
        90000,
      );
      validateProgram(program);
      const changed = JSON.stringify(get().program) !== originalSignature;
      set((state) => ({
        program: changed ? state.program : program,
        generatedDraft: changed ? program : null,
        chat: [
          ...state.chat,
          {
            role: "assistant",
            text: `Preparé ${program.project_name} con ${program.rungs.length} peldaños. ${changed ? "El borrador cambió durante la generación; usa Cargar resultado para reemplazarlo." : "Revísalo en el editor y pulsa Deploy para enviarlo."}`,
          },
        ],
        notice: changed
          ? "Resultado IA disponible. Se conservaron las ediciones realizadas durante la generación."
          : "Programa de IA cargado como borrador. Pendiente de revisión y despliegue.",
      }));
    } catch (error) {
      if (!lifetime?.signal.aborted)
        set((state) => ({
          error: `Copiloto: ${errorText(error)}`,
          chat: [
            ...state.chat,
            {
              role: "assistant",
              text: `No se generó el programa: ${errorText(error)}`,
            },
          ],
        }));
    } finally {
      set({ generating: false });
    }
  },
}));
