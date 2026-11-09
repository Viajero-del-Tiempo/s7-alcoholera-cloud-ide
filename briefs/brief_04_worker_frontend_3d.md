# Brief de Misión: Worker 04 — Ingeniero Frontend React 19, Editor Ladder & Gemelo 3D (Three.js)

## 1. Tu Identidad y Entorno de Trabajo
* **Rol:** Senior Frontend & 3D WebGL Engineer (React 19, TypeScript, Tailwind CSS, Zustand, `@react-three/fiber`, `@react-three/drei`).
* **Worktree asignado:** `.worktrees/worker-04-frontend-3d` (Rama: `feat/frontend-3d-twin`).
* **Perímetro estricto de escritura:** Solo puedes crear o modificar archivos dentro de `frontend-web/`. Tienes prohibido tocar `backend/` o `plc-src/`.

## 2. Tus Entregables Exactos
Construye en `frontend-web/` una SPA moderna con Vite + React 19 + TypeScript con estética SCADA Industrial en modo oscuro, dividida en 3 paneles principales sincronizados mediante `usePlcStore.ts` (Zustand) contra el backend (`http://localhost:8000` y `ws://localhost:8000/ws/telemetry`):

1. **Panel Izquierdo — Editor Visual Ladder & Copiloto IA (`LadderEditor` + `AICopilot`):**
   * Renderiza gráficamente cada peldaño (`rung`) del JSON activo mostrando contactos `[ ]`, `[/]`, bloques `[TON]`, `[TOF]` y bobinas `( )`, `(S)`, `(R)` con su Tag industrial (`START_BATCH`, `P_101`, etc.).
   * **Iluminación RLO en Vivo:** Calcula y colorea en verde neón los contactos y cables que tienen energía según los arrays `inputs`, `outputs` y `markers` recibidos cada 100 ms por el WebSocket.
   * Permite agregar/eliminar peldaños manualmente, cargar presets o escribirle un prompt al Copiloto IA (`POST /api/ai/generate`) y presionar **"Deploy to S7-1500 (Hot-Reload)"** (`POST /api/plc/deploy`).
2. **Panel Derecho — Gemelo Digital 3D de la Planta Alcoholera (`Plant3D` en `@react-three/fiber`):**
   * Escena 3D interactiva con `OrbitControls`, iluminación industrial, grilla de piso y modelos procedurales limpios compuestos con geometrías Three.js:
     * **Cuba de Fermentación transparente** con indicador de nivel líquido dinámico (color ámbar/mosto) que sube cuando `P_101` (`outputs[0]`) es `true` y baja cuando `P_102` (`outputs[3]`) es `true`.
     * **Agitador mecánico superior (`M_101` - `outputs[1]`)** cuyas paletas internas rotan en `useFrame` y generan partículas/burbujas cuando está activo.
     * **Columna de Destilación e Intercambiador (`XV_102` - `outputs[2]`)** con tuberías que se iluminan cuando hay flujo de vapor/mosto.
     * **Baliza Roja de Alarma (`AL_101` - `outputs[4]`)** con luz puntual roja rotatoria cuando se activa.
   * **Cierre de Lazo Hardware-in-the-Loop (HIL):**
     * Cuando el nivel del líquido 3D supera el 90%, la escena dispara automáticamente `POST /api/plc/input` con `{"index": 2, "value": true}` (`LSH_101`).
     * Cuando el nivel supera el 10%, mantiene `LSL_101` (`index: 3`) en `true`, y al vaciarse (menor o igual a 10%) lo pasa a `false`.
3. **Panel Inferior — Pupitre de Operador I/O (`ControlPanel`):**
   * Botonera industrial interactiva para accionar `I0.0 (START_BATCH)`, `I0.1 (STOP_RESET)`, simular la alarma térmica `I1.0 (TSH_102)` y ver el estado de conexión con el PLC (`Online` / `Simulation Mode`).

## 3. Requisito de Entrega: Comandos de Verificación (HITL)
Al finalizar tu trabajo, incluye obligatoriamente la sección **`## Comandos de Verificación (HITL)`** con los comandos exactos para:
1. Instalar dependencias (`npm install`).
2. Ejecutar el chequeo estricto de tipos y compilación de producción (`npm run build`) sin errores de TypeScript.
3. Levantar el servidor de desarrollo (`npm run dev`).