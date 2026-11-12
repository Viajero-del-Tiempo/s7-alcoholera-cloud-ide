"""FastAPI entry point: uvicorn app.main:app --app-dir backend --port 8000."""

import asyncio
from contextlib import asynccontextmanager
import logging
import os

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.models.schemas import (
    CommandPayload, GeneratePayload, HealthResponse, InputPayload,
    LadderProgramPayload, TelemetryPayload,
)
from app.plc.s7_service import DeploymentBusy, PLCUnavailable, S7Service, get_s7_service


logger = logging.getLogger(__name__)


def create_app(service: S7Service | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        plc = service or get_s7_service()
        application.state.plc = plc
        await run_in_threadpool(plc.start)
        try:
            yield
        finally:
            await run_in_threadpool(plc.close)

    application = FastAPI(title="Alcoholera Ladder S7 API", lifespan=lifespan)
    origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()]
    application.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_credentials=False,
        allow_methods=["GET", "POST"], allow_headers=["*"],
    )

    @application.exception_handler(PLCUnavailable)
    async def unavailable_handler(request, exc):
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @application.exception_handler(DeploymentBusy)
    async def busy_handler(request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @application.get("/api/health", response_model=HealthResponse)
    def health():
        return application.state.plc.health()

    @application.post("/api/plc/deploy")
    def deploy(payload: LadderProgramPayload):
        count = application.state.plc.deploy(payload)
        return {"status": "ok", "instructions": count}

    @application.post("/api/plc/input")
    def set_input(payload: InputPayload):
        application.state.plc.set_input(payload.index, payload.value)
        return {"status": "ok"}

    @application.post("/api/plc/command")
    def command(payload: CommandPayload):
        application.state.plc.command(payload)
        return {"status": "ok"}

    @application.post("/api/ai/generate", response_model=LadderProgramPayload)
    async def generate(payload: GeneratePayload):
        try:
            # ImportError also covers the empty module before Worker 03 lands.
            from app.ai.copilot import generate_ladder_from_prompt
        except ImportError as exc:
            logger.warning("AI copilot import unavailable: %s", exc)
            raise HTTPException(status_code=503, detail="AI copilot is not available") from exc
        try:
            result = await generate_ladder_from_prompt(payload.prompt)
            return LadderProgramPayload.model_validate(result)
        except HTTPException:
            raise
        except ValidationError as exc:
            logger.warning("AI returned an invalid LadderProgramPayload: %s", exc)
            raise HTTPException(status_code=502, detail="AI returned an invalid Ladder program") from exc
        except Exception as exc:
            logger.warning("AI generation unavailable: %s", exc)
            raise HTTPException(status_code=503, detail="AI generation is unavailable") from exc

    @application.websocket("/ws/telemetry")
    async def telemetry(websocket: WebSocket):
        await websocket.accept()
        try:
            while True:
                try:
                    snapshot = await run_in_threadpool(application.state.plc.telemetry)
                    await websocket.send_json(TelemetryPayload.model_validate(snapshot).model_dump())
                except PLCUnavailable:
                    await websocket.close(code=1011, reason="PLC communication unavailable")
                    return
                await asyncio.sleep(0.1)
        except WebSocketDisconnect:
            pass

    return application


app = create_app()
