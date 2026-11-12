"""Offline contract tests. No test constructs a real network-connected client."""

import itertools
import os
from pathlib import Path
import struct
import sys
import threading
import time
import types

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["S7_MODE"] = "simulation"

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from app.compiler.packer import DB10_SIZE, pack_ladder_program, unpack_telemetry_db10
from app.main import create_app
from app.models.schemas import CommandPayload, LadderProgramPayload, OPCODES, TelemetryPayload
from app.plc.s7_service import DeploymentBusy, PLCUnavailable, S7Service


def instruction(mnemonic, index=0, bank="I", param=None):
    return {"mnemonic": mnemonic, "opcode": OPCODES[mnemonic], "bank": bank,
            "index": index, "param": {"I": 0, "Q": 1, "M": 2}[bank] if param is None else param}


def program(*instructions):
    return LadderProgramPayload.model_validate({
        "project_name": "Prueba", "rungs": [{"rung_id": 1, "comment": "Contrato", "instructions": list(instructions)}],
    })


def command(*, enable=True, reset=False, virtual=True):
    return CommandPayload(enable=enable, reset=reset, use_virtual_inputs=virtual)


@pytest.fixture
def simulator():
    service = S7Service(mode="simulation")
    service.start(background=False)
    yield service
    service.close()


@pytest.fixture
def api(simulator):
    with TestClient(create_app(simulator)) as client:
        yield client, simulator


def test_exact_big_endian_bytes_all_twelve_opcodes_and_padding():
    payload = program(
        instruction("LD_NO", 0), instruction("LD_NC", 31),
        instruction("AND_NO", 63, "M"), instruction("AND_NC", 1, "Q"),
        instruction("OR_NO", 8), instruction("OR_NC", 32, "M"),
        instruction("OUT", 31, "Q"), instruction("SET", 63, "M"),
        instruction("RESET", 0, "Q"), instruction("TON", 15, "M", 15000),
        instruction("TOF", 0, "M", 2_147_483_647),
    )
    packed = pack_ladder_program(payload)
    assert isinstance(packed, bytearray)
    assert len(packed) == 1600
    assert packed[:96] == bytes.fromhex(
        "0001000000000000 0002001f00000000 0003003f00000002 "
        "0004000100000001 0005000800000000 0006002000000002 "
        "000a001f00000001 000b003f00000002 000c000000000001 "
        "0014000f00003a98 001500007fffffff 0000000000000000"
    )
    assert packed[96:] == bytes(1504)


def test_flatten_rungs_and_199_instruction_boundary():
    payload = program(*[instruction("LD_NO")] * 199)
    packed = pack_ladder_program(payload)
    assert packed[198 * 8:199 * 8] == bytes.fromhex("0001000000000000")
    assert packed[199 * 8:] == bytes(8)
    raw = payload.model_dump()
    raw["rungs"].append({"rung_id": 2, "comment": "overflow", "instructions": [instruction("OUT", bank="Q")]})
    with pytest.raises(ValidationError, match="199"):
        LadderProgramPayload.model_validate(raw)
    raw["rungs"][0]["instructions"] = [instruction("LD_NO")]
    packed = pack_ladder_program(LadderProgramPayload.model_validate(raw))
    assert packed[:24] == bytes.fromhex("0001000000000000 000a000000000001 0000000000000000")


@pytest.mark.parametrize("change", [
    {"mnemonic": "END_PROG", "opcode": 0}, {"opcode": 99}, {"index": 32},
    {"index": -1}, {"index": True}, {"param": 1}, {"bank": "T"},
    {"param": -1}, {"param": 2_147_483_648}, {"extra": "field"},
])
def test_invalid_instruction_rejected(change):
    with pytest.raises(ValidationError):
        program({**instruction("LD_NO"), **change})


@pytest.mark.parametrize("inst", [
    instruction("OUT"), instruction("SET"), instruction("RESET"),
    instruction("LD_NO", 64, "M"), instruction("OUT", 32, "Q"),
    instruction("TON", 16, "M", 1), instruction("TOF", 0, "M", -1),
])
def test_bank_and_timer_limits_rejected(inst):
    with pytest.raises(ValidationError):
        program(inst)


