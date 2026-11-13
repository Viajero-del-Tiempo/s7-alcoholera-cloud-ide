import { OPCODES } from "../types";
import type {
  Bank,
  Energy,
  InstructionTrace,
  LadderInstruction,
  LadderProgramPayload,
  LadderRung,
  Mnemonic,
  Telemetry,
} from "../types";

export const INPUT_TAGS = [
  "START_BATCH",
  "STOP_RESET",
  "LSH_101",
  "LSL_101",
  "TSH_102",
];
export const OUTPUT_TAGS = ["P_101", "M_101", "XV_102", "P_102", "AL_101"];
export const OUTPUT_NAMES = [
  "Alimentación",
  "Agitador",
  "Vapor",
  "Trasiego",
  "Alarma",
];
export const BANK_PARAM: Record<Bank, number> = { I: 0, Q: 1, M: 2 };
export const isTimer = (mnemonic: Mnemonic) =>
  mnemonic === "TON" || mnemonic === "TOF";
export const isCoil = (mnemonic: Mnemonic) =>
  ["OUT", "SET", "RESET"].includes(mnemonic);
export function address(bank: Bank, index: number) {
  if (bank === "I" && index <= 4) return index === 4 ? "I1.0" : `I0.${index}`;
  if (bank === "Q" && index <= 4) return `Q0.${index}`;
  return `${bank}[${index}]`;
}
export function tag(inst: LadderInstruction) {
  if (isTimer(inst.mnemonic))
    return `${inst.mnemonic === "TON" ? "TON" : "TOF"} ${inst.index}`;
  return (
    (inst.bank === "I"
      ? INPUT_TAGS[inst.index]
      : inst.bank === "Q"
        ? OUTPUT_TAGS[inst.index]
        : undefined) ?? address(inst.bank, inst.index)
  );
}
export function instruction(
  mnemonic: Mnemonic,
  bank: Bank = "I",
  index = 0,
  param?: number,
): LadderInstruction {
  const timer = isTimer(mnemonic);
  const safeBank = timer ? "M" : isCoil(mnemonic) && bank === "I" ? "Q" : bank;
  return {
    mnemonic,
    opcode: OPCODES[mnemonic],
    bank: safeBank,
    index: Math.min(index, timer ? 15 : safeBank === "M" ? 63 : 31),
    param: timer ? (param ?? 15000) : BANK_PARAM[safeBank],
  };
}

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join(",") === keys.sort().join(",");
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function validateProgram(
  value: unknown,
): asserts value is LadderProgramPayload {
  if (
    !record(value) ||
    !exactKeys(value, ["project_name", "rungs"]) ||
    typeof value.project_name !== "string" ||
    !value.project_name.trim() ||
    !Array.isArray(value.rungs) ||
    !value.rungs.length
  )
    throw new Error("El programa requiere project_name y al menos un peldaño.");
  let count = 0;
  for (const rung of value.rungs) {
    if (
      !record(rung) ||
      !exactKeys(rung, ["rung_id", "comment", "instructions"]) ||
      !Number.isInteger(rung.rung_id) ||
      typeof rung.comment !== "string" ||
      !Array.isArray(rung.instructions) ||
      !rung.instructions.length
    )
      throw new Error(
        "Cada peldaño necesita ID entero, comentario e instrucciones.",
      );
    for (const inst of rung.instructions) {
      count++;
      if (
        !record(inst) ||
        !exactKeys(inst, ["mnemonic", "opcode", "bank", "index", "param"]) ||
        typeof inst.mnemonic !== "string" ||
        !(inst.mnemonic in OPCODES)
      )
        throw new Error(
          "Instrucción desconocida. END_PROG lo agrega el backend.",
        );
      const mnemonic = inst.mnemonic as Mnemonic;
      if (
        inst.opcode !== OPCODES[mnemonic] ||
        !["I", "Q", "M"].includes(inst.bank as string) ||
        !Number.isInteger(inst.index) ||
        !Number.isInteger(inst.param)
      )
        throw new Error("OpCode, banco o parámetros no válidos.");
      const { bank, index, param } = inst as unknown as LadderInstruction;
      if (
        index < 0 ||
        index > (isTimer(mnemonic) ? 15 : bank === "M" ? 63 : 31)
      )
        throw new Error("Índice fuera del rango del banco.");
      if (isTimer(mnemonic)) {
        if (param < 0 || param > 2147483647)
          throw new Error(
            "Timers: índice 0…15 y PT entero entre 0 y 2147483647 ms.",
          );
      } else if (
        param !== BANK_PARAM[bank] ||
        (isCoil(mnemonic) && bank === "I")
      )
        throw new Error(
          "El parámetro debe coincidir con el banco. Las bobinas solo escriben Q/M.",
        );
    }
  }
  if (count > 199)
    throw new Error("Se admiten hasta 199 instrucciones útiles.");
}
export function validationError(program: LadderProgramPayload): string | null {
  try {
    validateProgram(program);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Programa inválido";
  }
}
export const countInstructions = (program: LadderProgramPayload) =>
  program.rungs.reduce((sum, rung) => sum + rung.instructions.length, 0);
const and = (a: Energy, b: Energy): Energy =>
  a === false || b === false ? false : a === null || b === null ? null : true;
const or = (a: Energy, b: Energy): Energy =>
  a === true || b === true ? true : a === null || b === null ? null : false;

