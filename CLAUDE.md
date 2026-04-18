# CLAUDE.md — LM Chat プロジェクト向け Claude Code ガイド

## プロジェクト概要

ローカル LLM チャットアプリ。Electron + React/TypeScript フロントエンド、Python FastAPI バックエンド、llama-server（llama.cpp）で構成。すべてローカル完結。

## 起動

```batch
start.bat
```

- FastAPI: `localhost:8000`（uvicorn `--reload` で自動再読み込み）
- Vite: `localhost:5173`
- Electron: Vite に接続して起動
- llama-server: **起動しない**。アプリからモデルを選択したときに起動する（`localhost:8080`）

バックエンドは `--reload` が有効なので、Python ファイルを保存すると自動反映される。フロントエンドも Vite HMR で自動反映。Electron 自体は再起動が必要。

## 重要なファイル

### バックエンド

| ファイル | 役割 |
|---|---|
| `backend/server.py` | FastAPI ルーター。全エンドポイントの定義 |
| `backend/models.py` | Pydantic モデル。リクエスト/レスポンス型 |
| `backend/store.py` | SQLite CRUD。セッション・ワークスペース・記憶 |
| `backend/llm_proxy.py` | llama-server への HTTP プロキシ。システムプロンプト適用・生成統計抽出 |
| `backend/llama_manager.py` | モデル切り替え・イジェクト・llama-server プロセス管理 |
| `backend/config_store.py` | `data/config.json` への設定永続化（`ctx_size`, `n_gpu_layers`, `temperature`, `completion_length`） |
| `backend/settings_store.py` | `data/settings.json` への UI 設定永続化（`show_left`, `show_right`） |
| `backend/system_prompt_store.py` | `data/system_prompts.json` への保存済みシステムプロンプト管理 |
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
| `src/renderer/components/Sidebar.tsx` | 左サイドバー。ワークスペース＋セッションのツリー表示・ドラッグ並べ替え・ワークスペース間移動 |
| `src/renderer/components/ChatView.tsx` | メッセージ一覧。生成統計・メッセージアクションボタン |
| `src/renderer/components/MessageInput.tsx` | 入力エリア。画像添付・トークンリング・インライン補完・選択テキスト校正・送信 |
| `src/renderer/components/SettingsPanel.tsx` | 右サイドバー。システムプロンプト管理・コンテキスト長・GPU オフロード・Temperature・補完長スライダー |
| `src/renderer/styles.css` | 全スタイル（CSS 変数ベース、LM Studio 風ダークテーマ） |

### 設定・データ

| ファイル | 役割 |
|---|---|
| `data/lm_chat.db` | SQLite DB（自動生成） |
| `data/config.json` | `ctx_size`・`n_gpu_layers`・`temperature`・`completion_length` のユーザー設定 |
| `data/settings.json` | UI 設定（`show_left`・`show_right` サイドバー開閉状態） |
| `data/system_prompts.json` | 保存済みシステムプロンプト一覧とアクティブテキスト |
| `data/llama_paths.json` | llama-server の実行ファイルパス（start.bat が書き込み）。モデルパスはアプリからの切り替え時に更新 |
| `start.bat` | 全プロセスの一括起動スクリプト |

`data/*.json`（llama_paths.json, config.json, settings.json, system_prompts.json）はすべて `.gitignore` 対象。

## DB スキーマ（messages テーブル）

```sql
id TEXT, session_id TEXT, role TEXT, content TEXT,
image_data TEXT,           -- 画像（base64 data URL）
created_at TEXT,
completion_tokens INTEGER, -- 生成トークン数（アシスタントのみ）
tokens_per_second REAL,    -- 生成速度
elapsed_seconds REAL,      -- 生成時間（秒）
finish_reason TEXT         -- 停止理由（"stop", "length", "user_stopped" 等）
```

新カラムは `_init_db()` 内の `ALTER TABLE` で既存 DB に自動マイグレーションされる。

## アーキテクチャ上の注意点