def test_timer_zero_and_ignored_bank_and_packer_revalidation():
    payload = program(instruction("TON", 15, "I", 0))
    assert pack_ladder_program(payload)[:8] == bytes.fromhex("0014000f00000000")
    payload.rungs[0].instructions[0].index = 16
    with pytest.raises(ValidationError):
        pack_ladder_program(payload)


def test_telemetry_exact_offsets_and_s7_bit_order():
    raw = bytearray(1624)
    raw[:8] = bytes.fromhex("ff7e00c880000001")
    raw[8:12] = bytes.fromhex("81000280")
    raw[12:16] = bytes.fromhex("02800001")
    raw[16:24] = bytes.fromhex("0100008000000080")
    decoded = unpack_telemetry_db10(raw)
    assert decoded["active_instructions"] == 200
    assert [i for i, bit in enumerate(decoded["inputs"]) if bit] == [0, 7, 17, 31]
    assert [i for i, bit in enumerate(decoded["outputs"]) if bit] == [1, 15, 24]
    assert [i for i, bit in enumerate(decoded["markers"]) if bit] == [0, 31, 63]
    TelemetryPayload.model_validate({"plc_connected": True, **decoded})
    with pytest.raises(ValueError, match="24"):
        unpack_telemetry_db10(bytes(23))


@pytest.mark.parametrize("mnemonic", ["LD_NO", "LD_NC", "AND_NO", "AND_NC", "OR_NO", "OR_NC"])
@pytest.mark.parametrize("initial,operand", list(itertools.product([False, True], repeat=2)))
def test_all_contact_truth_tables(simulator, mnemonic, initial, operand):
    simulator.deploy(program(instruction("LD_NO", 0), instruction(mnemonic, 1), instruction("OUT", 31, "Q")))
    simulator.command(command())
    simulator.set_input(0, initial)
    simulator.set_input(1, operand)
    simulator.scan(0)
    bit = not operand if mnemonic.endswith("NC") else operand
    expected = bit if mnemonic.startswith("LD") else (initial and bit if mnemonic.startswith("AND") else initial or bit)
    assert simulator.telemetry()["outputs"][31] == expected


def test_out_set_reset_and_marker_output_contacts(simulator):
    simulator.deploy(program(
        instruction("LD_NO", 0), instruction("SET", 63, "M"),
        instruction("LD_NO", 63, "M"), instruction("OUT", 31, "Q"),
        instruction("LD_NO", 31, "Q"), instruction("SET", 0, "Q"),
        instruction("LD_NO", 1), instruction("RESET", 63, "M"), instruction("RESET", 0, "Q"),
    ))
    simulator.command(command())
    simulator.set_input(0, True)
    simulator.scan(0)
    assert simulator.telemetry()["markers"][63]
    assert simulator.telemetry()["outputs"][0]
    simulator.set_input(0, False)
    simulator.scan(1)
    assert simulator.telemetry()["outputs"][0]  # SET holds through false RLO.
    simulator.set_input(1, True)
    simulator.scan(2)
    assert not simulator.telemetry()["outputs"][0]
    assert not simulator.telemetry()["markers"][63]
    simulator.scan(3)
    assert not simulator.telemetry()["outputs"][31]


def test_ton_delay_false_reset_and_pt_zero(simulator):
    simulator.deploy(program(instruction("LD_NO"), instruction("TON", 15, "M", 1000), instruction("OUT", bank="Q")))
    simulator.command(command())
    simulator.set_input(0, True)
    for now, expected in [(100, False), (100.999, False), (101, True)]:
        simulator.scan(now)
        assert simulator.telemetry()["outputs"][0] == expected
    simulator.set_input(0, False)
    simulator.scan(102)
    assert not simulator.telemetry()["outputs"][0]
    simulator.set_input(0, True)
    simulator.scan(103)
    assert not simulator.telemetry()["outputs"][0]
    simulator.deploy(program(instruction("LD_NO"), instruction("TON", 15, "M", 0), instruction("OUT", bank="Q")))
    simulator.scan(104)
    assert simulator.telemetry()["outputs"][0]


