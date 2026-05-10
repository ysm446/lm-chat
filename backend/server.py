from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .routes import chat, config, data, documents, history, llama, memory, models, system_prompts, util, workspaces
from .routes.deps import _DOCUMENT_DIR, _IMAGE_DIR, start_background_task

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = FastAPI(title="LM Chat Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/assets/images", StaticFiles(directory=_IMAGE_DIR), name="chat-images")

for _router in (
    util.router,
    system_prompts.router,
    models.router,
    workspaces.router,
    history.router,
    chat.router,
    memory.router,
    documents.router,
    config.router,
    data.router,
    llama.router,
):
    app.include_router(_router)


@app.on_event("startup")
def startup_background_tasks() -> None:
    def _warmup():
        try:
            from .memory.embedder import warmup
            warmup()
        except Exception as exc:
            logger.warning("Embedder warmup failed: %s", exc)

    start_background_task(_warmup, name="embedder-warmup")
