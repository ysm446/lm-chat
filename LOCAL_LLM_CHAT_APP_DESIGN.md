# Local LLM Chat App with Long-Term Memory — 設計ドキュメント

## 概要

LM Studio 風のローカルLLMチャットアプリケーションを構築する。
ローカルモデル（Qwen3.5）を使用し、会話履歴を保存しつつ、長期記憶（RAG）を持たせることで、
過去の会話文脈を踏まえた対話を実現する。

### コンセプト

- **完全ローカル完結**: 外部APIに依存せず、データとモデルをローカルに保持する
- **長期記憶**: 過去の会話を蓄積し、関連する文脈を自動で想起する
- **Workspace分離**: 投資、小説、開発メモなど用途ごとに会話・履歴・記憶を完全に分ける
- **マルチモーダル**: テキスト + 画像入力に対応する
- **ウェブ検索**: オプションでローカル検索エンジン経由のWeb検索を行う

---

## 動作環境

| 項目 | スペック |
|------|---------|
| GPU | NVIDIA RTX PRO 5000 (48GB VRAM) |
| OS | Windows（想定） |
| LLM | Qwen3.5（マルチモーダル対応） |
| 推論バックエンド | llama-server（llama.cpp 公式サーバー、OpenAI互換API） |

---

## アーキテクチャ

```
┌──────────────────────────────────────────────────────────────────┐
│  Electron (React + TypeScript)                                   │
│  ┌────────────────┐ ┌────────────────────────┐ ┌──────────────┐  │
│  │ Workspace /    │ │ Chat UI                │ │ Utility      │  │
│  │ History Pane   │ │ (messages, images,     │ │ Panel        │  │
│  │                │ │  streaming input)      │ │              │  │
│  └───────┬────────┘ └───────────┬────────────┘ └──────┬───────┘  │
│          │                      │                      │          │
│  ────────┴──────────────────────┴──────────────────────┴──────    │
│                            IPC Bridge                             │
└───────────────────────────────┬───────────────────────────────────┘
                                │ HTTP (localhost)
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
       ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
       │ llama-server │ │ Memory       │ │ Web Search       │
       │ (llama.cpp)  │ │ Engine       │ │ (SearXNG /       │
       │              │ │ (FastAPI)    │ │  DuckDuckGo)     │
       │ - OpenAI API │ │ - Save       │ │                  │
       │ - Chat       │ │ - Search     │ │ - Query → 結果   │
       │ - Vision     │ │ - Delete     │ │                  │
       │ - Streaming  │ │              │ │                  │
       └──────────────┘ └──────┬───────┘ └──────────────────┘
                               │
                     ┌─────────┴─────────┐
                     ▼                   ▼
              ┌────────────┐    ┌──────────────┐
              │ SQLite DB  │    │ Image Store  │
              │            │    │              │
              │ - 履歴DB   │    │ - 元画像     │
              │ - 記憶DB   │    │ - サムネイル │
              │ - Workspace│    │              │
              └────────────┘    └──────────────┘
```

---

## llama-server プロセス管理

Electron メインプロセスから llama-server を子プロセスとして起動・管理する。

### 起動コマンド例

```powershell
.\bin\llama-server\current\llama-server.exe `
  --model .\models\qwen3.5.gguf `
  --host 127.0.0.1 `
  --port 8080 `
  --ctx-size 32768 `
  --n-gpu-layers -1 `
  --flash-attn `
  --n-parallel 1
```

### 配置ルール

- Windows版 llama-server の配布物は `bin/llama-server/current/` に展開する
- 実装は常に `bin/llama-server/current/llama-server.exe` を参照する
- バージョン名付きフォルダを直接参照しない
- DLL 群は `llama-server.exe` と同じ階層に維持する

### プロセスライフサイクル

```
Electron起動
    │
    ├─ 1. llama-server を child_process.spawn で起動
    ├─ 2. stdout/stderr を監視（ログ表示 + エラーハンドリング）
    ├─ 3. GET /health でヘルスチェック（ポーリング、最大60秒待機）
    ├─ 4. "ready" 確認 → UIにモデルロード完了を通知
    │
    ├─ （通常運用: Electron ↔ llama-server は HTTP通信）
    │
    └─ Electron終了時:
         ├─ llama-server に SIGTERM 送信
         └─ タイムアウト後に SIGKILL（強制終了）
