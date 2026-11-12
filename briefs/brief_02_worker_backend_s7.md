# Brief de Misión: Worker 02 — Ingeniero Backend Python, Compilador Binario y Snap7

## 1. Tu Identidad y Entorno de Trabajo
* **Rol:** Arquitecto Backend Python & Especialista en Protocolo S7 (`python-snap7` / FastAPI).
* **Worktree asignado:** `.worktrees/worker-02-backend-s7` (Rama: `feat/backend-s7-core`).
* **Perímetro estricto de escritura:** Solo puedes crear o modificar archivos en:
  * `backend/requirements.txt`
  * `backend/app/main.py`
  * `backend/app/models/**`
  * `backend/app/compiler/**`
  * `backend/app/plc/**`
  * `backend/tests/test_packer_and_api.py`
  * **PROHIBIDO** escribir dentro de `backend/app/ai/` (pertenece al Worker 03). Para el endpoint `POST /api/ai/generate`, haz un import condicional `from app.ai.copilot import generate_ladder_from_prompt` con un fallback limpio por si la rama del Worker 03 aún no ha sido fusionada.

## 2. Tus Entregables Exactos
1. `backend/app/models/schemas.py`: Modelos Pydantic v2 que implementen exactamente el Contrato 4.1, 4.2 y 4.3 de `CONTRACT.md`.
2. `backend/app/compiler/packer.py`:
   * Función `pack_ladder_program(payload: LadderProgramPayload) -> bytearray` que aplane las instrucciones de todos los peldaños, agregue al final la instrucción de cierre (`OpCode=0, OperandIdx=0, Param=0`), rellene hasta 200 instrucciones (o empaquete las activas + cierre) usando `struct.pack('>hhi', inst.opcode, inst.index, inst.param)` (Big-Endian estricto).
   * Función inversa `unpack_telemetry_db10(raw_bytes: bytes) -> dict` que decodifique los primeros 24 bytes de `DB10` según la tabla de offsets 2.3 de `CONTRACT.md` (extrayendo los bits de `InputsState` en offset 8, `OutputsState` en offset 12, `MarkersState` en offset 16 y `ActiveInstructions` en offset 2).
3. `backend/app/plc/s7_service.py`:
   * Clase singleton que gestione la conexión con `python-snap7` hacia la IP del PLC (configurable por variable de entorno `PLC_IP=192.168.56.101`).
   * **Modo Mock / Simulador Automático en Memoria:** Si `S7-PLCSIM Advanced` no es alcanzable por red (por ejemplo, cuando testeamos desde Ubuntu sin la VM encendida), el servicio debe entrar automáticamente en `simulation_mode = True` emulando el ciclo RLO y los temporizadores `TON`/`TOF` en memoria RAM de Python para que la API, los tests y el Frontend 3D funcionen en cualquier entorno.
4. `backend/app/main.py`: Servidor FastAPI con CORS habilitado, los 5 endpoints REST y el WebSocket `/ws/telemetry` emitiendo a 100 ms.
5. `backend/tests/test_packer_and_api.py`: Suite de tests en `pytest` que valide el empaquetado Big-Endian exacto de 8 bytes por instrucción, la lectura/escritura de bits y todos los endpoints REST.

## 3. Requisito de Entrega: Comandos de Verificación (HITL)
Al finalizar tu trabajo, incluye una sección obligatoria **`## Comandos de Verificación (HITL)`** con los comandos exactos para:
1. Crear el entorno virtual e instalar `backend/requirements.txt`.
2. Ejecutar `pytest` para validar el compilador binario Big-Endian y los endpoints.
3. Levantar el servidor con `uvicorn` y probar con `curl` la inyección de un peldaño de prueba.