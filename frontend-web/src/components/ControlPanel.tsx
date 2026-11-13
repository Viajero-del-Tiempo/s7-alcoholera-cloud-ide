import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePlcStore } from "../store/usePlcStore";
import { Icon } from "./Icon";

function MomentaryButton({
  index,
  color,
  name,
  subtitle,
}: {
  index: number;
  color: "green" | "red";
  name: string;
  subtitle: string;
}) {
  const { setInput, fresh, virtualInputs, inputPending, telemetry } =
    usePlcStore(
      useShallow((s) => ({
        setInput: s.setInput,
        fresh: s.fresh,
        virtualInputs: s.virtualInputs,
        inputPending: s.inputPending,
        telemetry: s.telemetry,
      })),
    );
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const pending = inputPending.includes(index);
  const disabled = !fresh || virtualInputs !== true || (!held && pending);
  function release() {
    if (heldRef.current) {
      heldRef.current = false;
      setHeld(false);
      setInput(index, false);
    }
  }
  useEffect(() => {
    const releaseGlobal = () => {
      if (heldRef.current) {
        heldRef.current = false;
        setHeld(false);
        setInput(index, false);
      }
    };
    window.addEventListener("pointerup", releaseGlobal);
    window.addEventListener("pointercancel", releaseGlobal);
    window.addEventListener("blur", releaseGlobal);
    return () => {
      releaseGlobal();
      window.removeEventListener("pointerup", releaseGlobal);
      window.removeEventListener("pointercancel", releaseGlobal);
      window.removeEventListener("blur", releaseGlobal);
    };
  }, [index, setInput]);
  return (
    <div className="momentary-control">
      <button
        className={`industrial-button ${color} ${held ? "pressed" : ""}`}
        disabled={disabled}
        aria-label={`${name} · mantener pulsado`}
        aria-pressed={held}
        onPointerDown={(e) => {
          if (e.button !== 0 || disabled) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          heldRef.current = true;
          setHeld(true);
          setInput(index, true);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
        onBlur={release}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat && !disabled) {
            e.preventDefault();
            heldRef.current = true;
            setHeld(true);
            setInput(index, true);
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            release();
          }
        }}
      >
        <Icon name={index === 0 ? "play" : "stop"} size={20} />
      </button>
      <div>
        <strong>{name}</strong>
        <span>{subtitle}</span>
        <small
          className={fresh && telemetry?.inputs[index] ? "green-text" : ""}
        >
          {pending
            ? "Escritura pendiente…"
            : fresh
              ? `Bit observado: ${Number(telemetry?.inputs[index])}`
              : "Sin telemetría"}
        </small>
      </div>
    </div>
  );
}
export function ControlPanel() {
  const {
    engine,
    virtualInputs,
    command,
    fresh,
    commandBusy,
    telemetry,
    setInput,
    inputPending,
  } = usePlcStore(
    useShallow((s) => ({
      engine: s.engine,
      virtualInputs: s.virtualInputs,
      command: s.command,
      fresh: s.fresh,
      commandBusy: s.commandBusy,
      telemetry: s.telemetry,
      setInput: s.setInput,
      inputPending: s.inputPending,
    })),
  );
  const [sourceChoice, setSourceChoice] = useState(true);
  const [resetConfirm, setResetConfirm] = useState(false);
  const disabled = !fresh || commandBusy;
  return (
    <section className="panel control-panel">
      <div className="control-title">
        <span className="small-label">PUPITRE DE OPERADOR</span>
        <h2>Control de planta</h2>
        <span
          className={`engine-state ${engine === true ? "green-text" : "muted"}`}
        >
          <i
            className={`dot ${engine === true ? "green" : engine === false ? "gray" : "amber"}`}
          />
          {engine === null
            ? "RUN / fuente sin confirmar"
            : engine
              ? "Motor RUN confirmado por API"
              : "Motor STOP confirmado por API"}
        </span>
      </div>
      <div className="operator-buttons">
        <MomentaryButton
          index={0}
          color="green"
          name="START_BATCH"
          subtitle="I0.0 · Pulsador de lote"
        />
        <MomentaryButton
          index={1}
          color="red"
          name="STOP_RESET"
          subtitle="I0.1 · Parada de proceso"
        />
      </div>
      <div className="thermal-control">
        <span className="small-label">FALLA TÉRMICA</span>
        <button
          className={`switch-label ${fresh && telemetry?.inputs[4] ? "alarm-active" : ""}`}
          role="switch"
          aria-label="Simular alarma térmica TSH_102"
          aria-checked={fresh && telemetry?.inputs[4] === true}
          disabled={
            disabled || virtualInputs !== true || inputPending.includes(4)
          }
          onClick={() => setInput(4, !telemetry?.inputs[4])}
        >
          <span className="switch-track">
            <i />
          </span>
          <strong>TSH_102</strong>
          <span>
            {fresh ? (telemetry?.inputs[4] ? "FALLA" : "NORMAL") : "—"}
          </span>
        </button>
        <small>I1.0 físico · índice lógico 4</small>
      </div>
      <div className="engine-control">
        <div className="engine-actions">
          <button
            className="button run-button"
            disabled={disabled || engine === true}
            onClick={() =>
              void command({ enable: true, use_virtual_inputs: sourceChoice })
            }
          >
            <Icon name="play" size={13} />
            RUN
          </button>
          <button
            className="button subtle"
            disabled={disabled || engine === false}
            onClick={() =>
              void command({ enable: false, use_virtual_inputs: sourceChoice })
            }
          >
            <Icon name="stop" size={13} />
            STOP
          </button>
          <button
            className="button reset-button"
            disabled={disabled}
            onClick={() => setResetConfirm(true)}
          >
            <Icon name="refresh" size={13} />
            ResetAll
          </button>
        </div>
        <label className="source-choice">
          <input
            type="checkbox"
            checked={sourceChoice}
            onChange={(e) => setSourceChoice(e.target.checked)}
          />
          Entradas virtuales / HIL
          <button
            className="text-button"
            type="button"
            disabled={disabled}
            onClick={() => void command({ use_virtual_inputs: sourceChoice })}
          >
            Aplicar
          </button>
        </label>
        <small>
          {virtualInputs === null
            ? "Selecciona fuente y confirma con Aplicar o RUN."
            : `Fuente confirmada: ${virtualInputs ? "virtual · gemelo 3D" : "física · PLC"}`}
        </small>
      </div>
      {resetConfirm && (
        <div className="modal-backdrop" onClick={() => setResetConfirm(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            className="confirm-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <Icon name="warning" size={26} />
            <h2 id="reset-title">Borrar el estado del motor</h2>
            <p>
              ResetAll detiene el motor y borra programa, Q/M y temporizadores
              del PLC. El borrador del editor se conserva para volver a
              desplegar.
            </p>
            <div>
              <button
                autoFocus
                className="button subtle"
                onClick={() => setResetConfirm(false)}
              >
                Cancelar
              </button>
              <button
                className="button danger"
                onClick={() => {
                  setResetConfirm(false);
                  void command({
                    reset: true,
                    enable: false,
                    use_virtual_inputs: sourceChoice,
                  });
                }}
              >
                Ejecutar ResetAll
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
