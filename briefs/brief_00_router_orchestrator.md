# Guía de Operaciones del Router (Tech Lead & HITL)

## Cómo lanzar cada Agente Worker
Cada agente debe ser inicializado pasándole como contexto **únicamente**:
1. El archivo `CONTRACT.md`
2. Su archivo asignado dentro de `briefs/0X_worker_...md`
3. Su directorio de trabajo será su respectivo worktree: `.worktrees/worker-0X-...`

## Protocolo de Validación y Merge
Cuando un agente informe que ha terminado:
1. Ejecuta `git status` dentro de su worktree para verificar que no haya tocado archivos fuera de su perímetro definido en `CONTRACT.md`.
2. Ejecuta los comandos listados por el agente en su sección **Comandos de Verificación (HITL)**.
3. Si todos los tests pasan, desde la raíz del proyecto (`main`) fusiona su rama:
   ```bash
   git merge --no-ff feat/nombre-de-la-rama -m "feat: merge validated worker deliverable"
   ```