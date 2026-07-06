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
## 完了（config.json 分割 / ハード設定の一本化 / 2026-07-07）

- ハード設定 `ctx_size`・`n_gpu_layers` をライブラリ側 `config.json` から環境側 `runtime.json` へ分離（新設 `backend/runtime_store.py`）。マシン固有なのでライブラリ切り替えで不変。
- `config.json`（`config_store`）は作風・RAG チューニング専用に。`_DEFAULTS` から `ctx_size`/`n_gpu_layers` を除去。
- `/config` エンドポイントは **マージ façade** に変更。GET は runtime+config をマージして従来通りのビューを返し、PATCH はキーを振り分けて各ストアへ書く。→ フロント（MessageInput トークンリング・history token_count）は無改修で動作。
- `n_gpu_layers` の二重を解消。実態は `llama_paths.json` 側が**未読の死んだ値**だった。正は `runtime_store` に一本化。`routes/llama.py`・`routes/history.py` の読み取りも runtime_store 経由に変更。
- 一回限りの移行: `runtime.json` 未作成時に旧 `config.json` から `ctx_size`/`n_gpu_layers` を引き継いでシード。既存値（32768 / -1）保全済み。
- 検証: 全バックエンド import、マージ GET / 分離 PATCH の往復、フロント `npm run build` すべて green。
- 残った掃除（軽微・後追い）: `start.bat` の llama_paths.json 初期化に残る死んだ `n_gpu_layers=-1`。未読なので実害なし。start.bat に別の未コミット変更があるため巻き込み回避で保留。

## 完了（ライブラリ切り替え / バックエンド本体 / 2026-07-07）

- マシンレベルのライブラリレジストリ `~/.lmchat/libraries.json`（アクティブ + 最近開いた一覧）を新設（`backend/library_store.py`）。どのライブラリにも属さないポインタとして機能。
- `paths.py`: レジストリからアクティブライブラリを起動時に遅延解決（`_resolve_active_library`）。未設定時は既定 `repo/data` へフォールバック。`machine_root()`/`library_registry_path()` 追加。
- **Store 再初期化（in-place）**: 多数のルートが `from .deps import store` で import 時束縛しているためオブジェクトは作り直さず、`SQLiteStore.reinit()` で db_path/assets を張り替えて再 init。`_connect()` が毎操作で接続を開くので即反映、`memory_engine` も同一 store 参照で有効なまま。
- import 時にパス定数をキャプチャしていた箇所を call-time 化（切り替え追従）: `deps.image_dir()/document_dir()`、`data.py` の `_data_dir()`、`documents.py`。
- 画像配信を StaticFiles 固定マウントから **動的ルート** `GET /assets/images/{path}`（毎回 `image_dir()` 解決 + パストラバーサル防御）へ変更。切り替え後も正しいライブラリの画像を配信。
- API: `GET /library`・`POST /library/switch`・`POST /library/create`（`routes/library.py`）。`deps.switch_library()` がレジストリ更新 → `paths.set_library_root()` → `store.reinit()` をオーケストレーション。
- 検証: 一時ライブラリへ create+switch で新規 DB がシード生成・隔離、元へ戻して13ワークスペース完全復元、レジストリ整合を確認。実データ無傷。
- 未了: **フロント UI**（サイドバー最上部のライブラリ切り替え行 + フォルダ選択ダイアログ + 切り替え時の全状態リロード）。Electron のフォルダピッカー連携が必要。

## 未了（次段）

- ライブラリ切り替えの **フロント UI**（上記）。
- 環境側ファイル（`settings.json`・`llama_paths.json`・`runtime.json`）の `~/.lmchat` 等への物理分離（現状は `data/` 同居）。
- `user_version` 移行フレームの導入。
- 設定 UI の「環境設定 / ライブラリ設定」ラベル分離、`ctx_size` コントロールの Runtime セクションへの移動。

## 確認済み

## 確認済み

- `npm run build` は成功。
- ワークスペース ZIP の試験エクスポートは成功。

## 注意点

- 会話ごとのシステムプロンプトは、専用フィールドとしてはまだ保存されていない。
- Debug の prompt log が有効な場合のみ、生成時に実際に渡した system prompt を後から確認できる。
- ストーリー制作向けには、全文投入ではなく章要約と作品全体要約を使う設計が必要。
