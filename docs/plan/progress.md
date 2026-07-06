# Progress

作成日時: 2026-06-07 21:51
更新日時: 2026-06-21

このファイルは、完了した作業、確認したこと、残っている注意点を共有するための進捗管理ドキュメントです。

## 完了

- ワークスペース単位のエクスポート / インポートを追加。
- 左サイドバーのワークスペースメニューからエクスポートできるようにした。
- 左サイドバー上部の「ワークスペース」メニューから「新しく作成」「インポートする」を選べるようにした。
- ワークスペース ZIP の初期ファイル名にワークスペース名を含めるようにした。
- Renderer の型 import エラーを修正し、`npm run build` が通る状態にした。
- Git 履歴をもとに `docs/history/changelog.md` を作成。
- `docs` を進捗管理ファイルと資料フォルダに整理。

## 完了（設定 UI 周り / 2026-06-21）

- 左サイドバー最下部の歯車から開く設定ウインドウを追加。LM Studio 風の「左ナビ + 右ペイン」2 ペイン構成。
- 設定を性質で分離。右サイドバー＝会話中に触る生成コントロール（System Prompt / Completion / Context / Memory / Documents）、設定ウインドウ＝アプリ全体設定（Interface / Runtime / Data / Debug）。
- llama.cpp ランタイムを `data/` から `runtime/` へ移行し、ユーザーデータとランタイムバイナリを分離。
- Runtime 設定を「推論エンジン（llama.cpp）」「埋め込み（ruri-v3）」の 2 グループに整理。グループ見出しを視認しやすくした。
- システムリソース表示の状態を設定（`show_system_resources`）として永続化。設定ウインドウを閉じるとステータスバーが消える不具合も修正。
- システムプロンプト編集をプレビュー / 編集トグル化し、校正ボタンを選択テキスト付近に配置。

## 完了（設定 UI / Model セクション）

- 設定ウインドウに「Model」セクションを追加（左ナビ: Interface → Model → Runtime → Data → Debug）。
- `models/` 内の GGUF を一覧表示し、各モデルをカードで表示。パラメータ規模・量子化・アーキテクチャ・Vision 対応バッジ、コンテキスト長・ファイルサイズ・パスを表示。
- バックエンド `/models/local`（`routes/models.py`）が GGUF メタデータから architecture / name / context_length / parameter_count / multimodal を追加抽出するように拡張。
- 設定ウインドウを開いたときに `listLocalModels()` で再スキャンし、最新の一覧をストアへ反映。
- セクション開閉状態 `settings_model_open` を `settings_store.py` の `_DEFAULTS` に追加し永続化。

## 完了（Ruri v3 プレフィックス対応 / 2026-07-04）

- 埋め込みに Ruri v3 の非対称プレフィックスを導入。`embedder.py` を `embed_query()`（`検索クエリ: `）/ `embed_document()`（`検索文書: `）に分離。
- 記憶・文書 RAG の保存側は `embed_document`、検索側は `embed_query` を使うように全呼び出し箇所を更新。
- 既存 DB の `memory_vec`（454 件）・`document_vec`（127 件）を文書プレフィックス付きで再埋め込み済み（マイグレーションは一回限りのスクリプトで実施、DB 削除は不要だった）。

## 完了（ライブラリ切り替え / パス集約 / 2026-07-07）

- ライブラリ切り替えの土台として、全データパスの解決を単一モジュール `backend/paths.py` に集約。
- パスをライブラリ側（`library_*`: DB・assets・config.json・system_prompts.json）と環境側（`app_*`: settings.json・llama_paths.json）に分類する API を用意。切り替え時は `set_library_root()` でライブラリ側だけ差し替える設計。
- ハードコードされていた `data/` 参照を全廃し `paths.py` 経由に置換: `store_base.py`・`config_store.py`（→ library）・`settings_store.py`（→ app）・`system_prompt_store.py`（→ library）・`llama_manager.py`（→ app、マシン固有）・`routes/deps.py`・`routes/data.py`。
- **この段階ではファイル移動なし**。ライブラリ側・環境側とも従来どおり `<repo>/data` を指すため挙動ゼロ変更。全バックエンドモジュールの import と config/settings/prompts の実データ読み取りを確認済み。
- 未了（次段）: `config.json` を作風・RAG（library）とハード設定 `ctx_size`/`n_gpu_layers`（env）に分割し `n_gpu_layers` の二重を解消。その後にライブラリ切り替え本体（ポインタファイル + Store 再初期化 + UI）と `user_version` 移行フレーム。

## 確認済み

- `npm run build` は成功。
- ワークスペース ZIP の試験エクスポートは成功。

## 注意点

- 会話ごとのシステムプロンプトは、専用フィールドとしてはまだ保存されていない。
- Debug の prompt log が有効な場合のみ、生成時に実際に渡した system prompt を後から確認できる。
- ストーリー制作向けには、全文投入ではなく章要約と作品全体要約を使う設計が必要。
