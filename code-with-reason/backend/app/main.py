"""FastAPI application; importing this module never creates database files."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.catalog.loader import get_catalog
from app.config import get_settings
from app.models.db_models import init_db


@asynccontextmanager
async def _lifespan(application: FastAPI):
    application.state.catalog = get_catalog()
    init_db()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="SocraGate",
        description="Execution-grounded adversarial Socratic coding tutor",
        version="3.0.0",
        lifespan=_lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    application.include_router(router)
    return application


app = create_app()
