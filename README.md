# LM Chat

ローカル LLM を使ったプライベートチャットアプリ。推論・記憶・検索がすべてローカルで完結します。

## 機能

- **ワークスペース管理** — チャット履歴と記憶をワークスペース単位で分離
- **ストリーミングチャット** — SSE によるリアルタイムトークン表示
- **長期記憶** — 過去の会話を自動で埋め込み・検索してプロンプトに注入（ワークスペース単位でスコープ）
- **モデル選択UI** — 上部バーから GGUF モデルをダイアログで選択・ロード、イジェクトで VRAM 解放
- **サイドバートグル** — 左右サイドバーを個別に表示/非表示
- **会話分岐** — 任意のメッセージ地点からブランチを作成
- **画像添付** — ビジョンモデル対応。画像を添付して質問
- **生成統計** — 各返答の末尾にトークン数・速度・経過時間・停止理由を表示（ユーザー停止時も部分回答を保存）
- **思考モードトグル** — Thinking 対応モデルの推論過程を ON/OFF
- **トークンリング** — コンテキスト使用率をリアルタイムで可視化
- **コンテキスト長 / GPU オフロード設定** — 右パネルのスライダーで設定、次回ロード時に反映
- **メッセージ操作** — コピー・編集・削除・分岐をメッセージ単位で実行
- **セッションタイトル自動生成** — 最初のメッセージから自動生成

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
    yourmodel-mmproj.gguf       ← ビジョンモデルの場合は mmproj も同ディレクトリに
```

### 4. `start.bat` を編集

先頭の変数をご自身の環境に合わせて変更します。

```batch
set "CONDA_EXE=C:\Users\yourname\miniconda3\Scripts\conda.exe"
set "LLAMA_SERVER_EXE=%CD%\bin\..."
```

## 起動

```batch
start.bat
```

バックエンド・フロントエンドを起動し、両方が応答可能になってから Electron ウィンドウを開きます。
**llama-server は起動しません。** アプリ上部のモデルバーからモデルを選択すると llama-server が起動します。
Electron ウィンドウを閉じると全プロセスが自動停止します。

初回起動時は埋め込みモデル（`ruri-v3-310m`、約 600 MB）が自動ダウンロードされます。埋め込みモデルはサーバー起動時にバックグラウンドでウォームアップされるため、初回の記憶検索も遅延なく動作します。

## フォルダ構成

```
lm-chat/
├── backend/
│   ├── server.py            FastAPI エンドポイント
│   ├── models.py            Pydantic モデル定義
│   ├── store.py             SQLite CRUD
│   ├── llm_proxy.py         llama-server プロキシ・生成統計抽出
│   ├── llama_manager.py     モデル切り替え・イジェクト（プロセス管理）
│   ├── config_store.py      設定の永続化 (data/config.json)
│   ├── memory/
│   │   ├── engine.py        記憶の保存・検索エントリポイント
│   │   ├── embedder.py      ruri-v3-310m による埋め込み生成
│   │   └── chunker.py       Q&A ペアチャンキング
│   └── requirements.txt
├── src/
│   ├── main/main.ts         Electron メインプロセス
│   └── renderer/
│       ├── App.tsx          ルートレイアウト・サイドバー開閉
│       ├── api.ts           バックエンド API クライアント
│       ├── stores/chatStore.ts  Zustand グローバルストア
│       ├── components/
│       │   ├── ModelBar.tsx          上部モデルバー
│       │   ├── ModelPickerModal.tsx  モデル選択ダイアログ
│       │   ├── Sidebar.tsx           左サイドバー（ワークスペース・セッションツリー）
│       │   ├── ChatView.tsx          メッセージ一覧・生成統計
│       │   ├── MessageInput.tsx      入力エリア・画像添付・トークンリング
│       │   └── SettingsPanel.tsx     右パネル（コンテキスト長・GPU 設定）
│       └── styles.css
├── data/                    自動生成（Git 管理外）
│   ├── lm_chat.db           SQLite データベース
│   ├── config.json          ctx_size・n_gpu_layers 等の設定
│   └── llama_paths.json     llama-server exe パス（モデルはアプリから選択）
├── models/                  GGUF モデル置き場（Git 管理外）
├── bin/                     llama-server バイナリ（Git 管理外）
└── start.bat                一括起動スクリプト
```

## 記憶システム

各会話ターンを Q&A ペアとしてチャンキングし SQLite に保存します。

- **FTS5 trigram** によるキーワード検索（workspace フィルタを JOIN で1クエリに統合）
- **sqlite-vec** による埋め込みベクトル KNN 検索
- Reciprocal Rank Fusion (RRF) + 時間減衰でスコアを統合
- 埋め込みは `@lru_cache` でキャッシュされ、同じクエリの再推論をスキップ
- 記憶はワークスペース単位でスコープ — 他ワークスペースの記憶は参照されない

**記憶ボタンについて**: オフにすると過去の記憶を参照せずに送信します。ただし会話の**保存は常に行われます**。

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
- 起動直後はモデル未選択状態です。上部バーのモデルバーからモデルを選択してロードしてください。モデルが選択されていない間はチャット入力が無効になります。イジェクトボタンで VRAM を即時解放できます。
- コンテキスト長・GPU オフロード層数は右パネルのスライダーで設定（次回モデルロード時に反映）。
- サイドバーは上部バーの左右パネルアイコンで個別に表示/非表示を切り替え可能。
