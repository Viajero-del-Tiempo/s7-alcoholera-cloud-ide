import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  address,
  copyProgram,
  countInstructions,
  instruction,
  isCoil,
  isTimer,
  PRESETS,
  tag,
  traceProgram,
  validateProgram,
  validationError,
} from "../lib/ladder";
import { usePlcStore } from "../store/usePlcStore";
import { OPCODES } from "../types";
import type {
  Bank,
  Energy,
  InstructionTrace,
  LadderInstruction,
  LadderProgramPayload,
  Mnemonic,
} from "../types";
import { Icon } from "./Icon";

const energyClass = (energy: Energy) =>
  energy === null ? "energy-unknown" : energy ? "energy-on" : "energy-off";
const energyText = (energy: Energy) =>
  energy === null ? "desconocido" : energy ? "1" : "0";
function LadderNode({
  inst,
  trace,
  selected,
  observed,
  onClick,
}: {
  inst: LadderInstruction;
  trace: InstructionTrace;
  selected: boolean;
  observed: Energy;
  onClick: () => void;
}) {
  const timer = isTimer(inst.mnemonic);
  const coil = isCoil(inst.mnemonic);
  return (
    <button
      className={`ladder-node ${energyClass(trace.after)} ${selected ? "node-selected" : ""}`}
      onClick={onClick}
      title={`${inst.mnemonic} · RLO calculado: ${energyText(trace.after)}${timer ? " · Q/ET sin telemetría" : ""}`}
    >
      <span className="node-address">
        {timer
          ? `T[${inst.index}] · ${inst.param} ms`
          : address(inst.bank, inst.index)}
      </span>
      <span className={`node-symbol ${coil ? "coil" : ""}`}>
        {timer ? (
          <span className="timer-symbol">{inst.mnemonic}</span>
        ) : coil ? (
          <>
            <span>(</span>
            <span className="coil-letter">
              {inst.mnemonic === "OUT"
                ? " "
                : inst.mnemonic === "SET"
                  ? "S"
                  : "R"}
            </span>
            <span>)</span>
          </>
        ) : (
          <>
            <span>│</span>
            <span className="contact-slash">
              {inst.mnemonic.endsWith("NC") ? "/" : " "}
            </span>
            <span>│</span>
          </>
        )}
      </span>
      <strong>{tag(inst)}</strong>
      <span className="node-subtitle">
        {timer
          ? `IN ${energyText(trace.before)} · Q/ET ?`
          : coil
            ? `Bit observado: ${energyText(observed)}`
            : `${inst.mnemonic.startsWith("OR") ? "OR · " : inst.mnemonic.startsWith("AND") ? "AND · " : "LD · "}contacto ${energyText(trace.condition)}`}
      </span>
    </button>
  );
}

