# Brief de Misión: Worker 03 — Especialista en IA Generativa (Text-to-Ladder Copilot)

## 1. Tu Identidad y Entorno de Trabajo
* **Rol:** Ingeniero de IA especializado en LLMs con Salidas Estructuradas (Gemini SDK / LangGraph / Pydantic).
* **Worktree asignado:** `.worktrees/worker-03-ai-copilot` (Rama: `feat/ai-ladder-copilot`).
* **Perímetro estricto de escritura:** Solo puedes crear o modificar archivos dentro de:
  * `backend/app/ai/__init__.py`
  * `backend/app/ai/copilot.py`
  * `backend/tests/test_ai_copilot.py`
  * **PROHIBIDO** modificar archivos fuera de `backend/app/ai/` y `backend/tests/test_ai_copilot.py`.

## 2. Tus Entregables Exactos
1. `backend/app/ai/copilot.py`:
   * Debe exponer la función asíncrona `async def generate_ladder_from_prompt(prompt: str) -> dict` que devuelve un diccionario compatible al 100% con el esquema `LadderProgramPayload` de `CONTRACT.md` (Sección 4.1).
   * **System Prompt Industrial:** Debe inyectar en el contexto del modelo Gemini (`gemini-2.5-flash`) toda la tabla de `OpCodes` (Sección 2.2 de `CONTRACT.md`) y el diccionario completo de Tags de la Planta Alcoholera (Sección 3 de `CONTRACT.md`: `START_BATCH`=`I0.0`, `STOP_RESET`=`I0.1`, `LSH_101`=`I0.2`, `LSL_101`=`I0.3`, `TSH_102`=`I1.0`, `P_101`=`Q0.0`, `M_101`=`Q0.1`, `XV_102`=`Q0.2`, `P_102`=`Q0.3`, `AL_101`=`Q0.4`).
   * **Validador Semántico Determinista (`validate_and_sanitize_program`):** Antes de devolver el resultado del LLM, una función en Python debe verificar que todos los `opcode` pertenezcan a `{1,2,3,4,5,6,10,11,12,20,21}`, que cada peldaño comience con `LD_NO` (1) o `LD_NC` (2), y que `param` coincida con `bank` (`0` para `I`, `1` para `Q`, `2` para `M`, o milisegundos mayor a 0 para Timers `TON`/`TOF`).
   * **Fallback Determinista Inteligente (Sin API Key):** Si no está configurada la variable `GEMINI_API_KEY` en el entorno de pruebas, debe contar con un generador basado en reglas/plantillas para las secuencias típicas de la alcoholera (llenado de cuba, fermentación temporizada, trasiego y alarma térmica) para que los tests y la demo funcionen incluso offline.
2. `backend/tests/test_ai_copilot.py`:
   * Tests automatizados con `pytest` que verifiquen la generación de programas Ladder para prompts del proceso alcoholero y prueben que el validador semántico corrige o rechaza `OpCodes` inválidos.

## 3. Requisito de Entrega: Comandos de Verificación (HITL)
Al finalizar tu trabajo, incluye obligatoriamente la sección **`## Comandos de Verificación (HITL)`** con los comandos exactos para ejecutar `pytest backend/tests/test_ai_copilot.py` y un comando de una línea en Python (`python3 -c "..."`) para probar la generación de un programa Ladder desde terminal.