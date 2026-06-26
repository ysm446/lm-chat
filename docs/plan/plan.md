# Plan

作成日時: 2026-06-07 21:51
更新日時: 2026-06-21

このファイルは、次に進める作業を相談しながら整理するための進捗管理ドキュメントです。

## 現在の優先候補

- ストーリー制作向けの章要約、作品全体レビュー、伏線整理の設計。
- ワークスペースエクスポート / インポートの実運用確認。
- システムプロンプト、会話要約、Documents、memory の責務整理。

## 次に検討すること

- 会話ごとに保存する要約データの形式。
- ワークスペース全体レビュー時に LLM へ渡す情報の優先順位。
- 保存済みシステムプロンプトと、会話で実際に使われたプロンプトの扱い。

## 構想: ライブラリ（データルート）切り替え

Obsidian の vault に近い形で、アプリが開く「ライブラリ（データルート）」を切り替えられるようにする構想。

- 階層: ライブラリ（フォルダ＝開く単位、完全分離）の中に既存のワークスペース（DB 内、文脈分離）が入る。**ワークスペースは廃止せず温存**し、フォルダ分離とは役割を分ける。
- 利点: 用途ごとに完全独立した DB を持てて記憶の混入が起きない。フォルダを丸ごとコピーするだけでバックアップ/移動できる。既存のワークスペース ZIP エクスポート/インポートは「ライブラリ間で 1 ワークスペースだけ移す」用途として残る。
- 同時に開くのは 1 ライブラリのみとする想定（横断検索は諦め、分離を優先）。
- 実装時にまず決めること:
  - **ライブラリ単位 / アプリ共通の線引き**（最重要）。ライブラリ側候補: `lm_chat.db`・`assets/`・`system_prompts.json`・`config.json`。アプリ共通候補: `runtime/`・`models/`・`llama_paths.json`・UI 設定（`show_left/right` 等）。
  - 起動時に解決する単一の `DATA_ROOT` へパスを集約する（現状は `data` がハードコード: `store_base.py`・`config_store.py`・`settings_store.py`・`routes/deps.py`・`memory/db.py` 等）。アクティブライブラリのパスは `~/.lmchat/active` のような小さなポインタファイルで保持。
  - 切り替え UI（最近開いたライブラリ、開く/作成）と、切り替え時のバックエンド再初期化の扱い。

## 構想: 生成メッセージのバージョン管理

再生成したアシスタント応答を版として保持し、以前の版に戻せるようにする構想。

- 現状: 再生成は `store.replace_message()`（`routes/chat.py`）で**上書き＝破壊的**。旧版は消える。
- 方式: `message_versions` テーブルを追加し、`messages` 行は常にアクティブ版を保持（既存の読み取りコードは変更不要）。過去の版を `message_versions` に退避する。
  - 列イメージ: `id` / `message_id` / `content` / `completion_tokens` / `tokens_per_second` / `elapsed_seconds` / `finish_reason` / `model_name` / `created_at` / `version_index`。`_init_db()` の ALTER/CREATE で自動マイグレーション。
  - 再生成時: 上書き前に旧 content を版として退避し、新版も記録。
  - 切替時: `messages.content` を選択版へ差し替え＋セッション記憶を再構築（既存の再生成処理を流用）。
- UI: アシスタントメッセージに `‹ 2/3 ›` 形式のページャ（`ChatView.tsx` のアクションボタン群付近）。`chatStore` に版取得/切替アクション、`api.ts` にクライアント関数。
- 新エンドポイント: `GET .../messages/{id}/versions`、`POST .../messages/{id}/active-version`、版削除用の `DELETE .../messages/versions/{id}`。
- **版が増え続けないように個数制限と削除を入れる**:
  - 保持上限（例: 直近 N 版）を設け、超過分は古い版から自動削除。
  - 不要な版を手動削除できる UI。
- データ量: 版はテキスト行のみ（画像 `image_data` は再生成対象外）で 1 版あたり数 KB 程度。実質ほぼ無視できる。上限はデータ量対策というより UI/整理目的。
- 決めること: 編集（PATCH メッセージ）も版として扱うか（まずは再生成のみに絞るのが手堅い）。上限の既定値。

## 参照資料

- アーキテクチャ: `docs/reference/architecture/`
- RAG と記憶検索: `docs/reference/rag/`
- ランタイムとコンテキスト長: `docs/reference/runtime/`
- 旧計画メモ: `docs/reference/plans/`
- 更新履歴: `docs/changelog.md`