### システムプロンプト
- `backend/system_prompt_store.py` が `data/system_prompts.json` に保存済みプロンプト一覧とアクティブテキストを管理
- `SettingsPanel.tsx` で編集・保存・削除 UI を提供（インライン命名、ドロップダウン選択）
- アクティブテキストは `chatStore.systemPromptText` に保持し、`streamChatMessage` / `streamTempChatMessage` 呼び出し時に渡す
- バックエンド `llm_proxy._build_messages()` が受け取った `system_prompt` 引数を使用（空の場合はデフォルト `SYSTEM_PROMPT` 定数にフォールバック）
- トークン数は `POST /tokenize` で取得（debounce 500ms）

### 一時チャット
- `tempChatMode` フラグが ON のとき、`sendTempMessage` がメッセージを DB に書き込まず Zustand の `tempMessages` にのみ保持
- バックエンドは `/chat/temp/stream` エンドポイントで処理（`stream_temp_chat()` in `llm_proxy.py`）
- `ChatView.tsx` は `tempChatMode` のとき `tempMessages` を表示し、ブランチ/編集/削除ボタンを非表示にする
- 一時チャットモードを終了すると `tempMessages` がリセットされる

### 記憶システム
- 記憶はワークスペース単位でスコープ。`workspace_id` でフィルタ必須
- **記憶ボタン（`memory_enabled`）は「過去の記憶を参照するか」を制御するのみ。保存は常に行われる**
- 記憶検索では**現在開いているセッション自身の記憶は除外**し、重複した文脈注入を避ける
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

### インライン補完（オートコンプリート）
- `autocompleteEnabled`（chatStore）が ON のとき、入力テキスト（カーソル前）を 700ms デバウンスで `POST /autocomplete` に送信
- 補完案はゴーストテキスト（薄色）としてテキストエリア上にオーバーレイ表示（`.composer-ghost-layer`）
- Tab で確定（カーソル位置に挿入）、Esc でキャンセル
- テキストが選択されている間は補完を無効化し、代わりに校正モードに入る
- 補完長は `completion_length`（config）で制御（デフォルト 80 トークン）

### 選択テキスト校正
- テキストを範囲選択すると 700ms デバウンスで `POST /correct` に選択テキストを送信
- 校正案はテキストエリアの上に `position: fixed` のポップアップとして表示（紫系ボーダー）
- Tab で選択範囲を校正案に置換（`document.execCommand('insertText')` でネイティブ undo スタックに記録）、Ctrl+Z で元に戻せる
- Esc でキャンセル。校正結果が元テキストと同じ場合はポップアップを表示しない
- `llm_proxy.correct()` は誤字・脱字・文法ミスのみ修正し、内容・表現は変えない指示を持つ

### セッションのワークスペース間移動
- セッションのドラッグハンドルを別ワークスペースのヘッダー行や、そのワークスペース内のセッション行にドロップすると移動できる
- バックエンド `store.move_session()` が `sessions.workspace_id` と `memory_chunks.workspace_id` を同時に更新する（記憶も移動先ワークスペースに帰属が変わる）
- フロントエンドは移動後、移動先ワークスペースのセッション一覧を再取得して状態を更新し、そのセッションにフォーカスを移す
- 同一ワークスペース内でのドラッグは従来通り並べ替えになる（別ワークスペースかどうかは `session.workspace_id` で判定）

### 文書 RAG
- ワークスペース単位で txt / md / json ファイルを取り込める（`POST /documents`）
- `backend/documents/chunker.py` がファイル形式別にチャンク分割（md は見出し優先、json はトップレベルキー/配列単位）
- チャンクは `document_chunks` テーブルに保存し、FTS5（`document_fts`）とベクトル検索（`document_vec`）を両方持つ
- チャット送信時に `build_document_context()` → `combine_contexts()` でワークスペース資料 3 チャンク・会話メモリ 5 チャンク・合計 2000 文字上限の 2 段構えでコンテキストを組み立てる
- サイドバーの各ワークスペース配下に **Documents** セクション（折りたたみ式）を表示
- 資料行をクリックすると `App.tsx` の `currentDocumentId` が更新され、中央エリアに `DocumentEditor` を表示
- `DocumentEditor` は内容を直接編集でき、保存時に再インデックスをバックグラウンド実行する
- `data/assets/documents/{workspace_id}/` にファイル本体を保存

