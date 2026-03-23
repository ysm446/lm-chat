# CLAUDE.md — LM Chat プロジェクト向け Claude Code ガイド

## プロジェクト概要

ローカル LLM チャットアプリ。Electron + React/TypeScript フロントエンド、Python FastAPI バックエンド、llama-server（llama.cpp）で構成。すべてローカル完結。

## 起動

```batch
start.bat
```

- llama-server: `localhost:8080`
- FastAPI: `localhost:8000`（uvicorn `--reload` で自動再読み込み）
- Vite: `localhost:5173`
- Electron: Vite に接続して起動

バックエンドは `--reload` が有効なので、Python ファイルを保存すると自動反映される。フロントエンドも Vite HMR で自動反映。Electron 自体は再起動が必要。

## 重要なファイル

### バックエンド

| ファイル | 役割 |
|---|---|
| `backend/server.py` | FastAPI ルーター。全エンドポイントの定義 |
| `backend/models.py` | Pydantic モデル。リクエスト/レスポンス型 |
| `backend/store.py` | SQLite CRUD。セッション・ワークスペース・記憶 |
| `backend/llm_proxy.py` | llama-server への HTTP プロキシ。`SYSTEM_PROMPT` もここ |
| `backend/llama_manager.py` | モデル切り替え時の llama-server プロセス管理 |
| `backend/config_store.py` | `data/config.json` への設定永続化 |
| `backend/memory/engine.py` | 記憶保存・検索のエントリポイント |
| `backend/memory/embedder.py` | `ruri-v3-310m` による埋め込み生成（初回に自動 DL） |
| `backend/memory/chunker.py` | Q&A ペアチャンキング |

### フロントエンド

| ファイル | 役割 |
|---|---|
| `src/renderer/api.ts` | バックエンド API クライアント関数 |
| `src/renderer/stores/chatStore.ts` | Zustand グローバルストア。すべての UI 状態 |
| `src/renderer/App.tsx` | ルートコンポーネント。レイアウト定義 |
| `src/renderer/styles.css` | 全スタイル（CSS 変数ベース、LM Studio 風ダークテーマ） |

### 設定・データ

| ファイル | 役割 |
|---|---|
| `data/lm_chat.db` | SQLite DB（自動生成） |
| `data/config.json` | `ctx_size` 等のユーザー設定 |
| `data/llama_paths.json` | llama-server のパスと前回選択モデル（start.bat が書き込み） |
| `start.bat` | 全プロセスの一括起動スクリプト |

## アーキテクチャ上の注意点

### 記憶システム
- 記憶はワークスペース単位でスコープ。`workspace_id` でフィルタ必須
- DB スキーマ変更時は `data/lm_chat.db` を削除して再作成が必要
- 埋め込み次元は `ruri-v3-310m` に合わせて **768 次元**（`memory_vec` テーブル）
- FTS5 の MATCH クエリはユーザー入力を `'"' + query.replace('"', ' ') + '"'` でサニタイズ

### llama-server との通信
- `llm_proxy.py` で `chat_template_kwargs: {"enable_thinking": bool}` と `thinking: {"type": "disabled"}` を制御
- ストリーミングは SSE（`/chat/send/stream`）、非ストリーミングは `/chat/send`
- `llama_manager.py` のモデル切り替えは Windows では `taskkill /F /IM llama-server.exe` でプロセスを終了

### フロントエンドの状態管理
- すべての状態は `chatStore.ts`（Zustand）に集約
- `sendMessage` がストリーミング・記憶保存・セッション更新・タイトル自動生成を担う
- モデル切り替えは `applyModelSwitch` が `/llama/switch-model` → ポーリング → 完了を管理

### SSE ストリーミングのイベント形式
```
data: {"type": "token", "content": "..."}  ← トークン
data: {"type": "done", "session": {...}}   ← 完了（セッション全体を返す）
data: {"type": "error", "detail": "..."}  ← エラー
```

## API エンドポイント一覧

```
GET  /health
GET  /v1/models
GET  /models/local               ← models/ 内の GGUF 一覧

GET  /workspaces
POST /workspaces
PATCH /workspaces/{id}
DELETE /workspaces/{id}

GET  /history/sessions?workspace_id=
POST /history/sessions
GET  /history/sessions/{id}
PATCH /history/sessions/{id}
DELETE /history/sessions/{id}
POST /history/sessions/{id}/messages
GET  /history/sessions/{id}/token_count

POST /chat/send
POST /chat/send/stream

POST /memory/save
GET  /memory/search
DELETE /memory/session/{id}
DELETE /memory/workspace/{id}
GET  /memory/stats

GET  /config
PATCH /config

GET  /llama/status
POST /llama/switch-model

POST /search/web
```

## よくある問題と対処

### DB スキーマエラー（Dimension mismatch 等）
`data/lm_chat.db` を削除して再起動。

### llama-server が見つからない（Model switch failed）
`data/llama_paths.json` が壊れているか存在しない。`start.bat` を再実行すると書き直される。

### 記憶が保存されない / 検索されない
uvicorn ログ（LM Chat Backend ウィンドウ）で `Memory save failed` / `Memory context build failed` を確認。

### start.bat が起動しない
`start.bat` を直接 `cmd.exe` から実行してエラーメッセージを確認。`ERROR:` プレフィックス付きのメッセージが出るはず。

## 開発の流れ

1. Python の変更 → uvicorn の `--reload` で自動反映（再起動不要）
2. React/CSS の変更 → Vite HMR で自動反映（再起動不要）
3. `src/main/main.ts` の変更 → Electron を再起動が必要
4. DB スキーマ変更 → `data/lm_chat.db` を削除して再起動
5. `start.bat` の変更 → 全体を再起動
