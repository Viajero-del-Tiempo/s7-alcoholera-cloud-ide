# Handoff Document: S7-Alcoholera Cloud IDE & 3D Digital Twin

## 1. Resumen Ejecutivo, Propósito y Alcance (MVP)

* **¿De qué se trata?** Es una plataforma web industrial (Cloud IDE + SCADA 3D) que permite programar un PLC **Siemens SIMATIC S7-1500** en caliente (*Hot-Reload* / sin pasar la CPU a `STOP`) utilizando **Diagramas Ladder visuales** o **Lenguaje Natural (IA)**, validando la lógica en tiempo real sobre un **Gemelo Digital 3D de una Planta Alcoholera**.
* **¿Para qué se construye?** Es un proyecto de portafolio de alto impacto técnico para LinkedIn y GitHub, orientado a demostrar competencias avanzadas en programación de PLCs (IEC 61131-3 / SCL), convergencia IT/OT, puesta en marcha virtual (*Virtual Commissioning* / Hardware-in-the-Loop) y arquitectura de software moderna para puestos de trabajo remoto.
* **Mecanismo Técnico Central:** Como un PLC S7 estándar no compila código nuevo en caliente vía web sin TIA Portal, creamos en **SCL** un **motor intérprete cíclico (`FB_LadderEngine`)** basado en un bucle `FOR` y una variable `#RLO` (*Resultado Lógico de la Operación*). El backend compila los peldaños Ladder diseñados por el usuario (o por la IA) a un arreglo de estructuras binarias (`UDT_LadderInst` de 8 bytes en formato Big-Endian) y los inyecta mediante el protocolo S7 (`PUT/GET`) en un Data Block no optimizado (`DB10`).
* **Alcance actual del MVP:**
  * Soporte para contactos (`LD_NO`, `LD_NC`, `AND_NO`, `AND_NC`, `OR_NO`, `OR_NC`), bobinas (`OUT`, `SET`, `RESET`) y temporizadores (`TON`, `TOF`) sobre bancos de Entradas (`I`), Salidas (`Q`) y Marcas (`M`).
  * Lazo cerrado *Hardware-in-the-Loop (HIL)* con una estación de fermentación y destilación de alcohol en 3D: las salidas del PLC activan bombas (`P_101`, `P_102`), el agitador (`M_101`), la válvula de vapor (`XV_102`) y la baliza de alarma (`AL_101`); a su vez, la física del nivel de líquido en 3D dispara automáticamente los sensores de nivel (`LSH_101`, `LSL_101`) hacia el PLC.

---

## 2. Arquitectura y Stack Tecnológico Definido

El sistema está diseñado bajo una arquitectura híbrida entre la estación de trabajo local del desarrollador (**Ubuntu Linux**) y una máquina virtual en la nube (**Windows**):

| Capa | Entorno | Stack Tecnológico | Función Principal |
|---|---|---|---|
| **Frontend Web & Gemelo 3D** | Navegador Web (Ubuntu / Cliente) | **Vite + React 19 + TypeScript + Tailwind CSS + Zustand + Three.js (`@react-three/fiber` y `@react-three/drei`)** | Interfaz en 3 paneles: Editor visual Ladder con iluminación `#RLO` en vivo, chat del Copiloto IA, pupitre de control I/O y escena 3D interactiva de la alcoholera. |
| **Backend Sidecar & Compilador** | VM Windows en la Nube (junto al PLC) | **Python 3.12+ + FastAPI + WebSockets + Pydantic v2 + `struct` + `python-snap7`** | Empaqueta el JSON de peldaños a bytes Big-Endian (`>hhi`), inyecta el programa en `DB10`, expone una API REST + WebSocket de telemetría cada 100 ms e incluye un **modo simulador en memoria RAM** automático si el PLC no está conectado. |
| **Módulo Copiloto IA** | Integrado en el Backend Python | **Google Gemini SDK (`gemini-2.5-flash`) / LangGraph** | Traduce prompts de procesos de la alcoholera a estructuras JSON de peldaños Ladder validadas semánticamente contra el diccionario de `OpCodes` y tags de planta. |
| **Controlador Industrial (OT)** | VM Windows en la Nube | **TIA Portal + S7-PLCSIM Advanced (IP `192.168.0.1`, Rack 0, Slot 1) + SCL** | Ejecuta en tiempo real el bloque `FB_LadderEngine.scl`, gestionando el Handshake de doble buffer (`DB10` -> `DB11`) y el modo `UseVirtualInputs`. |
| **Comunicación y Red** | Navegador <-> VM Cloud | **HTTP REST + WebSockets (`WSS`)** (exponible vía Cloudflare Tunnel / Tailscale Funnel) y **S7Comm (TCP Puerto 102)** local en la VM | El navegador habla JSON por HTTP/WS con FastAPI; FastAPI habla binario S7 (`PUT/GET`) directo contra la interfaz virtual de `PLCSIM Advanced`. |

