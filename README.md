# LM Chat

## アーキテクチャ概要

### 役割分担

- React はチャット画面、設定画面、サイドバーなどの UI を描画し、ユーザー操作に応じて表示を更新します。
- Electron は React アプリを Windows デスクトップアプリとして起動し、ウィンドウ管理と preload 経由の安全な実行環境を提供します。
- Python / FastAPI は API、会話履歴保存、システムプロンプト管理、記憶検索、画像保存、`llama-server` との連携を担当します。
- `llama-server` は補完・校正・チャット応答を実際に生成する推論エンジンです。

要するに、React は画面、Electron はデスクトップアプリの土台、Python は裏側ロジック、`llama-server` は推論本体です。

### メッセージ送信の流れ

1. React 側の UI で送信操作を受け取り、Electron 上のフロントエンドから Python バックエンドの API を呼び出します。
2. Python バックエンドは、ユーザーメッセージや画像を保存し、必要に応じて過去の記憶を検索して追加コンテキストを組み立てます。
3. Python バックエンドは、会話履歴・system prompt・記憶コンテキストをまとめて `llama-server` に渡し、推論を開始します。
4. 生成された返答はストリーミングでフロントエンドに返され、画面へ少しずつ表示されます。
5. 生成完了後、返答はセッション履歴と記憶ストアに保存され、次回以降の検索や会話に再利用されます。

ローカル LLM と会話する Windows 向けデスクトップチャットアプリです。Electron + React の UI と、FastAPI ベースのローカルバックエンドで構成されています。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| デスクトップ | Electron |
| フロントエンド | React + TypeScript + Vite |
| バックエンド | Python / FastAPI |
| 状態管理 | Zustand |
| Markdown 表示 | react-markdown + remark-gfm |
| DB | SQLite |
| 埋め込み / 記憶 | sentence-transformers + sqlite-vec |
| LLM 推論 | llama-server（llama.cpp） |

## 主な機能

- ローカル GGUF モデルの読み込み / 切り替え / アンロード
- ストリーミングチャットと生成統計表示（tok/sec、token 数、経過時間）
- ワークスペース / セッション管理
- セッションとワークスペースのドラッグ並べ替え
- セッションのワークスペース間ドラッグ移動
- 会話の分岐、メッセージ編集、メッセージ削除
- 画像添付付きチャット
- 一時チャットモード
- ワークスペース単位の記憶保存と検索
- ワークスペース単位の Documents 管理と Document RAG
- システムプロンプトの保存 / 切り替え / 上書き
- assistant ごとの「送信直前 messages」保存と確認
- 入力欄のインライン補完
- 選択テキストの校正提案
- チャット内検索（Ctrl+F）
- 推論パラメータ調整（temperature、ctx_size、GPU layers、completion length）
- 下部システムリソースバー（CPU / RAM / GPU / VRAM）

## Document RAG

- ワークスペースごとに `.txt` / `.md` / `.json` ファイルを `Documents` に取り込めます。
- 取り込んだファイルはチャンク化・埋め込みされ、会話時に補助コンテキストとして検索利用されます。
- Documents はサイドバーから参照・編集・削除でき、更新時は再インデックスされます。
- ファイル本体は `data/assets/documents/{workspace_id}/` 配下に保存されます。

## 起動

通常起動:

```bat
start.bat
```

`start.bat` は以下を順に行います。

1. `data/llama_paths.json` を生成
2. FastAPI バックエンドを起動
3. Vite 開発サーバーを起動
4. Electron を開く

## 前提条件

現状の `start.bat` は次の前提に依存しています。

- Windows
- `npm` が PATH に通っていること
- プロジェクト直下に Python venv（`.venv`）が作成され、`backend/requirements.txt` の依存関係がインストールされていること
- GGUF モデルファイルを `models/` 配下に置くこと

venv の作成（初回のみ）:

```batch
py -m venv .venv
.venv\Scripts\python -m pip install -r backend\requirements.txt
```

llama.cpp server Runtime は初回起動時点では未インストールでも構いません。アプリ起動後、設定画面の Runtime 設定からインストールしてください。

初回セットアップ時は、必要に応じて以下も用意してください。

- Node.js 18+
- Python 3.10+
- `backend/requirements.txt` の Python 依存関係

## 開発用コマンド

フロントエンド:

```bash
npm run dev
```

型チェック:

```bash
npm run typecheck
```

ビルド:

```bash
npm run build
```

Electron 単体起動:

```bash
npm run electron:dev
```

バックエンドは `backend.server:app` を uvicorn で起動します。

## ディレクトリ構成

```text
lm-chat/
├── backend/                 # FastAPI バックエンド
│   ├── server.py            # API エンドポイント
│   ├── llama_manager.py     # llama-server の起動 / 切り替え / 状態管理
│   ├── llm_proxy.py         # LLM 呼び出しとストリーミング処理
│   ├── store.py             # SQLite CRUD
│   ├── config_store.py      # 推論設定の保存
│   ├── settings_store.py    # UI 設定の保存
│   ├── system_prompt_store.py
│   ├── memory/              # 記憶システム
│   ├── documents/           # Document RAG のチャンク化処理
│   ├── search/              # Web 検索まわり
│   └── utils/
├── src/
│   ├── main/                # Electron メイン / preload
│   └── renderer/            # React フロントエンド
│       ├── components/
│       ├── stores/
│       ├── api.ts
│       └── styles.css
├── data/                    # 実行時データ / llama.cpp Runtime
├── models/                  # ローカル GGUF モデル置き場
├── assets/
└── start.bat
```

## 実行時データ

`data/` には実行時に次のようなファイルが作られます。

| ファイル | 内容 |
|---|---|
| `config.json` | 推論設定 |
| `settings.json` | UI 設定（サイドバー表示など） |
| `system_prompts.json` | 保存済みシステムプロンプト |
| `llama_paths.json` | llama-server と現在モデルのパス情報 |
| `lm_chat.db` | SQLite データベース本体（セッション、メッセージ、記憶、Documents、保存済みプロンプト全文など） |

実体の場所は `data/lm_chat.db` です。

これらは実行時データで、通常はリポジトリに含めません。

## 補足

- Web 検索機能のバックエンドは現在スタブ実装です。
- README の起動手順は、現在の `start.bat` の挙動に合わせています。環境依存のパスを変更した場合は、この説明も更新してください。
