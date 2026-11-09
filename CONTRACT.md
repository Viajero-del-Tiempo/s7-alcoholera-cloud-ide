# CONTRACT.md — Especificación Inmutable de Interfaces y Memoria

> **REGLA DE ORO PARA TODOS LOS AGENTES WORKERS:**
> Este documento es de **SOLO LECTURA**. Ningún agente Worker está autorizado a modificar offsets de memoria, códigos de operación (`OpCode`), nombres de propiedades JSON, rutas de endpoints ni mapeos de E/S definidos aquí. Si detectas una ambigüedad, detén la ejecución y consulta al Router.

---

## 1. Perímetro de Archivos por Agente (File Ownership)

Para evitar conflictos de `git merge` entre worktrees paralelos, cada agente tiene permiso de escritura **únicamente** en su directorio asignado:

| ID Agente | Rama / Worktree | Directorio Permitido (Write) | Directorios Prohibidos |
|---|---|---|---|
| **Worker 01 (OT/PLC)** | `feat/ot-plc-engine` | `plc-src/**` | `backend/**`, `frontend-web/**` |
| **Worker 02 (Backend S7)** | `feat/backend-s7-core` | `backend/app/main.py`, `backend/app/models/**`, `backend/app/compiler/**`, `backend/app/plc/**`, `backend/requirements.txt`, `backend/tests/test_packer_and_api.py` | `backend/app/ai/**`, `plc-src/**`, `frontend-web/**` |
| **Worker 03 (AI Copilot)** | `feat/ai-ladder-copilot` | `backend/app/ai/**`, `backend/tests/test_ai_copilot.py` | Resto de `backend/**`, `plc-src/**`, `frontend-web/**` |
| **Worker 04 (Frontend 3D)** | `feat/frontend-3d-twin` | `frontend-web/**` | `backend/**`, `plc-src/**` |

---

## 2. Contrato OT: Estructura Binaria y Mapa de Memoria S7 (Big-Endian)

* **Parámetros de Conexión S7:** IP por defecto `192.168.0.1`, `Rack = 0`, `Slot = 1`, Puerto TCP `102`.
* **Configuración de Bloques en TIA Portal:** Todos los Data Blocks de interfaz tienen el atributo `S7_Optimized_Access := 'FALSE'`.

### 2.1 Estructura `UDT_LadderInst` (8 Bytes exactos en Big-Endian)
Formato `struct` en Python: `>hhi` (`>` Big-Endian, `h` = `Int` 16-bit con signo, `i` = `DInt` 32-bit con signo).

| Campo | Tipo S7 | Tamaño | Offset Relativo | Descripción |
|---|---|---|---|---|
| `OpCode` | `Int` | 2 Bytes | `+0` | Código de instrucción del motor Ladder |
| `OperandIdx` | `Int` | 2 Bytes | `+2` | Índice del bit o temporizador dentro de su banco |
| `Param` | `DInt` | 4 Bytes | `+4` | Banco de memoria (`0`=I, `1`=Q, `2`=M) o tiempo `PT` en ms para Timers |