def test_tof_falling_edge_retrigger_and_zero(simulator):
    simulator.deploy(program(instruction("LD_NO"), instruction("TOF", 15, "M", 1000), instruction("OUT", bank="Q")))
    simulator.command(command())
    simulator.scan(0)
    assert not simulator.telemetry()["outputs"][0]
    simulator.set_input(0, True)
    simulator.scan(1)
    assert simulator.telemetry()["outputs"][0]
    simulator.set_input(0, False)
    for now, expected in [(2, True), (2.999, True), (3, False)]:
        simulator.scan(now)
        assert simulator.telemetry()["outputs"][0] == expected
    simulator.set_input(0, True)
    simulator.scan(4)
    simulator.set_input(0, False)
    simulator.scan(5)
    simulator.set_input(0, True)
    simulator.scan(5.5)
    simulator.set_input(0, False)
    simulator.scan(6)
    assert simulator.telemetry()["outputs"][0]
    simulator.deploy(program(instruction("LD_NO"), instruction("TOF", 15, "M", 0), instruction("OUT", bank="Q")))
    simulator.scan(7)
    assert not simulator.telemetry()["outputs"][0]


def test_stop_preserves_active_program_and_markers_but_clears_q_timers(simulator):
    simulator.deploy(program(instruction("LD_NO"), instruction("SET", 63, "M"), instruction("TON", 0, "M", 1000), instruction("OUT", bank="Q")))
    simulator.command(command())
    simulator.set_input(0, True)
    simulator.scan(0)
    simulator.scan(1)
    saved = bytes(simulator.db11)
    assert simulator.telemetry()["outputs"][0]
    simulator.command(command(enable=False))
    simulator.scan(2)
    state = simulator.telemetry()
    assert state["active_instructions"] == 4
    assert state["markers"][63] and not any(state["outputs"])
    assert bytes(simulator.db11) == saved
    simulator.command(command())
    simulator.scan(3)
    assert not simulator.telemetry()["outputs"][0]
    simulator.scan(4)
    assert simulator.telemetry()["outputs"][0]


def test_reload_preserves_q_m_resets_timers_and_reset_has_scan_priority(simulator):
    simulator.command(command())
    simulator.set_input(0, True)
    simulator.deploy(program(instruction("LD_NO"), instruction("SET", 63, "M"), instruction("SET", 0, "Q")))
    simulator.scan(0)
    simulator.deploy(program(instruction("LD_NO"), instruction("TON", 0, "M", 1000), instruction("OUT", 1, "Q")))
    simulator.scan(1)
    assert simulator.telemetry()["outputs"][0] and simulator.telemetry()["markers"][63]
    simulator.scan(2)
    assert simulator.telemetry()["outputs"][1]
    simulator.deploy(program(instruction("LD_NO"), instruction("TON", 0, "M", 1000), instruction("OUT", 1, "Q")))
    simulator.scan(3)
    assert not simulator.telemetry()["outputs"][1]
    simulator.deploy(program(instruction("LD_NO"), instruction("SET", 2, "Q")))
    pending = bytes(simulator.db10[24:])
    simulator.command(command(reset=True))
    simulator.scan(4)
    assert simulator.db10[0] == 0b1011  # NewProgramReady, RUN and virtual preserved.
    assert bytes(simulator.db11) == bytes(1600)
    assert simulator.db10[4] == 1 and bytes(simulator.db10[24:]) == pending
    reset_state = simulator.telemetry()
    assert reset_state["active_instructions"] == 0
    assert not any(reset_state["outputs"]) and not any(reset_state["markers"])
    simulator.scan(5)
    assert simulator.db10[0] == 0b1010
    assert simulator.telemetry()["outputs"][2]
    assert simulator.telemetry()["active_instructions"] == 2


