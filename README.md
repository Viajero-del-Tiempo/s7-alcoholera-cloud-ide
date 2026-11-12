# S7-Alcoholera Cloud IDE & 3D Digital Twin

Plataforma web de ingeniería industrial (IT/OT) que permite programar en caliente (**Hot-Reload / sin pasar a STOP**) un controlador **Siemens SIMATIC S7-1500** mediante **Diagramas Ladder visuales** o **Lenguaje Natural (IA)**, validando el proceso en tiempo real sobre un **Gemelo Digital 3D de una Planta Alcoholera** construido con Three.js (`@react-three/fiber`).

---

## Arquitectura del Sistema

```text
[ Navegador Web (React 19 + Tailwind + Zustand) ]
  ├── Editor Visual Ladder (Iluminación RLO en tiempo real)
  ├── Copiloto IA (Text-to-Ladder para procesos de destilación/fermentación)
  └── Gemelo Digital 3D Alcoholera (Three.js / React Three Fiber - HIL)
         │
         │ HTTPS (REST API) + WSS (WebSockets Telemetría a 100ms)
         ▼
[ Entorno Cloud VM (Windows Server / Workstation) ]
  ├── Sidecar Backend: Python 3.12 + FastAPI + LangGraph (Gemini) + python-snap7
  │      │
  │      │ S7Comm Protocol (PUT/GET TCP Puerto 102 -> 192.168.56.101)
  │      ▼
  └── Entorno OT: S7-PLCSIM Advanced + TIA Portal (Ejecutando FB_LadderEngine en SCL)
```

---

## Diccionario de Tags de Proceso (Planta Alcoholera 3D)

| Tipo | Dirección PLC | Índice | Tag Industrial | Función en el Gemelo Digital 3D |
|---|---|---|---|---|
| **Entrada (`I`)** | `I0.0` | `0` | `START_BATCH` | Pulsador verde de inicio de lote en pupitre |
| **Entrada (`I`)** | `I0.1` | `1` | `STOP_RESET` | Pulsador rojo de parada y reset de lote |
| **Entrada (`I`)** | `I0.2` | `2` | `LSH_101` | Sensor de nivel alto en cuba de fermentación (activo a nivel >= 90%) |
| **Entrada (`I`)** | `I0.3` | `3` | `LSL_101` | Sensor de nivel bajo en cuba de fermentación (activo a nivel > 10%) |
| **Entrada (`I`)** | `I1.0` | `4` | `TSH_102` | Termostato / Alarma de sobretemperatura en columna (`1` = falla térmica) |
| **Salida (`Q`)** | `Q0.0` | `0` | `P_101` | Bomba de alimentación de mosto/melaza (llena la cuba en 3D) |
| **Salida (`Q`)** | `Q0.1` | `1` | `M_101` | Motor agitador de cuba de fermentación (rota paletas y burbujea) |
| **Salida (`Q`)** | `Q0.2` | `2` | `XV_102` | Válvula solenoide de vapor hacia columna destiladora |
| **Salida (`Q`)** | `Q0.3` | `3` | `P_102` | Bomba de trasiego a destilación (vacía la cuba en 3D) |
| **Salida (`Q`)** | `Q0.4` | `4` | `AL_101` | Baliza luminosa roja rotatoria de alarma en planta |

---

## Metodología de Desarrollo Multi-Agente (Router + Workers)

Este repositorio implementa una arquitectura de desarrollo concurrente inspirada en `dsh-superagent-prototype`:

1. **Agente Router (Tech Lead + HITL):** Gobierna la rama `main`, mantiene el archivo inmutable `CONTRACT.md` y asigna tareas mediante la carpeta `briefs/`.
2. **Agentes Workers (1 al 4):** Cada agente opera en su propio **Git Worktree** físico bajo `.worktrees/` y tiene estrictamente acotada su zona de escritura:
   * `worker-01-ot-plc` (`feat/ot-plc-engine`) -> Escribe solo en `/plc-src/`
   * `worker-02-backend-s7` (`feat/backend-s7-core`) -> Escribe en `/backend/app/{main.py, models/, compiler/, plc/}`
   * `worker-03-ai-copilot` (`feat/ai-ladder-copilot`) -> Escribe solo en `/backend/app/ai/`
   * `worker-04-frontend-3d` (`feat/frontend-3d-twin`) -> Escribe solo en `/frontend-web/`

---

## Flujo de Integración (Merge Protocol)

Ningún agente realiza `merge` a `main`. Al finalizar su tarea, cada agente entrega en su reporte final la sección **`## Comandos de Verificación (HITL)`**. El humano ejecuta las pruebas y, tras validarlas, fusiona la rama del worktree hacia `main`:

```bash
git merge --no-ff feat/<nombre-rama-worker> -m "feat: merge validated worker deliverable"
```