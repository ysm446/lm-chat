from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .llama_manager import eject_model
from .routes import chat, config, data, documents, history, library, llama, memory, models, search, system_prompts, util, workspaces
from .routes.deps import image_dir, start_background_task

logging.basicConfig(level=os.environ.get("LM_CHAT_LOG_LEVEL", "INFO").upper())
logger = logging.getLogger(__name__)

app = FastAPI(title="LM Chat Backend", version="0.1.0")
# 認証なしのローカル API のため、ブラウザ上の任意サイトからのアクセスを防ぐ。
# "null" は Electron 本番ビルド(file:// 読み込み)からのリクエスト用。
app.add_middleware(
    CORSMiddleware,
    # start.bat は 5173 が埋まっていると 5174, 5175... とポートをずらすため、
    # 固定ポートだけ許可すると全 API が CORS で弾かれて "Failed to fetch" になる。
    # ローカル完結のアプリなのでループバックの任意ポートを許可する。
    allow_origins=["null"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/assets/images/{file_path:path}")
def serve_chat_image(file_path: str) -> FileResponse:
    # ライブラリ切り替えに追従するため、画像ルートは毎回 image_dir() を解決する
    # （StaticFiles の固定マウントだと切り替え後に旧ライブラリを指し続ける）。
    root = image_dir().resolve()
    target = (root / file_path).resolve()
    if target != root and root not in target.parents:
        raise HTTPException(status_code=404, detail="Not found")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target)


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
    library.router,
    search.router,
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


@app.on_event("shutdown")
def shutdown_llama_server() -> None:
    try:
        eject_model()
    except Exception as exc:
        logger.warning("Failed to stop llama-server during backend shutdown: %s", exc)