---

## 3. Metodología de Trabajo Multi-Agente (Router + Workers)

Para desarrollar el proyecto sin colisiones de código, implementamos una arquitectura de enjambre inspirada en `dsh-superagent-prototype` utilizando **Git Worktrees**:

* **Agente Router (Rol que asume el agente principal junto al usuario):** Opera en la rama `main`, mantiene los contratos inmutables (`CONTRACT.md`), coordina la ejecución, revisa los tests entregados por cada Worker (HITL) y realiza los `git merge --no-ff`.
* **4 Agentes Workers aislados en `.worktrees/`:**
  1. **`worker-01-ot-plc`** (Rama `feat/ot-plc-engine`) -> Perímetro exclusivo: `/plc-src/` (Fuentes `.udt`, `.db`, `.scl` para TIA Portal y validador estático).
  2. **`worker-02-backend-s7`** (Rama `feat/backend-s7-core`) -> Perímetro exclusivo: `/backend/app/{main.py, models/, compiler/, plc/}` y tests de API/empaquetado.
  3. **`worker-03-ai-copilot`** (Rama `feat/ai-ladder-copilot`) -> Perímetro exclusivo: `/backend/app/ai/` y tests del generador Text-to-Ladder.
  4. **`worker-04-frontend-3d`** (Rama `feat/frontend-3d-twin`) -> Perímetro exclusivo: `/frontend-web/` (App React 19 + Editor Ladder + Alcoholera 3D en Three.js).

---

## 4. Estado Actual: ¿Hasta dónde llegamos y desde dónde arrancar?

### Lo que YA está completado (100% Cerrado)
1. **Diseño conceptual e ingeniería de detalle:** El motor cíclico en SCL basado en `FOR` y `#RLO`, la estructura de 8 bytes `UDT_LadderInst` y el mapa exacto de offsets del `DB10` (1624 bytes) ya están diseñados y verificados.
2. **Contratos de Interfaz (`CONTRACT.md`):** Ya están congelados los `OpCodes` (`0`, `1..6`, `10..12`, `20..21`), los tags de la alcoholera (`START_BATCH`, `STOP_RESET`, `LSH_101`, `LSL_101`, `TSH_102`, `P_101`, `M_101`, `XV_102`, `P_102`, `AL_101`), los esquemas JSON y las rutas REST/WebSocket.
3. **Especificaciones por Agente (`briefs/`):** Ya están redactados los 5 archivos de instrucciones (`00_router_orchestrator.md` al `04_worker_frontend_3d.md`), exigiendo que cada agente entregue al finalizar una sección obligatoria de **`## Comandos de Verificación (HITL)`**.
4. **Script de Bootstrap (`bootstrap.sh`):** Ya se generó el script bash unificado que inicializa el repositorio Git en `main`, crea el `README.md`, el `CONTRACT.md`, todos los `briefs/` y levanta los 4 `git worktrees` bajo `.worktrees/`.

### Punto Exacto de Arranque para el Nuevo Agente (Próximo Paso Inmediato)
* **Ningún Agente Worker (01 al 04) ha ejecutado ni entregado todavía su código de implementación en sus ramas.**
* El nuevo agente debe retomar desde la **ejecución y supervisión de los 4 Workers** (empezando por validar o asistir en la ejecución de `worker-01-ot-plc`, `worker-02-backend-s7`, `worker-03-ai-copilot` y `worker-04-frontend-3d` dentro de sus respectivos worktrees), verificar los tests con el usuario y coordinar el `merge` secuencial hacia `main`.