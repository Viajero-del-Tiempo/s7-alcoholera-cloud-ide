"""S7 wire representation. Bool arrays use S7 byte order, bit 0 first."""

import struct

from app.models.schemas import LadderProgramPayload


INSTRUCTION = struct.Struct(">hhi")
UPLOAD_SLOTS = 200
UPLOAD_SIZE = UPLOAD_SLOTS * INSTRUCTION.size
HEADER_SIZE = 24
DB10_SIZE = HEADER_SIZE + UPLOAD_SIZE


def pack_ladder_program(payload: LadderProgramPayload) -> bytearray:
    # Revalidate even models constructed through model_construct or subsequently
    # mutated by another Python caller, before touching PLC memory.
    payload = LadderProgramPayload.model_validate(payload.model_dump())
    result = bytearray(UPLOAD_SIZE)
    cursor = 0
    for rung in payload.rungs:
        for inst in rung.instructions:
            INSTRUCTION.pack_into(result, cursor, inst.opcode, inst.index, inst.param)
            cursor += INSTRUCTION.size
    INSTRUCTION.pack_into(result, cursor, 0, 0, 0)
    return result


def read_bits(raw: bytes | bytearray, offset: int, count: int) -> list[bool]:
    return [bool(raw[offset + index // 8] & (1 << (index % 8))) for index in range(count)]


def unpack_telemetry_db10(raw_bytes: bytes) -> dict:
    if len(raw_bytes) < HEADER_SIZE:
        raise ValueError("DB10 telemetry requires at least 24 bytes")
    return {
        "active_instructions": struct.unpack_from(">h", raw_bytes, 2)[0],
        "inputs": read_bits(raw_bytes, 8, 32),
        "outputs": read_bits(raw_bytes, 12, 32),
        "markers": read_bits(raw_bytes, 16, 64),
    }
