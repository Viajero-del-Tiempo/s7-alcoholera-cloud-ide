"""Serialized DB10 access and a scan-based, offline implementation of the PLC VM.

S7_MODE=simulation never creates a network client. The default, auto, falls back
only when the initial connection fails. A failure after connecting is surfaced
to the caller; an uncertain PLC write is never silently replayed in RAM.
"""

from dataclasses import dataclass
from functools import lru_cache
import logging
import os
import struct
import threading
import time
from typing import Callable

from app.compiler.packer import (
    DB10_SIZE, HEADER_SIZE, INSTRUCTION, UPLOAD_SIZE, pack_ladder_program,
    unpack_telemetry_db10,
)
from app.models.schemas import CommandPayload, LadderProgramPayload


logger = logging.getLogger(__name__)
DB_NUMBER = 10
NEW_PROGRAM = 0
ENGINE_ENABLE = 1
RESET_ALL = 2
VIRTUAL_INPUTS = 3


class PLCUnavailable(RuntimeError):
    """The operation did not complete; the PLC state may be uncertain."""


class DeploymentBusy(RuntimeError):
    """The PLC has not acknowledged the preceding upload in time."""


@dataclass
class TimerState:
    started: float | None = None
    previous: bool = False
    q: bool = False


def validate_upload(data: bytes | bytearray) -> list[tuple[int, int, int]]:
    """Validate the entire active prefix before allowing any VM instruction."""
    if len(data) != UPLOAD_SIZE:
        raise ValueError("UploadProgram must contain exactly 1600 bytes")
    instructions = []
    for offset in range(0, UPLOAD_SIZE, INSTRUCTION.size):
        opcode, index, param = INSTRUCTION.unpack_from(data, offset)
        if opcode == 0:
            if index != 0 or param != 0:
                raise ValueError("END_PROG operands must be zero")
            return instructions
        if len(instructions) >= 199:
            raise ValueError("UploadProgram must end within its 200 slots")
        if opcode in (1, 2, 3, 4, 5, 6, 10, 11, 12):
            if param not in (0, 1, 2) or not 0 <= index < (64 if param == 2 else 32):
                raise ValueError("invalid bit operand")
            if opcode in (10, 11, 12) and param == 0:
                raise ValueError("coils cannot write to inputs")
        elif opcode in (20, 21):
            if not 0 <= index <= 15 or param < 0:
                raise ValueError("invalid timer operand")
        else:
            raise ValueError(f"unsupported opcode {opcode}")
        instructions.append((opcode, index, param))
    raise ValueError("missing END_PROG")