### 2.2 Tabla Oficial de `OpCodes`
| `OpCode` | Mnemónico | Operación sobre `#RLO` | Significado de `OperandIdx` | Significado de `Param` |
|---|---|---|---|---|
| `0` | `END_PROG` | Fin de escaneo de peldaños (`EXIT`) | `0` | `0` |
| `1` | `LD_NO` | `#RLO := Bit` (Inicio peldaño NA) | Índice (`0..31` o `0..63`) | `0`=Inputs(`I`), `1`=Outputs(`Q`), `2`=Markers(`M`) |
| `2` | `LD_NC` | `#RLO := NOT Bit` (Inicio peldaño NC) | Índice (`0..31` o `0..63`) | `0`=Inputs(`I`), `1`=Outputs(`Q`), `2`=Markers(`M`) |
| `3` | `AND_NO` | `#RLO := #RLO AND Bit` (Serie NA) | Índice (`0..31` o `0..63`) | `0`=Inputs(`I`), `1`=Outputs(`Q`), `2`=Markers(`M`) |
| `4` | `AND_NC` | `#RLO := #RLO AND NOT Bit` (Serie NC) | Índice (`0..31` o `0..63`) | `0`=Inputs(`I`), `1`=Outputs(`Q`), `2`=Markers(`M`) |
| `5` | `OR_NO` | `#RLO := #RLO OR Bit` (Paralelo NA) | Índice (`0..31` o `0..63`) | `0`=Inputs(`I`), `1`=Outputs(`Q`), `2`=Markers(`M`) |
| `6` | `OR_NC` | `#RLO := #RLO OR NOT Bit` (Paralelo NC) | Índice (`0..31` o `0..63`) | `0`=Inputs(`I`), `1`=Outputs(`Q`), `2`=Markers(`M`) |
| `10` | `OUT` | `Bit := #RLO` (Bobina normal) | Índice (`0..31` o `0..63`) | `1`=Outputs(`Q`), `2`=Markers(`M`) |
| `11` | `SET` | `IF #RLO THEN Bit := TRUE` | Índice (`0..31` o `0..63`) | `1`=Outputs(`Q`), `2`=Markers(`M`) |
| `12` | `RESET` | `IF #RLO THEN Bit := FALSE` | Índice (`0..31` o `0..63`) | `1`=Outputs(`Q`), `2`=Markers(`M`) |
| `20` | `TON` | `TimersON[OperandIdx](IN:=#RLO, PT:=Param); #RLO := Q` | Índice Timer (`0..15`) | Tiempo en milisegundos (`DInt`, ej. `15000`) |
| `21` | `TOF` | `TimersOFF[OperandIdx](IN:=#RLO, PT:=Param); #RLO := Q` | Índice Timer (`0..15`) | Tiempo en milisegundos (`DInt`, ej. `5000`) |

### 2.3 Mapa de Offsets de `DB10` (`DB_Comunicacion_HMI`)
Tamaño total del DB10: **1624 Bytes**.

| Offset (Byte.Bit) | Nombre Variable | Tipo en S7 | Tamaño | Dirección de Escritura |
|---|---|---|---|---|
| `0.0` | `NewProgramReady` | `Bool` | 1 bit | Backend escribe `1`; PLC baja a `0` tras copiar |
| `0.1` | `EngineEnable` | `Bool` | 1 bit | Backend escribe (`1` = RUN, `0` = STOP motor) |
| `0.2` | `ResetAll` | `Bool` | 1 bit | Backend escribe `1`; PLC resetea todo y baja a `0` |
| `0.3` | `UseVirtualInputs` | `Bool` | 1 bit | Backend escribe (`1` = Usa `VirtualInputs`, `0` = Físicas) |
| `2` | `ActiveInstructions` | `Int` | 2 Bytes | PLC escribe cantidad de instrucciones activas |
| `4` | `VirtualInputs` | `Array[0..31] of Bool` | 4 Bytes | Backend escribe (Simulación desde UI y Planta 3D) |
| `8` | `InputsState` | `Array[0..31] of Bool` | 4 Bytes | PLC escribe espejo de entradas activas |
| `12` | `OutputsState` | `Array[0..31] of Bool` | 4 Bytes | PLC escribe espejo de salidas `Q` |
| `16` | `MarkersState` | `Array[0..63] of Bool` | 8 Bytes | PLC escribe espejo de marcas `M` |
| `24` | `UploadProgram` | `Array[0..199] of UDT_LadderInst` | 1600 Bytes | Backend inyecta programa (`200 * 8` bytes) |

---

## 3. Contrato de Tags de la Planta Alcoholera 3D (Mapeo I/O)

Todos los agentes (SCL, Backend, IA y Escena 3D en Three.js) deben respetar este diccionario de proceso:

### Entradas Digitales (`Bank = "I"`, `Param = 0`)
* `Index 0` (`I0.0` - Tag `START_BATCH`): Pulsador Verde de Arranque de Lote en Pupitre 3D.
* `Index 1` (`I0.1` - Tag `STOP_RESET`): Pulsador Rojo de Parada / Reset en Pupitre 3D.
* `Index 2` (`I0.2` - Tag `LSH_101`): Sensor de Nivel Alto en Cuba de Fermentación (Se activa a nivel mayor o igual a 90%).
* `Index 3` (`I0.3` - Tag `LSL_101`): Sensor de Nivel Bajo en Cuba de Fermentación (Activo cuando nivel mayor a 10%).
* `Index 4` (`I1.0` - Tag `TSH_102`): Alarma de Sobretemperatura en Columna/Cuba (`0` = Normal, `1` = Falla Térmica).

### Salidas Digitales (`Bank = "Q"`, `Param = 1`)
* `Index 0` (`Q0.0` - Tag `P_101`): Bomba de Alimentación de Mosto/Melaza (Sube el nivel del tanque en el 3D).
* `Index 1` (`Q0.1` - Tag `M_101`): Motor Agitador de Cuba de Fermentación (Gira paletas 3D y genera burbujas).
* `Index 2` (`Q0.2` - Tag `XV_102`): Válvula Solenoide de Vapor hacia Columna (Activa efecto de vapor/calor en 3D).
* `Index 3` (`Q0.3` - Tag `P_102`): Bomba de Trasiego hacia Columna Destiladora (Baja el nivel del tanque en el 3D).
* `Index 4` (`Q0.4` - Tag `AL_101`): Baliza Luminosa Roja de Alarma en Planta 3D.

---

## 4. Contrato JSON & API (Frontend <-> Backend <-> IA)

### 4.1 Esquema Pydantic / TypeScript de un Programa Ladder (`LadderProgramPayload`)
```json
{
  "project_name": "Fermentacion_Automatica_Lote_1",
  "rungs": [
    {
      "rung_id": 1,
      "comment": "Iniciar carga de mosto con P_101 si se presiona START_BATCH, no hay nivel alto LSH_101 ni alarma TSH_102",
      "instructions": [
        { "mnemonic": "LD_NO", "opcode": 1, "bank": "I", "index": 0, "param": 0 },
        { "mnemonic": "AND_NC", "opcode": 4, "bank": "I", "index": 2, "param": 0 },
        { "mnemonic": "AND_NC", "opcode": 4, "bank": "I", "index": 4, "param": 0 },
        { "mnemonic": "SET", "opcode": 11, "bank": "Q", "index": 0, "param": 1 }
      ]
    }
  ]
}
```

### 4.2 Endpoints REST (FastAPI en Puerto `8000`)
1. `GET /api/health` -> Devuelve `{"status": "ok", "plc_connected": bool, "simulation_mode": bool}`.
2. `POST /api/plc/deploy` -> Recibe `LadderProgramPayload`, empaqueta los `rungs` agregando `OpCode=0` al final, escribe en `DB10.UploadProgram` (offset 24) y levanta `NewProgramReady` (`offset 0.0`).
3. `POST /api/plc/input` -> Recibe `{"index": int, "value": bool}` y actualiza el bit correspondiente en `DB10.VirtualInputs` (offset 4).
4. `POST /api/plc/command` -> Recibe `{"enable": bool, "reset": bool, "use_virtual_inputs": bool}` y actualiza el byte `0` de `DB10`.
5. `POST /api/ai/generate` -> Recibe `{"prompt": string}`, invoca a `generate_ladder_from_prompt(prompt: str)` del **Worker 03** y retorna un `LadderProgramPayload`.

### 4.3 WebSocket de Telemetría (`WS /ws/telemetry` cada 100 ms)
```json
{
  "plc_connected": true,
  "active_instructions": 9,
  "inputs": [false, false, false, true, false, false, false, false],
  "outputs": [true, false, false, false, false, false, false, false],
  "markers": [false, false, false, false, false, false, false, false]
}
```