# LM Chat

ローカル環境で動作する LLM チャットアプリの試作プロジェクトです。

主な特徴:

- Electron + React + TypeScript ベースのデスクトップ UI
- `workspace` 単位で分離された会話履歴と記憶
- ローカル `llama-server` 連携
- SQLite による永続化
- ストリーミング応答表示

現在は、ローカル完結のチャット体験、`workspace` 分離、簡易な長期記憶フローを中心に実装を進めている段階です。

## 現在できること

- `workspace` ごとの会話分離
- `workspace` ごとのセッション履歴表示
- `workspace`、セッション、メッセージ、記憶チャンクの SQLite 保存
- FastAPI バックエンド
- `llama-server` の OpenAI 互換 `/v1/chat/completions` 連携
- UI 上でのストリーミング応答表示
- 会話ターンごとの自動記憶保存
- 現在の `workspace` 内に限定した記憶検索・注入

## 技術スタック

- Electron
- React
- TypeScript
- Zustand
- FastAPI
- SQLite
- llama.cpp `llama-server`

## ディレクトリ構成

```text
backend/        FastAPI バックエンド、記憶処理、SQLite ストア
src/main/       Electron main / preload
src/renderer/   React UI
data/           SQLite DB などのローカル実行データ
models/         ローカル GGUF モデル（Git 管理外）
bin/            ローカル llama-server バイナリ（Git 管理外）
```

## 動作前提

- Windows
- Node.js + npm
- Conda
- `main` という conda 環境
- ローカルの `llama-server.exe`
- 対応する GGUF モデルと `mmproj` ファイル

## 起動方法

いちばん簡単なのは `start.bat` を使う方法です。

```bat
start.bat
```

このバッチで以下が起動します。

- `llama-server` on `127.0.0.1:8080`
- FastAPI backend on `127.0.0.1:8000`
- Vite frontend on `127.0.0.1:5173`
- Electron desktop app

Electron を閉じると、backend / frontend / `llama-server` も停止する想定です。

## 手動起動

### 1. Backend

```powershell
& 'C:\Users\kenyo\miniconda3\Scripts\conda.exe' run -n main python -m uvicorn backend.server:app --reload
```

### 2. Frontend

```powershell
npm run dev
```

### 3. Electron

```powershell
$env:VITE_DEV_SERVER_URL='http://127.0.0.1:5173'
npm run electron:dev
```

## 開発用コマンド

依存関係のインストール:

```powershell
npm install
```

型チェック:

```powershell
npm run typecheck
```

ビルド:

```powershell
npm run build
```

## 補足

- `bin/`, `models/`, `node_modules/`, `dist/`, 実行時 DB は Git 管理対象外です。
- UI はローカルアプリらしい見た目を意識しつつ、現在は VS Code / LM Studio に近いフラット寄りの方向へ調整しています。
- 記憶はまだシンプルなテキストチャンク方式で、現在の `workspace` に限定して検索・注入しています。

## 現在の実装状況

実装済み:

- ローカルアプリの基本シェル
- `workspace` モデル
- セッション履歴
- SQLite 永続化
- `llama-server` リクエスト経路
- ストリーミング応答
- 記憶の自動保存と自動注入

未完了:

- セッション削除 UI
- 設定画面の配線
- SearXNG の本実装
- 記憶検索・チャンク化の高度化
- 本番パッケージング整備