def test_physical_inputs_and_virtual_bit_boundaries(simulator):
    for index in (0, 7, 8, 31):
        simulator.set_input(index, True)
    assert simulator.db10[4:8] == bytes.fromhex("81010080")
    simulator.set_input(7, False)
    assert simulator.db10[4:8] == bytes.fromhex("01010080")
    simulator.physical_inputs[0] = 2
    simulator.command(command(enable=False, virtual=False))
    simulator.scan(0)
    assert simulator.telemetry()["inputs"][1]
    assert not simulator.telemetry()["inputs"][0]
    simulator.command(command(enable=False))
    simulator.scan(1)
    assert simulator.telemetry()["inputs"][31]


@pytest.mark.parametrize("kind", ["unknown", "late_invalid", "bad_end", "missing_end", "input_coil", "timer_index", "timer_pt"])
def test_corrupt_upload_inhibits_entire_program_before_any_side_effect(simulator, kind):
    image = bytearray(1600)
    struct.pack_into(">hhi", image, 0, 1, 0, 0)
    struct.pack_into(">hhi", image, 8, 11, 1, 2)  # Would mutate M1 if validation were incremental.
    bad = {"unknown": (99, 0, 0), "late_invalid": (10, 32, 1),
           "input_coil": (10, 0, 0), "timer_index": (20, 16, 1),
           "timer_pt": (21, 0, -1)}
    if kind in bad:
        struct.pack_into(">hhi", image, 16, *bad[kind])
        count = 3
    elif kind == "bad_end":
        struct.pack_into(">hhi", image, 16, 0, 1, 0)
        count = 2
    else:
        image[:] = struct.pack(">hhi", 1, 0, 0) * 200
        count = 200
    simulator.db10[16] = 1  # Existing M0 must survive invalid loading.
    simulator.db10[12] = 1
    simulator.db10[24:] = image
    simulator.db10[0] = 0b1011
    simulator.set_input(0, True)
    simulator.scan(0)
    state = simulator.telemetry()
    assert not simulator.program_valid and state["active_instructions"] == count
    assert simulator.db11 == image
    assert not simulator.db10[0] & 1
    assert state["markers"][0] and not state["markers"][1]
    assert not any(state["outputs"])


class FakeS7Client:
    def __init__(self):
        self.memory = bytearray(DB10_SIZE)
        self.events = []
        self.connected = False
        self.clear_ack_on_read = False
        self.clear_ack_on_bit_write = False
        self.fail_write = False
        self.fail_ready = False
        self.fail_read = False

    def connect(self, ip, rack, slot, tcp_port):
        self.events.append(("connect", ip, rack, slot, tcp_port))
        self.connected = True

    def get_connected(self):
        return self.connected

    def disconnect(self):
        self.connected = False

    def db_read(self, db, start, size):
        self.events.append(("read", db, start, size))
        if self.fail_read:
            raise OSError("cable disconnected during read")
        result = self.memory[start:start + size]
        if self.clear_ack_on_read:
            self.memory[0] &= ~1
            self.clear_ack_on_read = False
        return result

    def db_write(self, db, start, data):
        self.events.append(("write", db, start, bytes(data)))
        if self.fail_write:
            raise OSError("cable disconnected during write")
        self.memory[start:start + len(data)] = data

    def write_area(self, area, db, start, data, word_len):
        self.events.append(("bit", int(area), db, start, bytes(data), int(word_len)))
        if self.fail_write or (self.fail_ready and start == 0):
            raise OSError("cable disconnected during bit write")
        if self.clear_ack_on_bit_write:
            # Emulate the PLC consuming both ACKs between an earlier read and
            # the command. An unsafe byte RMW would bring them back.
            self.memory[0] &= ~0b101
            self.clear_ack_on_bit_write = False
        byte, bit = divmod(start, 8)
        self.memory[byte] = (self.memory[byte] & ~(1 << bit)) | ((data[0] & 1) << bit)


@pytest.fixture
def real_fake():
    client = FakeS7Client()
    service = S7Service(mode="real", client_factory=lambda: client, handshake_timeout=0.03)
    service.start(background=False)
    yield service, client
    service.close()


