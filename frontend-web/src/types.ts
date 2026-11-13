export type Bank = "I" | "Q" | "M";
export const OPCODES = {
  LD_NO: 1,
  LD_NC: 2,
  AND_NO: 3,
  AND_NC: 4,
  OR_NO: 5,
  OR_NC: 6,
  OUT: 10,
  SET: 11,
  RESET: 12,
  TON: 20,
  TOF: 21,
} as const;
export type Mnemonic = keyof typeof OPCODES;
export interface LadderInstruction {
  mnemonic: Mnemonic;
  opcode: number;
  bank: Bank;
  index: number;
  param: number;
}
export interface LadderRung {
  rung_id: number;
  comment: string;
  instructions: LadderInstruction[];
}
export interface LadderProgramPayload {
  project_name: string;
  rungs: LadderRung[];
}
export interface Telemetry {
  plc_connected: boolean;
  active_instructions: number;
  inputs: boolean[];
  outputs: boolean[];
  markers: boolean[];
}
export interface Health {
  status: "ok";
  plc_connected: boolean;
  simulation_mode: boolean;
}
export interface Command {
  enable: boolean;
  reset: boolean;
  use_virtual_inputs: boolean;
}
export type Energy = boolean | null;
export interface InstructionTrace {
  before: Energy;
  after: Energy;
  condition: Energy;
  bit: Energy;
}
