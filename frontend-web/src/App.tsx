import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { AICopilot } from "./components/AICopilot";
import { ControlPanel } from "./components/ControlPanel";
import { Icon } from "./components/Icon";
import { LadderEditor } from "./components/LadderEditor";
import { Plant3D } from "./components/Plant3D";
import { API_BASE } from "./lib/api";
import { usePlcStore } from "./store/usePlcStore";

export default function App() {
  const {
    connect,
    connection,
    fresh,
    telemetry,
    health,
    error,
    notice,
    clearError,
    reconnect,
  } = usePlcStore(
    useShallow((s) => ({
      connect: s.connect,
      connection: s.connection,
      fresh: s.fresh,
      telemetry: s.telemetry,
      health: s.health,
      error: s.error,
      notice: s.notice,
      clearError: s.clearError,
      reconnect: s.reconnect,
    })),
  );
  useEffect(() => connect(), [connect]);
  const backendLabel = fresh
    ? "Backend conectado"
    : connection === "connecting"
      ? "Conectando backend"
      : connection === "reconnecting"
        ? "Reconectando backend"
        : "Backend sin conexión";
  const mode =
    health?.simulation_mode === true
      ? "Simulation Mode"
      : fresh && telemetry?.plc_connected
        ? "PLC físico Online"
        : health
          ? "PLC físico Offline"
          : "Modo sin verificar";
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#main"
          aria-label="Alcoholera sala de control"
        >
          <span className="brand-mark">
            <Icon name="plant" size={25} />
          </span>
          <span>
            <strong>
              ALCOHOLERA<span className="brand-slash">/</span>
              <b>CONTROL</b>
            </strong>
            <small>INDUSTRIAL AUTOMATION WORKSPACE</small>
          </span>
        </a>
        <div className="connection-cluster">
          <span className="connection-status">
            <i className={`dot ${fresh ? "green pulse" : "amber"}`} />
            {backendLabel}
          </span>
          <span
            className={`mode-pill ${health?.simulation_mode ? "simulation" : ""}`}
          >
            {mode}
          </span>
          <button
            className="icon-button"
            aria-label="Reconectar telemetría"
            title="Reconectar telemetría"
            onClick={reconnect}
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>
      </header>
      <main id="main">
        <div className="workspace-heading">
          <div>
            <div className="eyebrow">
              <span>PLANTA 01</span>
              <span>/</span>CONTROL & SIMULACIÓN
            </div>
            <h1>
              Sala de control<span className="title-dot">.</span>
            </h1>
            <p>Lógica de proceso, telemetría y planta en un mismo espacio.</p>
          </div>
          <div className="scan-status">
            <span className="small-label">INSTRUCCIONES ACTIVAS</span>
            <strong>
              {fresh
                ? String(telemetry?.active_instructions ?? 0).padStart(3, "0")
                : "—"}
              <small> / 200</small>
            </strong>
            <span>
              <i className={`dot ${fresh ? "green" : "amber"}`} />
              WS · ciclo 100 ms
            </span>
          </div>
        </div>
        {!fresh && (
          <div className="network-banner" role="status">
            <Icon name="link" size={17} />
            <span>
              {backendLabel}. La física y los sensores automáticos están
              pausados.{" "}
              {connection !== "connecting" &&
                "Se reintentará la conexión automáticamente."}
            </span>
            <button onClick={reconnect}>Reintentar</button>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <Icon name="warning" size={18} />
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Cerrar error"
              onClick={clearError}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        <div className="workspace-grid">
          <div className="logic-column">
            <LadderEditor />
            <AICopilot />
          </div>
          <Plant3D />
        </div>
        <ControlPanel />
        <div className="activity-line" role="status">
          <Icon name="check" size={13} />
          <span>
            {notice ||
              "Listo para trabajar. Carga un preset o genera un programa, revisa y despliega; luego confirma la fuente de entradas y RUN."}
          </span>
        </div>
      </main>
      <footer className="app-footer">
        <span>
          <i className="dot gray" />
          S7-1500 · DB10 / DB11 · Ladder VM
        </span>
        <span title={API_BASE}>{API_BASE}</span>
        <span>FERMENTACIÓN & DESTILACIÓN</span>
      </footer>
    </div>
  );
}