### チャット内検索（Ctrl+F）
- `ChatView.tsx` 内の検索バー（`.chat-search-bar`）で Ctrl+F トグル
- カスタム rehype プラグイン（`makeHighlightPlugin`）が HAST ツリーを走査し、ReactMarkdown レンダリング済みテキストにもインラインハイライトを適用
- 現在のマッチは `.search-highlight.current`（オレンジ系）、その他は `.search-highlight`（黄色系）
- n/N キーまたはボタンで前後のマッチへ移動

### フロントエンドの状態管理
- すべての状態は `chatStore.ts`（Zustand）に集約
- `sendMessage` がストリーミング・記憶保存・セッション更新・タイトル自動生成を担う
- ユーザーが生成を中断した場合（`AbortError`）、部分テキストを `finish_reason: "user_stopped"` + 経過時間・トークン統計付きで DB に保存し、`getSession` で再取得してメッセージ ID を正規化する
- `activeModelPath` が空のときは `MessageInput` のテキストエリア・送信ボタン・画像添付ボタンを無効化する
- モデル切り替えは `applyModelSwitch` が `/llama/switch-model` → ポーリング → 完了を管理
- 左右サイドバーの開閉状態は `App.tsx` の `showLeft`/`showRight` で管理し、初期値は `/settings` API から取得。変更時は即時 PATCH 保存

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
POST /workspaces/reorder

GET  /history/sessions?workspace_id=
POST /history/sessions
GET  /history/sessions/{id}
PATCH /history/sessions/{id}
DELETE /history/sessions/{id}
POST /history/sessions/{id}/messages
GET  /history/sessions/{id}/token_count
POST /history/sessions/{id}/branch        ← 指定メッセージまでのセッションを複製
POST /history/sessions/{id}/move          ← セッションを別ワークスペースへ移動
POST /history/sessions/{id}/generate-title

DELETE /history/messages/{id}
PATCH  /history/messages/{id}             ← メッセージ内容を編集

POST /chat/send
POST /chat/send/stream
POST /chat/temp/stream                    ← 一時チャット（DB 書き込みなし）

POST /memory/save
GET  /memory/search
DELETE /memory/session/{id}
DELETE /memory/workspace/{id}
GET  /memory/stats

GET  /config
PATCH /config                             ← ctx_size, n_gpu_layers, temperature, completion_length

GET  /settings
PATCH /settings                           ← show_left, show_right

GET  /system-prompts
POST /system-prompts
DELETE /system-prompts/{id}
PATCH /system-prompts/active              ← アクティブテキストを保存

POST /tokenize                            ← {"text": str} → {"token_count": int}
POST /autocomplete                        ← {"text": str} → {"completion": str}
POST /correct                             ← {"text": str} → {"corrected": str}

GET  /llama/status
GET  /llama/props                         ← llama-server のモデルプロパティ取得
POST /llama/switch-model
POST /llama/eject                         ← llama-server を停止して VRAM 解放

POST /search/web

GET  /documents?workspace_id=        ← ワークスペース資料一覧
POST /documents                      ← 資料アップロード・インデックス（txt/md/json）
GET  /documents/{id}                 ← 資料取得（content フィールド付き）
PATCH /documents/{id}                ← 資料内容更新・再インデックス
DELETE /documents/{id}               ← 資料削除
```

## よくある問題と対処

### DB スキーマエラー（Dimension mismatch 等）
`data/lm_chat.db` を削除して再起動。

### llama-server が見つからない（Model switch failed）
`data/llama_paths.json` が壊れているか存在しない。`start.bat` を再実行すると `llama_exe` パスが書き直される。

### 起動直後にチャットが入力できない
正常な動作。モデル未選択時はチャット入力が無効になる。上部モデルバーからモデルを選択してロードすること。

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