```

### llama-server の利点

- **C++ネイティブ**: Pythonラッパーのオーバーヘッドなし
- **OpenAI互換API**: `/v1/chat/completions`, `/v1/models` 等を標準提供
- **マルチモーダル対応**: `--mmproj` オプションでVision対応モデルをロード可能
- **ヘルスチェック**: `/health` エンドポイントでサーバー状態を確認
- **ストリーミング**: SSE（Server-Sent Events）を標準サポート

---

## 技術スタック

### フロントエンド（Electron）

| 項目 | 技術 |
|------|------|
| フレームワーク | Electron |
| UI | React + TypeScript |
| スタイリング | Tailwind CSS |
| 状態管理 | Zustand |
| Markdown表示 | react-markdown + remark-gfm |
| コードハイライト | highlight.js or Prism |
| 画像表示 | lightbox系ライブラリ |

### バックエンド（Python）

| 項目 | 技術 |
|------|------|
| LLM推論 | llama-server（llama.cpp公式、C++ネイティブ、OpenAI互換API） |
| 記憶エンジンAPI | FastAPI |
| 埋め込みモデル | Ruri v3-310m（日本語特化、CPUでも動作可） |
| データベース | SQLite + sqlite-vec + FTS5 |
| 形態素解析 | 不要（trigramトークナイザ使用） |
| Web検索 | SearXNG（既定）or DuckDuckGo |

### UIデザイン方針

- **LM Studio風の3カラム**: 左に Workspace / 履歴、中央に会話、右に設定・モデル・記憶管理
- **中央ペイン優先**: 会話の可読性を最優先し、ストリーミング応答と画像添付を主役にする
- **Workspaceを常時可視化**: 左ペイン上部と中央ヘッダーに現在の Workspace 名を表示する
- **初回導線を明確化**: Workspace 未作成時は最初の Workspace 作成を前面に出す
- **ローカル感のあるユーティリティUI**: Web検索、記憶ON/OFF、モデル状態を入力欄付近に集約する

---

## データ設計

### 1. チャット履歴DB（history.db）

会話の表示・管理用。Electron UIから直接参照される。

```sql
-- ワークスペース（会話と記憶の分離単位）
CREATE TABLE workspaces (
    id              TEXT PRIMARY KEY,       -- UUID
    name            TEXT NOT NULL,
    description     TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- セッション（1つのチャットスレッド）
CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,       -- UUID
    workspace_id    TEXT NOT NULL,          -- FK → workspaces.id
    title           TEXT,                   -- 自動生成 or ユーザー編集
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    model_name      TEXT,                   -- 使用モデル名
    is_archived     BOOLEAN DEFAULT 0,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- メッセージ
CREATE TABLE messages (
    id              TEXT PRIMARY KEY,       -- UUID
    session_id      TEXT NOT NULL,          -- FK → sessions.id
    role            TEXT NOT NULL,          -- 'user' | 'assistant' | 'system'
    content         TEXT NOT NULL,          -- テキスト内容
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    token_count     INTEGER,                -- トークン数（参考値）
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- 添付画像
CREATE TABLE attachments (
    id              TEXT PRIMARY KEY,       -- UUID
    message_id      TEXT NOT NULL,          -- FK → messages.id
    file_path       TEXT NOT NULL,          -- ローカルファイルパス
    file_name       TEXT NOT NULL,          -- 元のファイル名
    mime_type       TEXT NOT NULL,          -- image/png, image/jpeg 等
    caption         TEXT,                   -- VLMで生成した画像説明（記憶用）
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
```

### 2. 記憶DB（memory.db）

RAG検索用。記憶エンジンが管理する。

```sql
-- 記憶チャンク
CREATE TABLE memory_chunks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id    TEXT NOT NULL,          -- 所属Workspace
    session_id      TEXT NOT NULL,          -- 元の会話セッションID
    chunk_type      TEXT NOT NULL,          -- 'qa_pair' | 'summary' | 'caption'
    content         TEXT NOT NULL,          -- チャンクのテキスト内容
    embedding       BLOB,                   -- ベクトル（sqlite-vec用）
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    message_ids     TEXT                    -- 元メッセージIDのJSON配列
);

-- FTS5 全文検索インデックス（trigram）
CREATE VIRTUAL TABLE memory_fts USING fts5(
    content,
    content='memory_chunks',
    content_rowid='id',
    tokenize='trigram'
);

-- sqlite-vec ベクトルインデックス
CREATE VIRTUAL TABLE memory_vec USING vec0(
    id INTEGER PRIMARY KEY,
    embedding FLOAT[1024]
);
```

### 3. 画像ストレージ（ファイルシステム）

```
~/.local-llm-chat/
├── data/
│   ├── history.db          # Workspace / チャット履歴
│   └── memory.db           # Workspace別の記憶DB
├── images/
│   ├── {workspace_id}/
│   │   ├── {session_id}/
│   │   │   ├── {uuid}.png
│   │   │   └── {uuid}_thumb.jpg
│   └── ...
└── models/
```

---

## 記憶エンジンの設計

### Workspace分離ルール

- 各セッションは必ず1つの Workspace に所属する
- 記憶の保存・検索・注入は、そのセッションと同じ Workspace 内だけで行う
- 他 Workspace の記憶は自動検索しない
- 新規チャット作成時は Workspace 選択を必須とし、未所属セッションは作らない

### チャンク分割ルール

会話をQ&Aペアとしてチャンク化する（LLM不使用、ルールベース）。

```
入力: セッション内の全メッセージ
出力: Q&Aチャンクのリスト

1. ユーザーメッセージ + 直後のアシスタント応答 → 1つのQ&Aペア
2. 画像添付がある場合:
   a. 画像キャプション（VLMで事前生成）をチャンクに含める
   b. 形式: "[画像: {caption}]\n{ユーザーの質問}\n---\n{AIの回答}"
3. 長すぎるチャンク（例: 2000トークン超）は分割
4. システムメッセージは除外
```

### 検索パイプライン

```
クエリ入力（現在のWorkspace内）
    │
    ├──→ workspace_id で絞り込み
    │
    ├──→ FTS5 キーワード検索（trigram）→ 結果 + 順位
    │
    ├──→ Ruri v3 ベクトル化 → sqlite-vec コサイン類似度検索 → 結果 + 順位
    │
    └──→ RRF（Reciprocal Rank Fusion）でスコア統合
              │
              ├──→ 時間減衰適用（半減期: 30日）
              │        score *= 0.5 ^ (経過日数 / 30)
              │
              └──→ 上位N件を返却（デフォルト: 5件）
```

### 記憶の保存タイミング

- **自動保存**: セッション終了時（ウィンドウを閉じる / 新しいチャットを開始する時）
- **手動保存**: UIからトリガー可能（「この会話を記憶に保存」ボタン）
- **バックグラウンド**: LLMは使用しない

### 記憶の注入

LLMへのリクエスト時に、現在の Workspace に属する関連記憶だけをシステムプロンプトに自動注入する。

```text
system: |
  あなたはユーザーの個人アシスタントです。

  ## 関連する過去の会話（現在のWorkspace内の自動検索結果）
  以下は現在のWorkspace内で検索された関連情報です。
  自然に参照してください。存在しない場合は無視してください。

  ---
  [2024-03-15] Q: 日本株の配当戦略を見直したい...
  A: 景気敏感株と高配当株を分けて考えると...
  ---
  [2024-03-20] Q: つみたて枠と成長投資枠の使い分けは？
  A: 長期保有のインデックスをつみたて枠へ...
  ---

  user: {現在のユーザーメッセージ}
```

---

## 削除の設計

### セッション削除フロー

```
ユーザーがチャットを削除
    │
    ├── [デフォルト] 記憶も一緒に削除
    │     ├─ history.db: sessions, messages, attachments を CASCADE削除
    │     ├─ memory.db: session_id で memory_chunks を削除
    │     │             FTS5, vec インデックスも同期更新
    │     └─ ファイル: images/{workspace_id}/{session_id}/ を削除
    │
    └── [オプション] 記憶は残す
          ├─ history.db: 削除
          ├─ memory.db: そのまま保持
          └─ ファイル: 画像は削除（キャプションは記憶チャンクに残る）
```

### Workspace削除フロー

```
ユーザーがWorkspaceを削除
    │
    ├─ history.db: workspaces, sessions, messages, attachments を CASCADE削除
    ├─ memory.db: workspace_id で memory_chunks を削除
    │             FTS5, vec インデックスも同期更新
    └─ ファイル: images/{workspace_id}/ ディレクトリごと削除
```

### 削除時のUI確認

```
┌─────────────────────────────────────┐
│  このチャットを削除しますか？        │
│                                     │
│  ☑ 記憶（長期メモリ）も削除する     │
│                                     │
│  ※ チェックを外すと、チャット履歴は │
│    削除されますが、AIが学習した文脈  │
│    は保持されます。                  │
│                                     │
│       [キャンセル]  [削除する]       │
└─────────────────────────────────────┘
```

---

## 画像の扱い

### 画像保存フロー

```
ユーザーが画像を添付
    │
    ├─ 1. 元画像を images/{workspace_id}/{session_id}/{uuid}.{ext} にコピー
    ├─ 2. サムネイル生成 → {uuid}_thumb.jpg
    ├─ 3. attachments テーブルにレコード挿入（file_path, mime_type）
    ├─ 4. llama-server に画像 + テキストを送信（マルチモーダル推論）
    └─ 5. AI応答の受信後:
         ├─ 応答テキストをメッセージとして保存
         └─ （記憶保存時）画像キャプションを自動生成してチャンクに含める
```

### 画像キャプションの生成

記憶に保存する際、画像の内容をテキストとして残すためにキャプションを生成する。

```python
# セッション終了時（記憶保存時）に実行
caption_prompt = "この画像の内容を簡潔に説明してください。（1-2文）"
caption = llm.generate(image=image_path, prompt=caption_prompt)
chunk_content = f"[画像: {caption}]\nユーザー: {user_message}\n---\nAI: {ai_response}"
```

---

## Electron UIの構成

### 画面レイアウト

```
┌──────────────────┬───────────────────────────────────────┬──────────────────┐
│ Workspace        │ Workspace: 投資                       │ Utility Panel    │
│ [ 投資 ▼ ] [+]   │ Model: Qwen3.5-32B        ⚙ Settings │                  │
│──────────────────│───────────────────────────────────────│ - Model Selector │
│ History          │                                       │ - Memory Status  │
│ + New Chat       │ [AI] こんにちは。前回のポートフォリオ │ - Search Config  │
│                  │ 見直しの続きから始められます。        │ - Workspace Info │
│ ● 2026-03-24     │                                       │                  │
│ ○ 2026-03-22     │ [User] 今週の日本株の見方を整理したい │                  │
│ ○ 2026-03-20     │                                       │                  │
│                  │ [AI] セクターごとに整理すると...      │                  │
│                  │                                       │                  │
│──────────────────│───────────────────────────────────────│──────────────────│
│ Workspace内の    │ [📎] メッセージを入力...      [送信]  │ 記憶管理 / 統計  │
│ 会話だけ表示     │ [🌐 Web検索] [🧠 記憶: ON] [Model]   │                  │
└──────────────────┴───────────────────────────────────────┴──────────────────┘
```

### 画面挙動

- 左ペイン上部に `WorkspaceSwitcher` を配置し、現在の Workspace 名、切り替え、新規作成を集約する
- 左ペイン下部は `HistorySidebar` とし、現在の Workspace に属するセッションのみ表示する
- 中央ペイン上部に現在の Workspace 名を表示し、会話文脈の所属先を見失わないようにする
- 中央下部の入力欄付近に `Web検索`、`記憶: ON/OFF`、モデル状態を並べる
- 右ペインは `SettingsPanel`、`ModelSelector`、記憶管理、Workspace 情報のユーティリティ領域として使う
- 初回起動時は通常のチャット画面ではなく、「最初の Workspace を作成」ビューを優先表示する

### 主要コンポーネント

```
src/
├── main/
│   ├── main.ts
│   ├── ipc-handlers.ts
│   ├── llama-server.ts
│   └── server-manager.ts
│
├── renderer/
│   ├── App.tsx
│   ├── components/
│   │   ├── WorkspaceSwitcher.tsx
│   │   ├── WorkspaceEmptyState.tsx
│   │   ├── ChatView.tsx
│   │   ├── MessageInput.tsx
│   │   ├── HistorySidebar.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── ImageAttachment.tsx
│   │   ├── ModelSelector.tsx
│   │   ├── SettingsPanel.tsx
│   │   └── MemoryIndicator.tsx
│   ├── hooks/
│   │   ├── useChat.ts
│   │   ├── useHistory.ts
│   │   └── useMemory.ts
│   └── stores/
│       └── chatStore.ts
│
├── backend/
│   ├── server.py
│   ├── llm_proxy.py
│   ├── memory/
│   │   ├── engine.py
│   │   ├── chunker.py
│   │   ├── embedder.py
│   │   ├── searcher.py
│   │   └── db.py
│   ├── search/
│   │   └── web_search.py
│   └── utils/
│       └── image_utils.py
│
└── shared/
    └── types.ts
```

---

## API設計（FastAPIバックエンド）

### チャット

```
POST /v1/chat/completions
  - ストリーミング対応（SSE）
  - リクエスト前に現在Workspace内の関連記憶を検索し、system promptに注入
  - 画像はbase64でリクエストに含める
```

### Workspace

```
GET    /workspaces
POST   /workspaces
PATCH  /workspaces/{id}
DELETE /workspaces/{id}
```

### 記憶

```
POST   /memory/save
  body: { session_id, messages: [...] }

GET    /memory/search
  params: { query, workspace_id, top_k=5 }

DELETE /memory/session/{id}

DELETE /memory/workspace/{id}

GET    /memory/stats
```

### 履歴

```
GET    /history/sessions
  params: { workspace_id }

POST   /history/sessions
  body: { workspace_id, ... }

GET    /history/sessions/{id}

DELETE /history/sessions/{id}
  params: { delete_memory=true }

PATCH  /history/sessions/{id}
```

### Web検索

```
POST /search/web
  body: { query, max_results=5 }
```

---

## 実装フェーズ

### Phase 1: 基盤（MVP）

**目標**: テキストチャットが動く最小構成

1. llama-server のバイナリ起動・プロセス管理
2. Electron + React の LM Studio風3カラムUI
3. ストリーミング応答表示
4. Workspace 作成・切り替え・初回導線
5. Workspace別チャット履歴の保存・表示（SQLite）
6. セッション管理（新規作成、切り替え、削除）

### Phase 2: 記憶エンジン

**目標**: 長期記憶が機能する

1. チャンク分割ロジック（Q&Aペア方式）
2. Ruri v3 での埋め込みベクトル生成
3. SQLite + FTS5 + sqlite-vec のセットアップ
4. ハイブリッド検索（キーワード + ベクトル + RRF + 時間減衰）
5. Workspace単位の記憶分離
6. セッション終了時の自動記憶保存
7. 記憶のシステムプロンプト注入
8. 記憶のON/OFFトグル

### Phase 3: マルチモーダル + 画像

**目標**: 画像添付と画像記憶が動く

1. 画像添付UI（ドラッグ&ドロップ、クリップボード貼り付け）
2. 画像のローカル保存・サムネイル生成
3. llama-server へのマルチモーダルリクエスト
4. 画像キャプション自動生成（記憶保存時）
5. 削除時の画像ファイルクリーンアップ

### Phase 4: Web検索 + 仕上げ

**目標**: 実用レベルの完成度

1. SearXNG 統合（DuckDuckGoは代替エンジンとして保持）
2. 検索結果のUI表示（ソース表示、引用リンク）
3. 設定画面（モデル選択、記憶パラメータ、テーマ、検索設定）
4. アプリ全体のパッケージング（electron-builder）
5. 記憶の管理画面（統計表示、手動削除、エクスポート）
6. Workspace の管理画面（作成、名称変更、削除）

---

## 設定項目

```yaml
# config.yaml（デフォルト値）
llm:
  model_path: "./models/qwen3.5.gguf"
  context_length: 32768
  gpu_layers: -1
  host: "127.0.0.1"
  port: 8080
  llama_server_path: "./bin/llama-server/current/llama-server.exe"
  n_parallel: 1
  flash_attn: true

memory:
  enabled: true
  auto_save: true
  embedding_model: "cl-nagoya/ruri-v3-310m"
  search_top_k: 5
  time_decay_half_life_days: 30
  chunk_max_tokens: 2000

search:
  enabled: false
  engine: "searxng"             # "searxng" | "duckduckgo"
  searxng_url: "http://localhost:8888"
  max_results: 5

ui:
  theme: "dark"
  font_size: 14
  send_key: "Enter"             # "Enter" | "Ctrl+Enter"
  layout: "three-pane-lm-studio"
  show_right_panel: true
```

---

## 受け入れ条件

- UI は LM Studio 風の3カラム構成で、左に Workspace / 履歴、中央に会話、右に設定・モデル・記憶管理を持つ
- 新規チャット作成時は Workspace 選択が必須で、未所属セッションは存在しない
- 履歴表示、記憶保存、記憶検索、記憶注入はすべて現在の Workspace 内だけで完結する
- `llama-server` は `bin/llama-server/current/llama-server.exe` を固定参照する
- Web検索の既定エンジンは SearXNG である
- 初回起動時は Workspace 作成導線が最優先で表示される

---

## 参考資料

- [sui-memory 設計記事](https://zenn.dev/noprogllama/articles/7c24b2c2410213)
- [llama.cpp / llama-server](https://github.com/ggerganov/llama.cpp)
- [Ruri v3](https://huggingface.co/cl-nagoya/ruri-v3-310m)
- [sqlite-vec](https://github.com/asg017/sqlite-vec)
- [SearXNG](https://github.com/searxng/searxng)
