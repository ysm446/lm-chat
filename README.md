# LM Chat

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
- 会話の分岐、メッセージ編集、メッセージ削除
- 画像添付付きチャット
- 一時チャットモード
- ワークスペース単位の記憶保存と検索
- システムプロンプトの保存 / 切り替え / 上書き
- 入力欄のインライン補完
- 選択テキストの校正提案
- チャット内検索（Ctrl+F）
- 推論パラメータ調整（temperature、ctx_size、GPU layers、completion length）

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
- `C:\Users\kenyo\miniconda3\Scripts\conda.exe` が存在すること
- `main` という名前の conda 環境があること
- `bin\llama-server\llama-b8648-bin-win-cuda-13.1-x64\llama-server.exe` が存在すること
- GGUF モデルファイルを `models/` 配下に置くこと

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
│   ├── search/              # Web 検索まわり
│   └── utils/
├── src/
│   ├── main/                # Electron メイン / preload
│   └── renderer/            # React フロントエンド
│       ├── components/
│       ├── stores/
│       ├── api.ts
│       └── styles.css
├── bin/                     # llama-server バイナリ置き場
├── data/                    # 実行時データ
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
| `lm_chat.db` | SQLite データベース |

これらは実行時データで、通常はリポジトリに含めません。

## 補足

- Web 検索機能のバックエンドは現在スタブ実装です。
- README の起動手順は、現在の `start.bat` の挙動に合わせています。環境依存のパスを変更した場合は、この説明も更新してください。
