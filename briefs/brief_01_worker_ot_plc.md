# Brief de Misión: Worker 01 — Especialista OT / Siemens SCL

## 1. Tu Identidad y Entorno de Trabajo
* **Rol:** Ingeniero Senior de Automatización Siemens (TIA Portal V18/V21 & S7-PLCSIM Advanced).
* **Worktree asignado:** `.worktrees/worker-01-ot-plc` (Rama: `feat/ot-plc-engine`).
* **Perímetro estricto de escritura:** Solo puedes crear o modificar archivos dentro de `plc-src/`. Tienes terminantemente prohibido modificar `CONTRACT.md` o cualquier otra carpeta.

## 2. Tus Entregables Exactos
Debes leer `CONTRACT.md` (Secciones 2 y 3) y generar los siguientes archivos fuente ASCII exportables/importables en TIA Portal ("External Source Files"):

1. `plc-src/UDT_LadderInst.udt`:
   * Tipo de datos PLC con `OpCode : Int`, `OperandIdx : Int`, `Param : DInt` (8 bytes).
2. `plc-src/DB_Comunicacion_HMI.db`:
   * Data Block Global (`DB10`) con `{ S7_Optimized_Access := 'FALSE' }`.
   * Debe respetar exactamente los nombres y offsets de la Sección 2.3 de `CONTRACT.md` (`NewProgramReady`, `EngineEnable`, `ResetAll`, `UseVirtualInputs`, `ActiveInstructions`, `VirtualInputs`, `InputsState`, `OutputsState`, `MarkersState`, `UploadProgram`).
3. `plc-src/DB_Activo_Ladder.db`:
   * Data Block Global (`DB11`) con `{ S7_Optimized_Access := 'FALSE' }` que contenga `Program : Array[0..199] of "UDT_LadderInst"`.
4. `plc-src/FB_LadderEngine.scl`:
   * Function Block del motor cíclico basado en `FOR #i := 0 TO 199 DO` y variable `#RLO`.
   * Si `"DB_Comunicacion_HMI".UseVirtualInputs` es `TRUE`, debe cargar `#Inputs[0..31]` desde `"DB_Comunicacion_HMI".VirtualInputs`; de lo contrario, desde los tags físicos de la alcoholera (`START_BATCH`, `STOP_RESET`, `LSH_101`, `LSL_101`, `TSH_102`).
   * Debe implementar el Handshake de `NewProgramReady` copiando `UploadProgram` a `DB_Activo_Ladder.Program`.
   * Debe implementar todos los `OpCodes` de la Sección 2.2 de `CONTRACT.md` (`0`, `1..6`, `10..12`, `20..21`).
   * Al final del bloque, debe actualizar los espejos `InputsState`, `OutputsState`, `MarkersState` y `ActiveInstructions` en `DB_Comunicacion_HMI`.
5. `plc-src/verify_plc_sources.py`:
   * Un script ligero de validación estática en Python (sin dependencias externas) que verifique por expresiones regulares que los archivos `.udt`, `.db` y `.scl` existen, contienen `{ S7_Optimized_Access := 'FALSE' }` en los DBs, definen los 12 `OpCodes` del contrato y no tienen errores de sintaxis de cierre (`END_TYPE`, `END_DATA_BLOCK`, `END_FUNCTION_BLOCK`).

## 3. Requisito de Entrega: Comandos de Verificación (HITL)
Al finalizar tu tarea, debes entregar obligatoriamente una sección titulada **`## Comandos de Verificación (HITL)`** con:
1. El comando exacto para correr `python3 plc-src/verify_plc_sources.py` desde la terminal para comprobar la integridad de los fuentes.
2. Los pasos exactos numerados para importar los archivos en TIA Portal *"External source files" -> "Generate blocks from source"* y poner `S7-PLCSIM Advanced` en `RUN`.