def test_s7_connection_defaults_handshake_order_and_owned_write_ranges(real_fake):
    service, client = real_fake
    assert client.events[0] == ("connect", "192.168.56.101", 0, 1, 102)
    client.memory[0] = 0b1111
    client.clear_ack_on_read = True
    payload = program(instruction("LD_NO"), instruction("OUT", bank="Q"))
    service.deploy(payload)
    assert [event[0] for event in client.events[1:]] == ["read", "read", "write", "bit"]
    assert client.events[-2] == ("write", 10, 24, bytes(pack_ladder_program(payload)))
    assert client.events[-1] == ("bit", 132, 10, 0, b"\x01", 1)
    assert client.memory[0] == 0b1111
    assert client.memory[2:24] == bytes(22)


def test_s7_busy_handshake_never_overwrites_upload(real_fake):
    service, client = real_fake
    client.memory[0] = 1
    client.memory[24:] = b"x" * 1600
    with pytest.raises(DeploymentBusy):
        service.deploy(program(instruction("LD_NO")))
    assert client.memory[24:] == b"x" * 1600
    assert not any(event[0] in ("write", "bit") for event in client.events)


def test_s7_bit_commands_do_not_resurrect_consumed_acks_and_reset_precedes_run(real_fake):
    service, client = real_fake
    client.memory[0] = 0b11110101
    client.db_read(10, 0, 1)
    client.clear_ack_on_bit_write = True
    service.command(command())
    assert client.memory[0] == 0b11111010
    assert [event[3] for event in client.events if event[0] == "bit"] == [3, 1]
    client.events.clear()
    service.command(command(reset=True))
    assert [event[3] for event in client.events] == [2, 3, 1]
    service.set_input(31, True)
    assert client.memory[7] == 128
    assert client.events[-1][3] == 63


def test_s7_write_failure_is_503_and_never_replayed_in_ram(real_fake):
    service, client = real_fake
    client.fail_write = True
    with TestClient(create_app(service)) as api:
        response = api.post("/api/plc/deploy", json=program(instruction("LD_NO")).model_dump())
        assert response.status_code == 503
        assert "uncertain" in response.json()["detail"]
        assert api.get("/api/health").json() == {"status": "ok", "plc_connected": False, "simulation_mode": False}
        assert api.post("/api/plc/input", json={"index": 0, "value": True}).status_code == 503
    assert not any(service.db10)


def test_s7_failure_after_upload_before_ready_reports_uncertainty(real_fake):
    service, client = real_fake
    client.fail_ready = True
    payload = program(instruction("LD_NO"), instruction("OUT", bank="Q"))
    with pytest.raises(PLCUnavailable, match="uncertain"):
        service.deploy(payload)
    assert client.memory[24:] == pack_ladder_program(payload)
    assert client.memory[0] == 0
    assert not service.plc_connected and not service.simulation_mode
    assert not any(service.db10)
    with pytest.raises(PLCUnavailable):
        service.deploy(payload)


def test_ws_reports_read_failure_by_closing_with_1011(real_fake):
    service, client = real_fake
    client.fail_read = True
    with TestClient(create_app(service)) as api:
        with api.websocket_connect("/ws/telemetry") as websocket:
            with pytest.raises(WebSocketDisconnect) as closed:
                websocket.receive_json()
            assert closed.value.code == 1011
        assert not service.plc_connected and not service.simulation_mode


def test_api_busy_handshake_is_409(real_fake):
    service, client = real_fake
    client.memory[0] = 1
    with TestClient(create_app(service)) as api:
        response = api.post("/api/plc/deploy", json=program(instruction("LD_NO")).model_dump())
        assert response.status_code == 409
        assert not any(client.memory[24:])


