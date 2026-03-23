# LM Chat

ローカル LLM を使ったプライベートチャットアプリ。推論・記憶・検索がすべてローカルで完結します。

## 機能

- **ワークスペース管理** — チャット履歴と記憶をワークスペース単位で分離
- **ストリーミングチャット** — SSE によるリアルタイムトークン表示
- **長期記憶** — 過去の会話を自動で埋め込み・検索してプロンプトに注入（ワークスペース単位でスコープ）
- **モデル切り替え** — UI から GGUF モデルを選択して llama-server を再起動、前回選択を次回起動時に復元
- **思考モードトグル** — Qwen3 系モデルの thinking モードを ON/OFF
- **トークン使用量バー** — コンテキスト使用率をリアルタイムで可視化（緑／黄／赤）
- **コンテキスト長設定** — UI から `--ctx-size` を変更して次回起動に反映
- **セッションタイトル自動生成** — 最初のメッセージから自動生成
- **インライン名前変更** — ワークスペース・チャット名をインラインで編集
- **Markdown レンダリング** — コードブロック・テーブル・リスト対応

## アーキテクチャ

```
┌──────────────────────────────────────────────┐
│  Electron (src/main/main.ts)                 │
│  ┌────────────────────────────────────────┐  │
│  │  React + TypeScript (src/renderer/)    │  │
│  │  Zustand store / SSE streaming         │  │
│  └─────────────────┬──────────────────────┘  │
└────────────────────┼─────────────────────────┘
                     │ HTTP localhost:8000
┌────────────────────▼─────────────────────────┐
│  FastAPI (backend/server.py)  port 8000      │
│  SQLite  data/lm_chat.db                     │
│  sqlite-vec  ベクトル KNN 検索               │
│  sentence-transformers  ruri-v3-310m 埋め込み │
└─────────────────────┬────────────────────────┘
                      │ HTTP localhost:8080
┌─────────────────────▼────────────────────────┐
│  llama-server (llama.cpp)  port 8080         │
│  GGUF モデル (models/ フォルダ)               │
└──────────────────────────────────────────────┘
```

## 必要な環境

- Windows 10/11（CUDA 対応 GPU 推奨）
- [Miniconda](https://docs.conda.io/en/latest/miniconda.html) — conda 環境名 `main`
- [Node.js](https://nodejs.org/) + npm
- [llama.cpp リリース](https://github.com/ggerganov/llama.cpp/releases) の `llama-server.exe`

## セットアップ

### 1. Python 依存関係

```powershell
conda activate main
pip install -r backend/requirements.txt
```

### 2. Node.js 依存関係

```powershell
npm install
```

### 3. ファイル配置

```
bin/
  llama-server/
    llama-b8466-bin-win-cuda-13.1-x64/
      llama-server.exe          ← llama.cpp リリースから配置

models/
  YourModel-GGUF/
    yourmodel.Q4_K_M.gguf       ← GGUF モデルを配置
```

### 4. `start.bat` を編集

先頭の変数をご自身の環境に合わせて変更します。

```batch
set "CONDA_EXE=C:\Users\yourname\miniconda3\Scripts\conda.exe"
set "LLAMA_SERVER_EXE=%CD%\bin\..."
set "DEFAULT_MODEL=%CD%\models\..."
```

## 起動

```batch
start.bat
```

llama-server・バックエンド・フロントエンドを順に起動し、Electron ウィンドウを開きます。
Electron ウィンドウを閉じると全プロセスが自動停止します。

初回起動時は埋め込みモデル（`ruri-v3-310m`、約 600 MB）が自動ダウンロードされます。

## フォルダ構成

```
lm-chat/
├── backend/
│   ├── server.py            FastAPI エンドポイント
│   ├── models.py            Pydantic モデル定義
│   ├── store.py             SQLite CRUD
│   ├── llm_proxy.py         llama-server プロキシ・トークナイザ
│   ├── llama_manager.py     モデル切り替え（プロセス管理）
│   ├── config_store.py      設定の永続化 (data/config.json)
│   ├── memory/
│   │   ├── engine.py        記憶の保存・検索エントリポイント
│   │   ├── embedder.py      ruri-v3-310m による埋め込み生成
│   │   └── chunker.py       Q&A ペアチャンキング
│   └── requirements.txt
├── src/
│   ├── main/main.ts         Electron メインプロセス
│   └── renderer/
│       ├── App.tsx
│       ├── api.ts           バックエンド API クライアント
│       ├── stores/chatStore.ts  Zustand グローバルストア
│       ├── components/
│       │   ├── ChatView.tsx
│       │   ├── MessageInput.tsx
│       │   ├── ModelSelector.tsx
│       │   ├── HistorySidebar.tsx
│       │   ├── WorkspaceSwitcher.tsx
│       │   └── SettingsPanel.tsx
│       └── styles.css
├── data/                    自動生成（Git 管理外）
│   ├── lm_chat.db           SQLite データベース
│   ├── config.json          ctx_size 等の設定
│   └── llama_paths.json     llama-server パス・前回モデル
├── models/                  GGUF モデル置き場（Git 管理外）
├── bin/                     llama-server バイナリ（Git 管理外）
└── start.bat                一括起動スクリプト
```

## 記憶システム

各会話ターンを Q&A ペアとしてチャンキングし SQLite に保存します。

- **FTS5 trigram** によるキーワード検索
- **sqlite-vec** による埋め込みベクトル KNN 検索
- Reciprocal Rank Fusion (RRF) + 時間減衰でスコアを統合
- 記憶はワークスペース単位でスコープ — 他ワークスペースの記憶は参照されない

## 手動起動（開発用）

```powershell
# バックエンド
conda activate main
python -m uvicorn backend.server:app --reload

# フロントエンド（別ターミナル）
npm run dev

# Electron（別ターミナル）
$env:VITE_DEV_SERVER_URL='http://127.0.0.1:5173'
npm run electron:dev
```

## 補足

- `bin/`、`models/`、`node_modules/`、`dist/`、`data/` は Git 管理対象外です。
- モデルは UI のヘッダーから切り替え可能。選択は次回起動時にも維持されます。
- コンテキスト長は右パネルの設定から変更できます（再起動後に反映）。
