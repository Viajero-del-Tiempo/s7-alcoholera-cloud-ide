"""Public JSON models and operand validation from CONTRACT.md."""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


OPCODES = {
    "LD_NO": 1, "LD_NC": 2, "AND_NO": 3, "AND_NC": 4,
    "OR_NO": 5, "OR_NC": 6, "OUT": 10, "SET": 11,
    "RESET": 12, "TON": 20, "TOF": 21,
}
BANKS = {"I": 0, "Q": 1, "M": 2}


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class LadderInstruction(ContractModel):
    mnemonic: Literal[
        "LD_NO", "LD_NC", "AND_NO", "AND_NC", "OR_NO", "OR_NC",
        "OUT", "SET", "RESET", "TON", "TOF",
    ]
    opcode: int
    bank: Literal["I", "Q", "M"]
    index: int = Field(ge=0)
    param: int = Field(ge=0, le=2_147_483_647)

    @model_validator(mode="after")
    def valid_operand(self) -> Self:
        if self.opcode != OPCODES[self.mnemonic]:
            raise ValueError("mnemonic and opcode must match CONTRACT.md")
        if self.opcode in (20, 21):
            # Timers use Param as PT, and ignore the JSON bank (canonical: M).
            if self.index > 15:
                raise ValueError("timer index must be in 0..15")
        else:
            if self.param != BANKS[self.bank]:
                raise ValueError("param must match bank: I=0, Q=1, M=2")
            if self.index >= (64 if self.bank == "M" else 32):
                raise ValueError("bit index exceeds the selected bank")
            if self.opcode in (10, 11, 12) and self.bank == "I":
                raise ValueError("coils cannot write to inputs")
        return self


class LadderRung(ContractModel):
    rung_id: int
    comment: str
    instructions: list[LadderInstruction] = Field(min_length=1, max_length=199)


class LadderProgramPayload(ContractModel):
    project_name: str = Field(min_length=1)
    rungs: list[LadderRung] = Field(min_length=1, max_length=199)

    @model_validator(mode="after")
    def fits_upload_area(self) -> Self:
        if sum(len(rung.instructions) for rung in self.rungs) > 199:
            raise ValueError("at most 199 useful instructions plus END_PROG fit DB10")
        return self


class InputPayload(ContractModel):
    index: int = Field(ge=0, le=31)
    value: bool


class CommandPayload(ContractModel):
    enable: bool
    reset: bool
    use_virtual_inputs: bool


class GeneratePayload(ContractModel):
    prompt: str = Field(min_length=1, max_length=20_000)


class HealthResponse(ContractModel):
    status: Literal["ok"] = "ok"
    plc_connected: bool
    simulation_mode: bool


class TelemetryPayload(ContractModel):
    plc_connected: bool
    active_instructions: int = Field(ge=0, le=200)
    inputs: list[bool] = Field(min_length=32, max_length=32)
    outputs: list[bool] = Field(min_length=32, max_length=32)
    markers: list[bool] = Field(min_length=64, max_length=64)
