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
| `backend/llm_proxy.py` | llama-server への HTTP プロキシ。`SYSTEM_PROMPT`・生成統計抽出もここ |
| `backend/llama_manager.py` | モデル切り替え・イジェクト・llama-server プロセス管理 |
| `backend/config_store.py` | `data/config.json` への設定永続化（`ctx_size`, `n_gpu_layers`） |
| `backend/memory/engine.py` | 記憶保存・検索のエントリポイント |
| `backend/memory/embedder.py` | `ruri-v3-310m` による埋め込み生成（初回に自動 DL） |
| `backend/memory/chunker.py` | Q&A ペアチャンキング |

### フロントエンド

| ファイル | 役割 |
|---|---|
| `src/renderer/api.ts` | バックエンド API クライアント関数 |
| `src/renderer/stores/chatStore.ts` | Zustand グローバルストア。すべての UI 状態 |
| `src/renderer/App.tsx` | ルートコンポーネント。グリッドレイアウト・サイドバー開閉状態 |
| `src/renderer/components/ModelBar.tsx` | 上部モデルバー。モデル選択・イジェクト・サイドバートグル |
| `src/renderer/components/ModelPickerModal.tsx` | モデル選択ダイアログ |
| `src/renderer/components/Sidebar.tsx` | 左サイドバー。ワークスペース＋セッションのツリー表示 |
| `src/renderer/components/ChatView.tsx` | メッセージ一覧。生成統計・メッセージアクションボタン |
| `src/renderer/components/MessageInput.tsx` | 入力エリア。画像添付・トークンリング・送信 |
| `src/renderer/components/SettingsPanel.tsx` | 右サイドバー。コンテキスト長・GPU オフロードスライダー |
| `src/renderer/styles.css` | 全スタイル（CSS 変数ベース、LM Studio 風ダークテーマ） |

### 設定・データ

| ファイル | 役割 |
|---|---|
| `data/lm_chat.db` | SQLite DB（自動生成） |
| `data/config.json` | `ctx_size`・`n_gpu_layers` のユーザー設定 |
| `data/llama_paths.json` | llama-server の実行パス・前回選択モデル（start.bat が書き込み） |
| `start.bat` | 全プロセスの一括起動スクリプト |

## DB スキーマ（messages テーブル）

```sql
id TEXT, session_id TEXT, role TEXT, content TEXT,
image_data TEXT,           -- 画像（base64 data URL）
created_at TEXT,
completion_tokens INTEGER, -- 生成トークン数（アシスタントのみ）
tokens_per_second REAL,    -- 生成速度
elapsed_seconds REAL,      -- 生成時間（秒）
finish_reason TEXT         -- 停止理由（"stop", "length" 等）
```

新カラムは `_init_db()` 内の `ALTER TABLE` で既存 DB に自動マイグレーションされる。

## アーキテクチャ上の注意点

### 記憶システム
- 記憶はワークスペース単位でスコープ。`workspace_id` でフィルタ必須
- **記憶ボタン（`memory_enabled`）は「過去の記憶を参照するか」を制御するのみ。保存は常に行われる**
- 埋め込み次元は `ruri-v3-310m` に合わせて **768 次元**（`memory_vec` テーブル）
- FTS5 の MATCH クエリはユーザー入力を `'"' + query.replace('"', ' ') + '"'` でサニタイズ
- FTS5 キーワード検索は `memory_chunks` と JOIN して workspace フィルタを1クエリで完結させる
- `embed()` には `@lru_cache(maxsize=512)` が適用されており、同じテキストの再推論をスキップする。戻り値は `tuple[float, ...]`
- サーバー起動時にバックグラウンドスレッドで `warmup_embedder()` を呼び出し、初回リクエストの遅延を解消する
- DB スキーマ変更時は `data/lm_chat.db` を削除して再作成が必要

### llama-server との通信
- `llm_proxy.py` で `chat_template_kwargs: {"enable_thinking": bool}` と `thinking: {"type": "disabled"}` を制御
- ストリーミングは SSE（`/chat/send/stream`）、非ストリーミングは `/chat/send`
- ストリーミング最終フレームの `timings.predicted_n`・`timings.predicted_per_second`・`timings.predicted_ms`・`choices[0].finish_reason` から生成統計を抽出
- `llama_manager.py` のモデル切り替えは Windows では `taskkill /F /IM llama-server.exe` でプロセスを終了
- mmproj（マルチモーダルプロジェクタ）はモデルと同ディレクトリの `*.gguf` ファイルを自動検出

### フロントエンドの状態管理
- すべての状態は `chatStore.ts`（Zustand）に集約
- `sendMessage` がストリーミング・記憶保存・セッション更新・タイトル自動生成を担う
- モデル切り替えは `applyModelSwitch` が `/llama/switch-model` → ポーリング → 完了を管理
- 左右サイドバーの開閉状態は `App.tsx` の `showLeft`/`showRight` で管理し、グリッドカラム幅で制御

### レイアウト構造
```
app-frame (flex column)
├── ModelBar (height: 40px, 固定)
└── app-shell (grid: [左幅]px 1px 1fr 1px [右幅]px)
    ├── left-pane (Sidebar)
    ├── resize-handle
    ├── center-pane (ChatView + MessageInput)
    ├── resize-handle
    └── right-pane (SettingsPanel)
```
サイドバーを隠す場合はカラム幅を `0px` にして `overflow: hidden` で制御（`display: none` はグリッドアイテム数が変わるため使用しない）。

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
POST /history/sessions/{id}/branch  ← 指定メッセージまでのセッションを複製

DELETE /history/messages/{id}
PATCH  /history/messages/{id}       ← メッセージ内容を編集

POST /chat/send
POST /chat/send/stream

POST /memory/save
GET  /memory/search
DELETE /memory/session/{id}
DELETE /memory/workspace/{id}
GET  /memory/stats

GET  /config
PATCH /config                       ← ctx_size, n_gpu_layers

GET  /llama/status
GET  /llama/props                   ← llama-server のモデルプロパティ取得
POST /llama/switch-model
POST /llama/eject                   ← llama-server を停止して VRAM 解放

POST /search/web
```

## よくある問題と対処

### DB スキーマエラー（Dimension mismatch 等）
`data/lm_chat.db` を削除して再起動。

### llama-server が見つからない（Model switch failed）
`data/llama_paths.json` が壊れているか存在しない。`start.bat` を再実行すると書き直される。

### 記憶が保存されない / 検索されない
uvicorn ログ（LM Chat Backend ウィンドウ）で `Memory save failed` / `Memory context build failed` を確認。

### 生成統計が表示されない
llama-server が `timings` フィールドを返していない場合は表示されない（フォールバックで非表示）。llama-server のバージョンや起動オプションを確認。

### start.bat が起動しない
`start.bat` を直接 `cmd.exe` から実行してエラーメッセージを確認。`ERROR:` プレフィックス付きのメッセージが出るはず。

### 起動直後にデータが取得できない
`start.bat` はバックエンド（`/health`）とフロントエンド（port 5173）の両方が応答するまで待機してから Electron を起動する。バックエンドが 60 秒以内に起動しない場合は uvicorn ログを確認。

## 開発の流れ

1. Python の変更 → uvicorn の `--reload` で自動反映（再起動不要）
2. React/CSS の変更 → Vite HMR で自動反映（再起動不要）
3. `src/main/main.ts` の変更 → Electron を再起動が必要
4. DB スキーマ変更 → `data/lm_chat.db` を削除して再起動
5. `start.bat` の変更 → 全体を再起動