def test_auto_falls_back_only_at_start_and_forced_simulation_never_builds_client():
    calls = []

    def unreachable():
        calls.append(True)
        raise OSError("unreachable fake")

    automatic = S7Service(mode="auto", client_factory=unreachable)
    automatic.start(background=False)
    assert automatic.simulation_mode and not automatic.plc_connected
    assert len(calls) == 1
    automatic.close()
    forced = S7Service(mode="simulation", client_factory=unreachable)
    forced.start(background=False)
    assert len(calls) == 1
    forced.close()
    required = S7Service(mode="real", client_factory=unreachable)
    with pytest.raises(PLCUnavailable):
        required.start(background=False)
    assert not required.simulation_mode


def test_concurrent_input_updates_are_serialized(simulator):
    threads = [threading.Thread(target=simulator.set_input, args=(index, True)) for index in range(32)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert simulator.db10[4:8] == b"\xff" * 4


def test_api_health_deploy_input_commands_ws_and_cors(api):
    client, service = api
    assert client.get("/api/health").json() == {"status": "ok", "plc_connected": False, "simulation_mode": True}
    payload = program(instruction("LD_NO"), instruction("OUT", bank="Q")).model_dump()
    assert client.post("/api/plc/deploy", json=payload).json() == {"status": "ok", "instructions": 2}
    assert client.post("/api/plc/input", json={"index": 0, "value": True}).status_code == 200
    assert client.post("/api/plc/command", json=command().model_dump()).status_code == 200
    service.scan(0)
    with client.websocket_connect("/ws/telemetry") as websocket:
        first = websocket.receive_json()
        start = time.monotonic()
        second = websocket.receive_json()
        assert time.monotonic() - start >= 0.07
    assert first == second
    assert first["inputs"][0] and first["outputs"][0] and first["active_instructions"] == 2
    assert (len(first["inputs"]), len(first["outputs"]), len(first["markers"])) == (32, 32, 64)
    response = client.options("/api/plc/input", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    assert client.post("/api/plc/command", json=command(enable=False).model_dump()).status_code == 200
    service.scan(1)
    assert not any(service.telemetry()["outputs"])
    assert client.post("/api/plc/command", json=command(reset=True).model_dump()).status_code == 200
    service.scan(2)
    assert service.telemetry()["active_instructions"] == 0


@pytest.mark.parametrize("path,payload", [
    ("/api/plc/input", {"index": 32, "value": True}),
    ("/api/plc/input", {"index": 0, "value": 1}),
    ("/api/plc/command", {"enable": True}),
    ("/api/plc/deploy", {"project_name": "bad", "rungs": []}),
    ("/api/ai/generate", {"prompt": ""}),
])
def test_invalid_api_requests_are_422_without_writes(api, path, payload):
    client, service = api
    assert client.post(path, json=payload).status_code == 422
    assert not any(service.db10)


def test_ai_empty_module_fallback_async_success_and_invalid_response(api, monkeypatch):
    client, service = api
    module = types.ModuleType("app.ai.copilot")
    monkeypatch.setitem(sys.modules, "app.ai.copilot", module)
    assert client.post("/api/ai/generate", json={"prompt": "start pump"}).status_code == 503
    expected = program(instruction("LD_NO"), instruction("OUT", bank="Q")).model_dump()
    calls = []

    async def generate(prompt):
        calls.append(prompt)
        return expected

    module.generate_ladder_from_prompt = generate
    response = client.post("/api/ai/generate", json={"prompt": "start pump"})
    assert response.status_code == 200 and response.json() == expected
    assert calls == ["start pump"]
    assert not any(service.db10)  # Generating never deploys.

    async def bad(prompt):
        return {"project_name": "bad", "rungs": []}

    module.generate_ladder_from_prompt = bad
    assert client.post("/api/ai/generate", json={"prompt": "bad"}).status_code == 502


def test_background_simulation_runs_without_telemetry_readers():
    service = S7Service(mode="simulation")
    service.start()
    try:
        service.deploy(program(instruction("LD_NO"), instruction("OUT", bank="Q")))
        service.command(command())
        service.set_input(0, True)
        deadline = time.monotonic() + 1
        while not service.db10[12] & 1 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert service.telemetry()["outputs"][0]
    finally:
        service.close()