/** Evaluates instruction order over a snapshot; timers remain unknown (no Q/ET). */
export function traceProgram(
  program: LadderProgramPayload,
  telemetry: Telemetry | null,
): InstructionTrace[][] {
  const banks: Record<Bank, Energy[]> = {
    I: telemetry ? [...telemetry.inputs] : Array<Energy>(32).fill(null),
    Q: telemetry ? [...telemetry.outputs] : Array<Energy>(32).fill(null),
    M: telemetry ? [...telemetry.markers] : Array<Energy>(64).fill(null),
  };
  let rlo: Energy = telemetry ? false : null;
  return program.rungs.map((rung) =>
    rung.instructions.map((inst) => {
      const before = rlo;
      const bit = banks[inst.bank][inst.index] ?? null;
      let condition = bit;
      if ([2, 4, 6].includes(inst.opcode))
        condition = bit === null ? null : !bit;
      if ([1, 2].includes(inst.opcode)) rlo = condition;
      else if ([3, 4].includes(inst.opcode)) rlo = and(rlo, condition);
      else if ([5, 6].includes(inst.opcode)) rlo = or(rlo, condition);
      else if (isTimer(inst.mnemonic)) {
        condition = before;
        rlo = null;
      } else if (inst.opcode === 10) banks[inst.bank][inst.index] = rlo;
      else if (inst.opcode === 11) banks[inst.bank][inst.index] = or(bit, rlo);
      else if (inst.opcode === 12)
        banks[inst.bank][inst.index] = and(bit, rlo === null ? null : !rlo);
      return { before, after: rlo, condition, bit };
    }),
  );
}

const rung = (
  rung_id: number,
  comment: string,
  ...instructions: LadderInstruction[]
): LadderRung => ({ rung_id, comment, instructions });
const i = instruction;
const alarm = (id: number) =>
  rung(
    id,
    "Alarma térmica; STOP_RESET o TSH_102 apagan los accionamientos, incluso si quedaron retenidos.",
    i("LD_NO", "I", 4),
    i("OUT", "Q", 4),
    i("OR_NO", "I", 1),
    ...[0, 1, 2, 3].map((index) => i("RESET", "Q", index)),
  );
const clearUnused = (id: number, outputs: number[]) =>
  rung(
    id,
    "Desenergizar las salidas ajenas a este proceso; hot-reload conserva Q/M.",
    i("LD_NO", "I", 0),
    i("AND_NC", "I", 0),
    ...outputs.map((index) => i("OUT", "Q", index)),
  );
export const PRESETS: {
  name: string;
  detail: string;
  program: LadderProgramPayload;
}[] = [
  {
    name: "Llenado automático",
    detail:
      "START enclava P_101 hasta ≥90%; interlocks de parada y temperatura.",
    program: {
      project_name: "Alcoholera_Llenado",
      rungs: [
        rung(
          1,
          "START_BATCH enclava P_101. LSH_101 ≥90%, STOP_RESET y TSH_102 detienen la alimentación.",
          i("LD_NO"),
          i("OR_NO", "Q", 0),
          i("AND_NC", "I", 1),
          i("AND_NC", "I", 2),
          i("AND_NC", "I", 4),
          i("OUT", "Q", 0),
        ),
        clearUnused(2, [1, 2, 3]),
        alarm(3),
      ],
    },
  },
  {
    name: "Fermentación · 15 s",
    detail:
      "Agitador temporizado con flanco de START, nivel bajo e interlocks.",
    program: {
      project_name: "Alcoholera_Fermentacion_15s",
      rungs: [
        rung(
          1,
          "Un nuevo flanco START_BATCH rearma M1; M2 conserva el estado anterior.",
          i("LD_NO"),
          i("AND_NC", "M", 2),
          i("RESET", "M", 1),
        ),
        rung(
          2,
          "M0 enclava el lote con nivel >10%, sin STOP ni alarma; M1 indica lote finalizado.",
          i("LD_NO"),
          i("AND_NC", "M", 2),
          i("OR_NO", "M", 0),
          i("AND_NC", "M", 1),
          i("AND_NC", "I", 1),
          i("AND_NO", "I", 3),
          i("AND_NC", "I", 4),
          i("OUT", "M", 0),
        ),
        rung(
          3,
          "TON 0: 15000 ms. M1 retiene el fin del lote; START sostenido no lo reinicia.",
          i("LD_NO", "M", 0),
          i("TON", "M", 0, 15000),
          i("SET", "M", 1),
        ),
        rung(
          4,
          "Agitar hasta M1 con interlocks de nivel, parada y temperatura.",
          i("LD_NO", "M", 0),
          i("AND_NC", "M", 1),
          i("AND_NO", "I", 3),
          i("AND_NC", "I", 1),
          i("AND_NC", "I", 4),
          i("OUT", "Q", 1),
        ),
        rung(
          5,
          "Memoria del pulsador para detectar el siguiente flanco.",
          i("LD_NO"),
          i("OUT", "M", 2),
        ),
        clearUnused(6, [0, 2, 3]),
        alarm(7),
      ],
    },
  },
  {
    name: "Trasiego automático",
    detail:
      "START enclava P_102 hasta ≤10%; interlocks de parada y temperatura.",
    program: {
      project_name: "Alcoholera_Trasiego",
      rungs: [
        rung(
          1,
          "START_BATCH enclava P_102 mientras LSL_101 >10%, sin STOP ni alarma térmica.",
          i("LD_NO"),
          i("OR_NO", "Q", 3),
          i("AND_NC", "I", 1),
          i("AND_NO", "I", 3),
          i("AND_NC", "I", 4),
          i("OUT", "Q", 3),
        ),
        clearUnused(2, [0, 1, 2]),
        alarm(3),
      ],
    },
  },
  {
    name: "Protección térmica",
    detail: "AL_101 sigue TSH_102; otras salidas permanecen apagadas.",
    program: {
      project_name: "Alcoholera_Alarma_Termica",
      rungs: [clearUnused(1, [0, 1, 2, 3]), alarm(2)],
    },
  },
];
export const copyProgram = (
  program: LadderProgramPayload,
): LadderProgramPayload => structuredClone(program);
