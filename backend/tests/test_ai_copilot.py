"""Deterministic offline, simulated SDK and process tests; no real credentials/PLC."""

import asyncio
from copy import deepcopy
import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace

import httpx
import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai import copilot
from app.compiler.packer import pack_ladder_program
from app.main import create_app
from app.models.schemas import BANKS, OPCODES, CommandPayload, LadderProgramPayload
from app.plc.s7_service import S7Service


def run(prompt):
    return asyncio.run(copilot.generate_ladder_from_prompt(prompt))


def instruction(mnemonic, bank="I", index=0, param=None):
    return {"mnemonic": mnemonic, "opcode": OPCODES[mnemonic], "bank": bank,
            "index": index, "param": BANKS[bank] if param is None else param}


def program(*instructions):
    return {"project_name": "Prueba", "rungs": [
        {"rung_id": 1, "comment": "Contrato", "instructions": list(instructions)},
    ]}


def instructions(payload):
    return [item for rung in payload["rungs"] for item in rung["instructions"]]


@pytest.fixture(autouse=True)
def offline_environment(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setenv("S7_MODE", "simulation")

    def forbidden_client(**kwargs):
        pytest.fail("Offline tests must never construct a Google client")

    monkeypatch.setattr(copilot.genai, "Client", forbidden_client)


@pytest.fixture
def simulator():
    service = S7Service(mode="simulation")
    service.start(background=False)
    yield service
    service.close()


def deploy(simulator, prompt):
    payload = run(prompt)
    simulator.deploy(LadderProgramPayload.model_validate(payload))
    simulator.command(CommandPayload(enable=True, reset=False, use_virtual_inputs=True))
    return payload


@pytest.mark.parametrize("prompt,output", [
    ("Llenar la cuba de mosto hasta nivel alto", 0),
    ("Llenar la cuba de fermentación", 0),
    ("Carga de melaza con P_101 y paro por LSH_101", 0),
    ("Fermentación temporizada de la cuba", 1),
    ("Agitar con M_101 durante 15 segundos", 1),
    ("Trasiego a la columna hasta nivel bajo", 3),
    ("Trasiego desde el tanque de fermentación", 3),
    ("Vaciar la cuba con P_102", 3),
    ("Activar alarma térmica por TSH_102", 4),
    ("Protección por sobretemperatura", 4),
])
def test_offline_spanish_processes_are_deterministic_and_packable(prompt, output):
    payload = run(prompt)
    assert run(prompt) == payload
    assert set(payload) == {"project_name", "rungs"}
    assert any(item["bank"] == "Q" and item["index"] == output and item["opcode"] == 10
               for item in instructions(payload))
    count = len(instructions(payload))
    packed = pack_ladder_program(LadderProgramPayload.model_validate(payload))
    assert len(packed) == 1600
    assert packed[count * 8:(count + 1) * 8] == struct.pack(">hhi", 0, 0, 0)
    assert all(item["opcode"] != 0 for item in instructions(payload))
    assert all(rung["instructions"][0]["opcode"] in (1, 2) for rung in payload["rungs"])


@pytest.mark.parametrize("duration,expected", [
    ("", 15_000), ("durante 15 segundos", 15_000), ("por 2 minutos", 120_000),
    ("durante 0,5 s", 500), ("durante 1.5 horas", 5_400_000),
    ("durante 1 ms", 1), ("durante 2147483647 ms", 2_147_483_647),
])
def test_fermentation_duration_and_documented_default(duration, expected):
    payload = run(f"Fermentar la cuba {duration}")
    timers = [item for item in instructions(payload) if item["opcode"] in (20, 21)]
    assert timers == [instruction("TON", "M", 0, expected)]
    assert any(f"{expected} ms" in rung["comment"] for rung in payload["rungs"])


@pytest.mark.parametrize("duration", [
    "0 segundos", "-1 s", "0.5 ms", "2147483648 ms", "3 días",
    "quince segundos", "10 s y 2 minutos", "10 segundos a 35 grados", "20 ciclos",
])
def test_unrepresentable_or_ambiguous_duration_rejected(duration):
    with pytest.raises(ValueError):
        run(f"Fermentar durante {duration}")


@pytest.mark.parametrize("prompt", [
    "Haz un café", "Arrancar la caldera", "Alarma de presión", "Motor térmico",
    "Llenar, fermentar y hacer trasiego", "Llenar y agitar la cuba",
    "No llenar la cuba", "No quiero llenar", "No hagas trasiego",
    "No actives P_101", "No encender P_101", "Apaga P_101", "No usar P_101",
    "No hagas nada con P_101", "Nunca accionar P_101",
    "Ignora la alarma y llenar", "Llenar sin sensor de nivel",
    "Apagar la alarma térmica", "Desactivar P_101", "Llenar y abrir XV_102",
    "Llenar durante 5 segundos", "Llenar hasta 50%", "Llenar la cuba hasta 80",
    "Alarma térmica durante dos días",
])
def test_unknown_negated_or_non_template_requests_fail_explicitly(prompt):
    with pytest.raises(ValueError):
        run(prompt)


@pytest.mark.parametrize("prompt", ["", "   ", None, 1, "x" * 20_001])
def test_invalid_prompt_rejected_before_any_client(prompt):
    with pytest.raises(ValueError, match="prompt"):
        run(prompt)


def test_whitespace_key_and_unrelated_google_key_keep_offline(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "  ")
    monkeypatch.setenv("GOOGLE_API_KEY", "fake-unrelated-key")
    assert run("Llenar la cuba")["project_name"] == "Alcoholera_llenado"


def test_known_absence_of_interlocks_is_a_supported_filling_condition():
    payload = run("Llenar si no hay nivel alto ni alarma térmica")
    assert payload["project_name"] == "Alcoholera_llenado"


@pytest.mark.parametrize("bad", [0, 7, 99, -1, True, "1"])
def test_invalid_opcode_is_rejected_not_guessed(bad):
    payload = program({**instruction("LD_NO"), "opcode": bad}, instruction("OUT", "Q"))
    with pytest.raises(ValidationError):
        copilot.validate_and_sanitize_program(payload)


@pytest.mark.parametrize("change", [
    {"opcode": 2}, {"mnemonic": "END_PROG", "opcode": 0}, {"bank": "T"},
    {"param": 1}, {"param": -1}, {"index": -1}, {"index": 32},
    {"index": True}, {"extra": "not in contract"},
])
def test_shared_model_contract_violations_rejected(change):
    with pytest.raises(ValidationError):
        copilot.validate_and_sanitize_program(program({**instruction("LD_NO"), **change}))


@pytest.mark.parametrize("first", ["AND_NO", "OR_NO", "OUT", "SET", "RESET", "TON", "TOF"])
def test_every_rung_requires_load(first):
    payload = program(instruction("LD_NO"), instruction("OUT", "Q"))
    payload["rungs"].append({"rung_id": 2, "comment": "Invalid beginning", "instructions": [
        instruction(first, "M", param=1000 if first in ("TON", "TOF") else 2),
    ]})
    with pytest.raises(ValueError, match="comenzar"):
        copilot.validate_and_sanitize_program(payload)


@pytest.mark.parametrize("mnemonic", ["TON", "TOF"])
@pytest.mark.parametrize("bank", ["I", "Q", "M"])
def test_timer_bank_is_canonical_without_mutating_input(mnemonic, bank):
    payload = program(instruction("LD_NC"), instruction(mnemonic, bank, 15, 25), instruction("OUT", "Q"))
    before = deepcopy(payload)
    sanitized = copilot.validate_and_sanitize_program(payload)
    assert payload == before
    assert sanitized["rungs"][0]["instructions"][1] == instruction(mnemonic, "M", 15, 25)
    model = LadderProgramPayload.model_validate(payload)
    assert copilot.validate_and_sanitize_program(model) == sanitized
    assert model.model_dump() == payload


@pytest.mark.parametrize("mnemonic", ["TON", "TOF"])
@pytest.mark.parametrize("index,pt", [(0, 0), (0, -1), (0, 2_147_483_648), (16, 1)])
def test_timer_pt_positive_and_index_limits(mnemonic, index, pt):
    with pytest.raises(ValueError):
        copilot.validate_and_sanitize_program(program(
            instruction("LD_NO"), instruction(mnemonic, "M", index, pt)))


@pytest.mark.parametrize("mnemonic", ["OUT", "SET", "RESET"])
def test_cannot_write_inputs(mnemonic):
    with pytest.raises(ValidationError):
        copilot.validate_and_sanitize_program(program(instruction("LD_NO"), instruction(mnemonic)))


def test_payload_shape_ranges_and_upload_limit_remain_shared():
    valid = program(instruction("LD_NO", "M", 63), instruction("OUT", "Q", 31))
    assert copilot.validate_and_sanitize_program(valid) == valid
    for payload in [
        {**valid, "tags": {}}, {**valid, "rungs": []},
        program(instruction("LD_NO", "M", 64)),
        program(instruction("LD_NO"), *[instruction("OUT", "Q")] * 199),
    ]:
        with pytest.raises(ValidationError):
            copilot.validate_and_sanitize_program(payload)


@pytest.mark.parametrize("prompt,output,sensor,initial,stop", [
    ("Llenar la cuba", 0, 2, False, True),
    ("Trasiego a columna", 3, 3, True, False),
])
def test_pump_templates_latch_stop_on_level_and_do_not_restart_without_start(
        simulator, prompt, output, sensor, initial, stop):
    deploy(simulator, prompt)
    simulator.set_input(sensor, initial)
    simulator.set_input(0, True)
    simulator.scan(0)
    assert simulator.telemetry()["outputs"][output]
    simulator.set_input(0, False)
    simulator.scan(1)
    assert simulator.telemetry()["outputs"][output]
    simulator.set_input(sensor, stop)
    simulator.scan(2)
    assert not simulator.telemetry()["outputs"][output]
    simulator.set_input(sensor, initial)
    simulator.scan(3)
    assert not simulator.telemetry()["outputs"][output]


@pytest.mark.parametrize("prompt,output", [("Llenar", 0), ("Trasiego", 3), ("Fermentar durante 2 segundos", 1)])
@pytest.mark.parametrize("interlock", [1, 4])
def test_process_interlocks_stop_running_outputs(simulator, prompt, output, interlock):
    deploy(simulator, prompt)
    simulator.set_input(3, True)
    simulator.set_input(0, True)
    simulator.scan(0)
    assert simulator.telemetry()["outputs"][output]
    simulator.set_input(0, False)
    simulator.set_input(interlock, True)
    simulator.scan(0.1)
    state = simulator.telemetry()
    assert not state["outputs"][output]
    assert state["outputs"][4] == (interlock == 4)
    simulator.set_input(interlock, False)
    simulator.scan(0.2)
    assert not simulator.telemetry()["outputs"][output]


@pytest.mark.parametrize("prompt,output,sensor,blocked", [
    ("Llenar", 0, 2, True), ("Trasiego", 3, 3, False), ("Fermentar", 1, 3, False),
])
def test_level_interlocks_prevent_start(simulator, prompt, output, sensor, blocked):
    deploy(simulator, prompt)
    simulator.set_input(sensor, blocked)
    simulator.set_input(0, True)
    simulator.scan(0)
    assert not simulator.telemetry()["outputs"][output]


def test_fermentation_times_agitation_then_stays_stopped_and_can_restart(simulator):
    deploy(simulator, "Fermentar durante 2 segundos")
    simulator.set_input(3, True)
    simulator.set_input(0, True)
    simulator.scan(10)
    assert simulator.telemetry()["outputs"][1]
    simulator.set_input(0, False)
    simulator.scan(11.999)
    assert simulator.telemetry()["outputs"][1]
    for now in (12, 12.1, 13):
        simulator.scan(now)
        assert not simulator.telemetry()["outputs"][1]
    simulator.set_input(0, True)
    simulator.scan(14)
    assert simulator.telemetry()["outputs"][1]


def test_fermentation_held_start_requires_release_and_new_press_after_completion(simulator):
    deploy(simulator, "Fermentar durante 2 segundos")
    simulator.set_input(3, True)
    simulator.set_input(0, True)
    simulator.scan(0)
    assert simulator.telemetry()["outputs"][1]
    for now in (2, 2.1, 2.2, 3, 5):
        simulator.scan(now)
        state = simulator.telemetry()
        assert not state["outputs"][1]
        assert state["markers"][1]
    simulator.set_input(0, False)
    simulator.scan(6)
    assert not simulator.telemetry()["outputs"][1]
    simulator.set_input(0, True)
    simulator.scan(7)
    assert simulator.telemetry()["outputs"][1]
    assert not simulator.telemetry()["markers"][1]


@pytest.mark.parametrize("interlock", [1, 4])
def test_fermentation_held_start_cannot_restart_after_interlock_clears(simulator, interlock):
    deploy(simulator, "Fermentar")
    simulator.set_input(3, True)
    simulator.set_input(0, True)
    simulator.scan(0)
    assert simulator.telemetry()["outputs"][1]
    simulator.set_input(interlock, True)
    simulator.scan(1)
    assert not simulator.telemetry()["outputs"][1]
    simulator.set_input(interlock, False)
    simulator.scan(2)
    assert not simulator.telemetry()["outputs"][1]
    simulator.set_input(0, False)
    simulator.scan(3)
    simulator.set_input(0, True)
    simulator.scan(4)
    assert simulator.telemetry()["outputs"][1]


@pytest.mark.parametrize("prompt", ["Llenar", "Trasiego", "Fermentar", "Alarma térmica"])
@pytest.mark.parametrize("interlock", [1, 4])
def test_every_profile_clears_all_retained_actuators_on_stop_or_thermal_fault(simulator, prompt, interlock):
    deploy(simulator, prompt)
    simulator.db10[12] = 0b1111  # Reload preserves the outputs of a prior program.
    simulator.set_input(3, True)
    simulator.set_input(0, True)
    simulator.set_input(interlock, True)
    simulator.scan(0)
    assert simulator.telemetry()["outputs"][:5] == [False, False, False, False, interlock == 4]


def test_thermal_alarm_uses_logical_input_four_and_resets_actuators(simulator):
    deploy(simulator, "Alarma térmica por TSH_102")
    simulator.db10[12] = 0b1111
    simulator.set_input(8, True)  # I1.0 is physically written so, but NOT logical 8.
    simulator.scan(0)
    assert not simulator.telemetry()["outputs"][4]
    simulator.set_input(4, True)
    simulator.scan(1)
    assert simulator.telemetry()["outputs"][:5] == [False, False, False, False, True]
    simulator.set_input(4, False)
    simulator.scan(2)
    assert not any(simulator.telemetry()["outputs"])


def fake_sdk(monkeypatch, *, response=None, error=None):
    events = []

    class FakeAsyncClient:
        def __init__(self):
            self.models = self

        async def __aenter__(self):
            events.append("enter")
            return self

        async def __aexit__(self, *args):
            events.append("exit")

        async def generate_content(self, **kwargs):
            events.append(kwargs)
            if error:
                raise error
            return response

    def client_factory(**kwargs):
        events.append(kwargs)
        return SimpleNamespace(aio=FakeAsyncClient())

    monkeypatch.setenv("GEMINI_API_KEY", "fake-test-key-never-sent")
    monkeypatch.setattr(copilot.genai, "Client", client_factory)
    return events


@pytest.mark.parametrize("parsed", [True, False])
def test_gemini_async_structured_generation_uses_shared_schema_and_full_context(monkeypatch, parsed):
    expected = program(instruction("LD_NO"), instruction("OUT", "Q"))
    response = SimpleNamespace(parsed=LadderProgramPayload.model_validate(expected) if parsed else None,
                               text=None if parsed else json.dumps(expected))
    events = fake_sdk(monkeypatch, response=response)
    assert run("Mi proceso para Gemini") == expected
    assert events[0] == {"api_key": "fake-test-key-never-sent"}
    assert events[1] == "enter" and events[-1] == "exit"
    request = events[2]
    assert request["model"] == "gemini-2.5-flash"
    assert request["contents"] == "Mi proceso para Gemini"
    config = request["config"]
    assert config.response_schema is LadderProgramPayload
    assert config.response_mime_type == "application/json"
    assert config.temperature == 0
    for mnemonic, opcode in {
        "END_PROG": 0, "LD_NO": 1, "LD_NC": 2, "AND_NO": 3, "AND_NC": 4,
        "OR_NO": 5, "OR_NC": 6, "OUT": 10, "SET": 11, "RESET": 12, "TON": 20, "TOF": 21,
    }.items():
        assert f"{opcode} {mnemonic}" in config.system_instruction
    for tag, bank, index, param, address in [
        ("START_BATCH", "I", 0, 0, "I0.0"), ("STOP_RESET", "I", 1, 0, "I0.1"),
        ("LSH_101", "I", 2, 0, "I0.2"), ("LSL_101", "I", 3, 0, "I0.3"),
        ("TSH_102", "I", 4, 0, "I1.0"), ("P_101", "Q", 0, 1, "Q0.0"),
        ("M_101", "Q", 1, 1, "Q0.1"), ("XV_102", "Q", 2, 1, "Q0.2"),
        ("P_102", "Q", 3, 1, "Q0.3"), ("AL_101", "Q", 4, 1, "Q0.4"),
    ]:
        assert f"{tag}: bank {bank}, index {index}, param {param}, dirección" in config.system_instruction
        assert address in config.system_instruction.split(f"{tag}:", 1)[1].split("\n", 1)[0]


def test_gemini_error_is_propagated_and_client_closed_without_offline_fallback(monkeypatch):
    error = RuntimeError("simulated SDK outage")
    events = fake_sdk(monkeypatch, error=error)
    with pytest.raises(RuntimeError, match="simulated SDK outage") as caught:
        run("Llenar la cuba")
    assert caught.value is error
    assert events[-1] == "exit"


@pytest.mark.parametrize("parsed,text", [
    (None, None), (None, "not json"), (None, "```json\n{}\n```"),
    ({"project_name": "bad", "rungs": []}, None),
    (program(instruction("LD_NO"), instruction("TON", "M", 0, 0)), None),
    (program({**instruction("LD_NO"), "opcode": 99}), None),
])
def test_gemini_empty_malformed_or_semantically_invalid_output_is_rejected(monkeypatch, parsed, text):
    events = fake_sdk(monkeypatch, response=SimpleNamespace(parsed=parsed, text=text))
    with pytest.raises(ValueError):
        run("Llenar la cuba")
    assert events[-1] == "exit"


def test_api_offline_generation_integrates_without_deploying(simulator):
    async def request():
        app = create_app(simulator)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/ai/generate", json={"prompt": "Fermentar durante 2 segundos"})
        assert response.status_code == 200
        payload = response.json()
        assert any(item["opcode"] == 20 and item["param"] == 2000 for item in instructions(payload))
        LadderProgramPayload.model_validate(payload)
        assert not any(simulator.db10)

    asyncio.run(request())