class S7Service:
    """Use get_s7_service() for the process singleton; tests can isolate instances."""

    def __init__(
        self, *, mode: str | None = None, client_factory: Callable | None = None,
        clock: Callable[[], float] = time.monotonic, handshake_timeout: float = 2.0,
    ):
        self.mode = (mode or os.getenv("S7_MODE", "auto")).lower()
        if self.mode not in {"auto", "simulation", "real"}:
            raise ValueError("S7_MODE must be auto, simulation or real")
        self.ip = os.getenv("PLC_IP", "192.168.56.101")
        self._client_factory = client_factory
        self._clock = clock
        self._handshake_timeout = handshake_timeout
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._started = False
        self._client = None
        self.plc_connected = False
        self.simulation_mode = self.mode == "simulation"
        self.last_error: str | None = None
        self.db10 = bytearray(DB10_SIZE)
        # DB11 is the active bytecode image, independent from UploadProgram.
        self.db11 = bytearray(UPLOAD_SIZE)
        self.physical_inputs = bytearray(4)
        self._program: list[tuple[int, int, int]] = []
        self.program_valid = True
        self._ton = [TimerState() for _ in range(16)]
        self._tof = [TimerState() for _ in range(16)]

    @staticmethod
    def _new_client():
        from snap7.client import Client
        from snap7.type import Parameter

        client = Client(auto_reconnect=False)
        for parameter in (Parameter.PingTimeout, Parameter.SendTimeout, Parameter.RecvTimeout):
            client.set_param(parameter, 1000)
        return client

    def start(self, *, background: bool = True) -> None:
        with self._lock:
            if self._started:
                return
            if self.mode != "simulation":
                try:
                    self._client = (self._client_factory or self._new_client)()
                    self._client.connect(self.ip, 0, 1, tcp_port=102)
                    if not self._client.get_connected():
                        raise OSError("S7 client did not establish a connection")
                    self.plc_connected = True
                    self.simulation_mode = False
                except Exception as exc:
                    self._disconnect()
                    self.last_error = str(exc)
                    if self.mode == "real":
                        raise PLCUnavailable(f"Unable to connect to PLC {self.ip}") from exc
                    self.simulation_mode = True
                    logger.warning("PLC unavailable at startup; running simulation: %s", exc)
            self._started = True
            self._stop.clear()
            if self.simulation_mode and background:
                self._thread = threading.Thread(target=self._scan_loop, name="ladder-simulator", daemon=True)
                self._thread.start()

    def _disconnect(self) -> None:
        if self._client is not None:
            try:
                self._client.disconnect()
            except Exception:
                pass
        self.plc_connected = False

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1)
            self._thread = None
        with self._lock:
            self._disconnect()
            self._started = False

    def _scan_loop(self) -> None:
        while not self._stop.wait(0.01):
            self.scan()

    def _require_started(self) -> None:
        if not self._started:
            raise PLCUnavailable("S7 service is not started")
        if not self.simulation_mode and not self.plc_connected:
            raise PLCUnavailable("PLC disconnected; operation was not replayed in simulation")

    def _io_failure(self, exc: Exception):
        self.last_error = str(exc)
        self._disconnect()
        raise PLCUnavailable("PLC communication failed; PLC write state may be uncertain") from exc

    def _read(self, start: int, size: int) -> bytearray:
        self._require_started()
        if self.simulation_mode:
            return self.db10[start:start + size]
        try:
            result = bytearray(self._client.db_read(DB_NUMBER, start, size))
            if len(result) != size:
                raise OSError("short DB10 read")
            return result
        except Exception as exc:
            self._io_failure(exc)

    def _write(self, start: int, data: bytearray) -> None:
        self._require_started()
        if self.simulation_mode:
            self.db10[start:start + len(data)] = data
        else:
            try:
                self._client.db_write(DB_NUMBER, start, data)
            except Exception as exc:
                self._io_failure(exc)

    def _write_bit(self, bit_address: int, value: bool) -> None:
        self._require_started()
        if self.simulation_mode:
            byte, bit = divmod(bit_address, 8)
            self.db10[byte] = (self.db10[byte] & ~(1 << bit)) | (int(value) << bit)
        else:
            from snap7.type import Area, WordLen

            try:
                # A protocol-level BIT write preserves PLC-owned ACKs even if
                # the PLC clears them concurrently with this command.
                self._client.write_area(Area.DB, DB_NUMBER, bit_address, bytearray([int(value)]), WordLen.Bit)
            except Exception as exc:
                self._io_failure(exc)

    def health(self) -> dict:
        with self._lock:
            return {"status": "ok", "plc_connected": self.plc_connected, "simulation_mode": self.simulation_mode}

    def telemetry(self) -> dict:
        with self._lock:
            raw = self._read(0, HEADER_SIZE)
            return {"plc_connected": self.plc_connected, **unpack_telemetry_db10(raw)}

    def deploy(self, payload: LadderProgramPayload) -> int:
        packed = pack_ladder_program(payload)
        count = len(validate_upload(packed))
        with self._lock:
            deadline = time.monotonic() + self._handshake_timeout
            while self._read(0, 1)[0] & (1 << NEW_PROGRAM):
                if time.monotonic() >= deadline:
                    raise DeploymentBusy("PLC has not acknowledged NewProgramReady")
                if self.simulation_mode:
                    self._scan_locked(self._clock())
                else:
                    time.sleep(0.01)
            self._write(HEADER_SIZE, packed)
            self._write_bit(NEW_PROGRAM, True)
        return count

    def set_input(self, index: int, value: bool) -> None:
        if type(index) is not int or not 0 <= index < 32 or type(value) is not bool:
            raise ValueError("input requires index 0..31 and a boolean value")
        with self._lock:
            self._write_bit(4 * 8 + index, value)

    def command(self, command: CommandPayload) -> None:
        with self._lock:
            # Request reset before enabling: an interleaved PLC scan must not
            # execute the previous program while reset is still unpublished.
            # False is not an ACK: only PLC scans clear a pending reset request.
            if command.reset:
                self._write_bit(RESET_ALL, True)
            self._write_bit(VIRTUAL_INPUTS, command.use_virtual_inputs)
            self._write_bit(ENGINE_ENABLE, command.enable)

    def _reset_timers(self) -> None:
        self._ton = [TimerState() for _ in range(16)]
        self._tof = [TimerState() for _ in range(16)]

    def scan(self, now: float | None = None) -> None:
        """One deterministic simulator scan; optional monotonic seconds aid tests."""
        with self._lock:
            self._require_started()
            if not self.simulation_mode:
                raise RuntimeError("scan() is only available in simulation")
            self._scan_locked(self._clock() if now is None else now)

    def _scan_locked(self, now: float) -> None:
        # Inputs are mirrored regardless of RUN/STOP/reset state.
        source = self.db10[4:8] if self.db10[0] & (1 << VIRTUAL_INPUTS) else self.physical_inputs
        self.db10[8:12] = source
        if self.db10[0] & (1 << RESET_ALL):
            self.db11[:] = bytes(UPLOAD_SIZE)
            self._program = []
            self.program_valid = True
            self.db10[2:4] = b"\x00\x00"
            self.db10[12:24] = bytes(12)
            self._reset_timers()
            self.db10[0] &= ~(1 << RESET_ALL)
            return  # Preserve NewProgramReady for the following scan.
        if self.db10[0] & (1 << NEW_PROGRAM):
            upload = self.db10[HEADER_SIZE:]
            self.db11[:] = upload
            count = next((slot for slot in range(200) if INSTRUCTION.unpack_from(upload, slot * 8)[0] == 0), 200)
            struct.pack_into(">h", self.db10, 2, count)
            try:
                program = validate_upload(upload)
            except ValueError as exc:
                self.last_error = str(exc)
                self._program = []
                self.program_valid = False
            else:
                self._program = program
                self.program_valid = True
            self._reset_timers()
            self.db10[0] &= ~(1 << NEW_PROGRAM)
        if not self.db10[0] & (1 << ENGINE_ENABLE) or not self.program_valid:
            self.db10[12:16] = bytes(4)
            self._reset_timers()
            return
        rlo = False
        for opcode, index, param in self._program:
            if opcode in (1, 2, 3, 4, 5, 6):
                offset = (8, 12, 16)[param]
                bit = bool(self.db10[offset + index // 8] & (1 << (index % 8)))
                if opcode in (2, 4, 6):
                    bit = not bit
                if opcode in (1, 2):
                    rlo = bit
                elif opcode in (3, 4):
                    rlo = rlo and bit
                else:
                    rlo = rlo or bit
            elif opcode in (10, 11, 12):
                offset = (8, 12, 16)[param] + index // 8
                mask = 1 << (index % 8)
                if opcode == 10 or rlo:
                    value = rlo if opcode == 10 else opcode == 11
                    self.db10[offset] = (self.db10[offset] & ~mask) | (int(value) * mask)
            else:
                state = (self._ton if opcode == 20 else self._tof)[index]
                preset = param / 1000
                if opcode == 20:
                    if not rlo:
                        state.started = None
                        state.q = False
                    else:
                        if state.started is None:
                            state.started = now
                        state.q = now - state.started >= preset
                else:
                    if rlo:
                        state.q = True
                        state.started = None
                    else:
                        if state.previous:
                            state.started = now
                        if state.started is not None:
                            state.q = now - state.started < preset
                state.previous = rlo
                rlo = state.q


@lru_cache(maxsize=1)
def get_s7_service() -> S7Service:
    return S7Service()
