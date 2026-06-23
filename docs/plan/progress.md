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

## 確認済み

- `npm run build` は成功。
- ワークスペース ZIP の試験エクスポートは成功。

## 注意点

- 会話ごとのシステムプロンプトは、専用フィールドとしてはまだ保存されていない。
- Debug の prompt log が有効な場合のみ、生成時に実際に渡した system prompt を後から確認できる。
- ストーリー制作向けには、全文投入ではなく章要約と作品全体要約を使う設計が必要。
