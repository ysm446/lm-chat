# LM Chat

ローカル LLM と会話するデスクトップチャットアプリ。すべてローカル完結で動作する。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| デスクトップ | Electron |
| フロントエンド | React + TypeScript（Vite） |
| バックエンド | Python / FastAPI |
| LLM 推論 | llama-server（llama.cpp） |
| DB | SQLite |
| 埋め込み | ruri-v3-310m（記憶機能用） |

## 主な機能

- **チャット** — ストリーミング生成、生成統計（トークン数・速度・時間）表示
- **マルチモーダル** — 画像添付（mmproj モデル対応）
- **ワークスペース / セッション管理** — 複数の会話を整理、ブランチ・編集・削除
- **記憶システム** — 会話内容を自動保存・検索し、次回以降の会話に反映（ワークスペース単位）
- **一時チャット** — DB に記録しない使い捨てモード
- **システムプロンプト** — 複数のプロンプトを保存・切り替え
- **インライン補完** — VS Code 風ゴーストテキスト（Tab で確定）
- **選択テキスト校正** — テキストを選択すると誤字・文法ミスの修正案をポップアップ表示（Tab で置換、Ctrl+Z で元に戻し可）
- **チャット内検索** — Ctrl+F でキーワード検索・ハイライト（ReactMarkdown 内も対応）
- **パラメータ調整** — Temperature・コンテキスト長・GPU オフロード・補完長をスライダーで設定

## 起動

```batch
start.bat
```

初回起動時に Python 依存パッケージと Node モジュールが自動インストールされる。

起動後、上部モデルバーから GGUF モデルを選択するとチャットが開始できる。

## 必要なもの

- Windows（llama-server の起動に `taskkill` を使用）
- Python 3.10 以上
- Node.js 18 以上
- llama-server 実行ファイル（`start.bat` がパスを自動検出）
- GGUF 形式のモデルファイル（`models/` に配置）

## ディレクトリ構成

```
lm-chat/
├── backend/          # FastAPI バックエンド
│   ├── server.py     # エンドポイント定義
│   ├── llm_proxy.py  # llama-server へのプロキシ
│   ├── store.py      # SQLite CRUD
│   └── memory/       # 記憶システム（埋め込み・検索）
├── src/
│   ├── main/         # Electron メインプロセス
│   └── renderer/     # React フロントエンド
│       ├── components/
│       ├── stores/   # Zustand ストア
│       └── api.ts    # API クライアント
├── data/             # 実行時データ（.gitignore 対象）
├── models/           # GGUF モデル置き場（.gitignore 対象）
└── start.bat         # 一括起動スクリプト
```

## 設定ファイル（data/）

| ファイル | 内容 |
|---|---|
| `config.json` | ctx_size・n_gpu_layers・temperature・completion_length |
| `settings.json` | サイドバー開閉状態 |
| `system_prompts.json` | 保存済みシステムプロンプト |
| `llama_paths.json` | llama-server 実行ファイルのパス |
| `lm_chat.db` | SQLite データベース |

いずれも `.gitignore` 対象のためリポジトリには含まれない。