export function LadderEditor() {
  const {
    program,
    setProgram,
    telemetry,
    fresh,
    deployedSignature,
    deployedName,
    deploying,
    deploy,
  } = usePlcStore(
    useShallow((s) => ({
      program: s.program,
      setProgram: s.setProgram,
      telemetry: s.telemetry,
      fresh: s.fresh,
      deployedSignature: s.deployedSignature,
      deployedName: s.deployedName,
      deploying: s.deploying,
      deploy: s.deploy,
    })),
  );
  const [selected, setSelected] = useState<{
    rung: number;
    inst: number;
  } | null>(null);
  const [mode, setMode] = useState<"visual" | "json">("visual");
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [presetIndex, setPresetIndex] = useState("0");
  const traces = useMemo(
    () => traceProgram(program, fresh ? telemetry : null),
    [program, telemetry, fresh],
  );
  const dirty = JSON.stringify(program) !== deployedSignature;
  const error = validationError(program);
  const selectedRung = selected ? program.rungs[selected.rung] : undefined;
  const selectedInst = selected
    ? selectedRung?.instructions[selected.inst]
    : undefined;
  function mutate(action: (draft: LadderProgramPayload) => void) {
    const draft = copyProgram(program);
    action(draft);
    setProgram(draft);
  }
  function updateInstruction(next: LadderInstruction) {
    if (selected)
      mutate((draft) => {
        draft.rungs[selected.rung]!.instructions[selected.inst] = next;
      });
  }
  function addRung() {
    mutate((draft) =>
      draft.rungs.push({
        rung_id: Math.max(0, ...draft.rungs.map((r) => r.rung_id)) + 1,
        comment: "Nuevo peldaño",
        instructions: [instruction("LD_NO"), instruction("OUT", "M", 0)],
      }),
    );
    setSelected({ rung: program.rungs.length, inst: 0 });
  }
  function addInstruction(rungIndex: number, mnemonic: Mnemonic) {
    const rung = program.rungs[rungIndex]!;
    const at =
      selected?.rung === rungIndex
        ? selected.inst + 1
        : Math.max(1, rung.instructions.length - 1);
    mutate((draft) =>
      draft.rungs[rungIndex]!.instructions.splice(
        at,
        0,
        instruction(mnemonic, isCoil(mnemonic) ? "Q" : "I"),
      ),
    );
    setSelected({ rung: rungIndex, inst: at });
  }
  return (
    <section className="panel ladder-panel">
      <div className="panel-heading">
        <div className="heading-icon">
          <Icon name="code" />
        </div>
        <div>
          <h2>Programa Ladder</h2>
          <p>Editor de lógica · S7-1500</p>
        </div>
        <span className={`badge ${dirty ? "badge-amber" : "badge-green"}`}>
          {dirty ? "Sin desplegar" : "Último envío"}
        </span>
      </div>
      <div className="editor-toolbar">
        <label className="sr-only" htmlFor="preset">
          Preset de proceso
        </label>
        <select
          id="preset"
          value={presetIndex}
          onChange={(e) => setPresetIndex(e.target.value)}
        >
          {PRESETS.map((preset, index) => (
            <option key={preset.name} value={index}>
              {preset.name}
            </option>
          ))}
        </select>
        <button
          className="button subtle"
          title={PRESETS[Number(presetIndex)]!.detail}
          onClick={() => {
            setProgram(copyProgram(PRESETS[Number(presetIndex)]!.program));
            setSelected(null);
          }}
        >
          Cargar preset
        </button>
        <div className="segmented">
          <button
            className={mode === "visual" ? "selected" : ""}
            onClick={() => setMode("visual")}
          >
            Ladder
          </button>
          <button
            className={mode === "json" ? "selected" : ""}
            onClick={() => {
              setMode("json");
              setJson(JSON.stringify(program, null, 2));
              setJsonError(null);
            }}
          >
            JSON
          </button>
        </div>
      </div>
      <div className="project-line">
        <span className="small-label">PROYECTO</span>
        <input
          aria-label="Nombre del proyecto"
          value={program.project_name}
          onChange={(e) =>
            mutate((draft) => {
              draft.project_name = e.target.value;
            })
          }
        />
        <span className="mono">{countInstructions(program)} / 199</span>
      </div>
      <div className="rlo-legend">
        <span>
          <i className="dot green" />
          RLO calculado sobre snapshot
        </span>
        <span>
          <i className="dot amber" />
          Desconocido
        </span>
      </div>
      {mode === "json" ? (
        <div className="json-editor">
          <textarea
            aria-label="JSON del programa"
            spellCheck={false}
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
          <div className="json-actions">
            <span role="alert">
              {jsonError || "Aplica el JSON al borrador para validarlo."}
            </span>
            <button
              className="button subtle"
              onClick={() => {
                try {
                  const parsed: unknown = JSON.parse(json);
                  validateProgram(parsed);
                  setProgram(parsed);
                  setSelected(null);
                  setJsonError(null);
                  setMode("visual");
                } catch (err) {
                  setJsonError(
                    err instanceof Error ? err.message : "JSON inválido",
                  );
                }
              }}
            >
              Aplicar JSON
            </button>
          </div>
        </div>
      ) : (
        <div className="rungs-scroll">
          {program.rungs.map((rung, rungIndex) => (
            <article
              className={`rung ${selected?.rung === rungIndex ? "rung-selected" : ""}`}
              key={`${rung.rung_id}-${rungIndex}`}
            >
              <div className="rung-header">
                <span className="rung-number">
                  {String(rung.rung_id).padStart(2, "0")}
                </span>
                <input
                  aria-label={`Comentario peldaño ${rung.rung_id}`}
                  value={rung.comment}
                  onChange={(e) =>
                    mutate((draft) => {
                      draft.rungs[rungIndex]!.comment = e.target.value;
                    })
                  }
                />
                <button
                  className="icon-button"
                  aria-label={`Eliminar peldaño ${rung.rung_id}`}
                  disabled={program.rungs.length === 1}
                  onClick={() => {
                    mutate((draft) => {
                      draft.rungs.splice(rungIndex, 1);
                    });
                    setSelected(null);
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <div className="rung-diagram">
                <div className="ladder-rail" />
                {rung.instructions.map((inst, index) => {
                  const bits =
                    inst.bank === "I"
                      ? telemetry?.inputs
                      : inst.bank === "Q"
                        ? telemetry?.outputs
                        : telemetry?.markers;
                  return (
                    <LadderNode
                      key={index}
                      inst={inst}
                      trace={traces[rungIndex]![index]!}
                      selected={
                        selected?.rung === rungIndex && selected.inst === index
                      }
                      observed={fresh ? (bits?.[inst.index] ?? null) : null}
                      onClick={() =>
                        setSelected({ rung: rungIndex, inst: index })
                      }
                    />
                  );
                })}
                <div className="ladder-rail" />
              </div>
              {selected?.rung === rungIndex && (
                <div className="rung-add">
                  <span>Insertar tras selección</span>
                  <button onClick={() => addInstruction(rungIndex, "AND_NO")}>
                    + Contacto
                  </button>
                  <button onClick={() => addInstruction(rungIndex, "OUT")}>
                    + Bobina
                  </button>
                  <button onClick={() => addInstruction(rungIndex, "TON")}>
                    + Timer
                  </button>
                </div>
              )}
            </article>
          ))}
          <button
            className="add-rung"
            disabled={countInstructions(program) > 197}
            onClick={addRung}
          >
            <Icon name="plus" size={15} /> Añadir peldaño
          </button>
        </div>
      )}
      {mode === "visual" && selectedInst && selected && (
        <div className="instruction-inspector">
          <div className="inspector-title">
            <span>
              INSTRUCCIÓN · {selectedRung!.rung_id}.{selected.inst + 1}
            </span>
            <button
              className="icon-button"
              aria-label="Cerrar inspector"
              onClick={() => setSelected(null)}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="inspector-fields">
            <label>
              Operación
              <select
                value={selectedInst.mnemonic}
                onChange={(e) => {
                  const mnemonic = e.target.value as Mnemonic;
                  updateInstruction(
                    instruction(
                      mnemonic,
                      selectedInst.bank,
                      selectedInst.index,
                      isTimer(selectedInst.mnemonic)
                        ? selectedInst.param
                        : undefined,
                    ),
                  );
                }}
              >
                {Object.keys(OPCODES).map((mnemonic) => (
                  <option key={mnemonic}>{mnemonic}</option>
                ))}
              </select>
            </label>
            <label>
              Banco
              <select
                disabled={isTimer(selectedInst.mnemonic)}
                value={selectedInst.bank}
                onChange={(e) =>
                  updateInstruction(
                    instruction(
                      selectedInst.mnemonic,
                      e.target.value as Bank,
                      selectedInst.index,
                    ),
                  )
                }
              >
                {(["I", "Q", "M"] as const)
                  .filter(
                    (bank) => !isCoil(selectedInst.mnemonic) || bank !== "I",
                  )
                  .map((bank) => (
                    <option key={bank}>{bank}</option>
                  ))}
              </select>
            </label>
            <label>
              Índice
              <input
                type="number"
                min="0"
                max={
                  isTimer(selectedInst.mnemonic)
                    ? 15
                    : selectedInst.bank === "M"
                      ? 63
                      : 31
                }
                value={selectedInst.index}
                onChange={(e) =>
                  updateInstruction({
                    ...selectedInst,
                    index: Number(e.target.value),
                  })
                }
              />
            </label>
            {isTimer(selectedInst.mnemonic) && (
              <label>
                PT · ms
                <input
                  type="number"
                  min="0"
                  max="2147483647"
                  value={selectedInst.param}
                  onChange={(e) =>
                    updateInstruction({
                      ...selectedInst,
                      param: Number(e.target.value),
                    })
                  }
                />
              </label>
            )}
            <button
              className="icon-button"
              title="Mover a la izquierda"
              aria-label="Mover instrucción a la izquierda"
              disabled={selected.inst === 0}
              onClick={() => {
                mutate((draft) => {
                  const insts = draft.rungs[selected.rung]!.instructions;
                  const [moved] = insts.splice(selected.inst, 1);
                  insts.splice(selected.inst - 1, 0, moved!);
                });
                setSelected({ ...selected, inst: selected.inst - 1 });
              }}
            >
              ←
            </button>
            <button
              className="icon-button"
              title="Mover a la derecha"
              aria-label="Mover instrucción a la derecha"
              disabled={selected.inst >= selectedRung!.instructions.length - 1}
              onClick={() => {
                mutate((draft) => {
                  const insts = draft.rungs[selected.rung]!.instructions;
                  const [moved] = insts.splice(selected.inst, 1);
                  insts.splice(selected.inst + 1, 0, moved!);
                });
                setSelected({ ...selected, inst: selected.inst + 1 });
              }}
            >
              →
            </button>
            <button
              className="icon-button danger-text"
              aria-label="Eliminar instrucción"
              disabled={selectedRung!.instructions.length <= 1}
              onClick={() => {
                mutate((draft) => {
                  draft.rungs[selected.rung]!.instructions.splice(
                    selected.inst,
                    1,
                  );
                });
                setSelected(null);
              }}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        </div>
      )}
      <div className="ladder-footer">
        <p>
          {error ||
            "TON/TOF: IN calculable; Q/ET sin telemetría. El RLO posterior se muestra desconocido."}
        </p>
        <div>
          <span>
            {deployedName
              ? `Último envío: ${deployedName}`
              : "Ningún programa enviado desde esta sesión"}
          </span>
          <button
            className="button primary deploy-button"
            disabled={!!error || !fresh || deploying}
            onClick={() => void deploy()}
          >
            <Icon name="upload" size={16} />
            {deploying ? "Enviando…" : "Deploy to S7-1500"}
            <small>Hot-Reload</small>
          </button>
        </div>
        <p className="retention-note">
          Hot-reload conserva Q/M. STOP apaga Q y timers. ResetAll borra
          programa y marcas.
        </p>
      </div>
    </section>
  );
}
