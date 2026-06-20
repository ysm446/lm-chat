# Changelog

このファイルは Git のコミット履歴をもとに、主な更新を日付ごとに整理したものです。
日時はコミット時刻の `+0900` 表記に合わせています。

## 2026-06-20

- `b120745` システムプロンプト編集画面にプレビュー / 編集トグルを追加。
  - 既存プロンプトは Markdown プレビューで起動し、新規・空のものは編集で起動。
  - 校正トリガーボタンを上段右側に、校正案ポップアップを選択箇所付近に表示するよう改善。

## 2026-05-19

- `50e603d` Renderer の型 import を修正し、ビルド時の `Message` / `ApiSession` / `ApiWorkspace` / `LocalModel` 型エラーを解消。
- `0af1598` ワークスペース単位のエクスポート / インポートを追加。
  - ワークスペース、セッション、メッセージ、記憶、Documents、画像、検索インデックス関連データを ZIP 化。
  - 左サイドバーのワークスペースメニューからエクスポート可能に。
  - 左サイドバー上部の「ワークスペース」メニューから「新しく作成」「インポートする」を選べるように。
  - ワークスペース ZIP の保存名にワークスペース名を含めるように。

## 2026-05-12

- `edb2fee` 古いチャット画像を要約し、プロンプト投入時の画像扱いを改善。
- `47e24e4` アプリ終了時に llama server を停止するように改善。

## 2026-05-11

- `ea387ee` バックエンドの routes と store をドメイン別モジュールへ分割。
  - `backend/routes/*` と `backend/store_*` を追加。
  - ChatView 関連コンポーネントを分割。
  - Document index polling と chat store 型定義を分離。

## 2026-05-10

- `9a6429c` 挿入メッセージの順序が再起動後も維持されるよう修正。

## 2026-05-08

- `142cdde` llama runtime が未導入でも起動できるように改善。
- `8547769` チャットメッセージの position を正規化。

## 2026-05-07

- `532341c` 会話途中へのメッセージ挿入挙動を改善。
- `3e0e693` 会話途中へのメッセージ挿入機能を追加。
- `e155a44` 最後以外のメッセージ削除時に確認を出すように。
- `19cfb83` llama runtime インストーラーを Settings に追加。
- `c382853` モデル未ロード時の表示を修正。
- `7709743` 校正モードに「リライト」を追加。

## 2026-05-06

- `689ebc4` システムプロンプト編集へのショートカットを追加。

## 2026-05-04

- `c2c6633` 上移動ボタンのスクロール挙動を改善。

## 2026-05-03

- `14b20f5` チャットのスクロール位置設定を追加し、スクロール復元の安定性を改善。

## 2026-05-02

- `2072db5` Documents ヘッダーの操作ボタンを hover 時のみ表示するよう調整。

## 2026-04-27

- `854c554` 記憶の参照範囲設定とセッション複製を追加。
- `497f36d` Document 複製とワークスペース間移動を追加。

## 2026-04-24

- `7d77469` アプリの多重起動を防止。
- `6fcc42b` Settings を整理し、起動時ロード処理を改善。

## 2026-04-23

- `fab0ede` 記憶の減衰半減期を無効化できるように。

## 2026-04-22

- `2c3196c` Document Editor でも校正機能を使えるように。

## 2026-04-21

- `3b9c792` サイドバー展開状態と Settings セクション開閉状態を永続化。
- `c34c38d` Settings に記憶減衰コントロールを追加。
- `c885b7f` Settings に Documents のチャンク分割コントロールを追加。
- `2257729` バックエンド起動処理と Document indexing を整理。
- `4506ed5` Document RAG ドキュメントを更新。
- `e5e45d3` Document chunks を拡張し、再インデックス操作を追加。

## 2026-04-20

- `9007d80` サイドバー UI とコンテキスト設定を改善。

## 2026-04-19

- `451d26c` チャット添付画像で原本と preview を分離。
- `b976059` メモリ / Document コンテキスト上限を設定可能にし、Document 操作を追加。
- `7e94039` Document と memory のコンテキスト上限を拡大。
- `3badceb` メモリ検索から現在セッションを除外。
- `81d37c9` Document Editor のフォントと削除ボタン表示を調整。
- `937b8d8` 変更済みコンテキストスライダーを強調表示。

## 2026-04-18

- `bdb9851` prompt token stats を追加し、token ring tooltip を修正。
- `4fd6969` データ全体のインポート / エクスポート機能を追加。
- `6724b0a` トグル可能な system resource status bar を追加。
- `46700f0` prompt log cleanup action を追加。
- `0a2f458` メッセージ単位の prompt log viewer を追加。
- `b2ba6be` llama server eject 用 batch を追加。

## 2026-04-17

- `b029e5f` GGUF モデル metadata を Model Picker に表示。
- `9133ac5` チャット移動ボタンを追加。
- `13df9b9` / `42b790e` / `88b506a` / `09f712f` / `448f788` チャット移動ボタンの挙動と配置を調整。
- `0f68caa` `llama-server.exe` の自動検出を改善。

## 2026-04-16

- `ecb5cf5` サイドバーのワークスペース toggle flicker を修正。
- `d198673` モデル loading bar のフィードバックを改善。
- `d19c983` / `c40ee89` 名前変更中はサイドバーのドラッグを無効化。
- `2d85a4b` assistant メッセージに正確なモデル名を記録。
- `c93ed35` チャット編集時に画像の添付、削除、差し替えを可能に。

## 2026-04-15

- `ca5c178` システムプロンプト一覧を直接ドラッグできるように。
- `b6602ea` メッセージ編集 textarea に校正機能を追加。
- `266e8e0` 校正プロンプトを改善し、Prompt Editor でも校正可能に。
- `8485a00` context length と VRAM のドキュメントを追加。
- `4bbd1e7` floating scroll-to-bottom button と chat fade を追加。
- 複数の UI 調整: context slider 表示、composer 表示、スクロールボタン色、model bar icon など。

## 2026-04-14

- `b132c6b` サイドバーにチャット検索バーを追加。
- `dc1397f` assistant 返信の in-place regenerate を追加。
- `b9c3ee7` llama-server version 表示と b8781 への切り替え。
- `8932f89` Document cleanup action を追加。
- `0b33ef6` 続き生成にも memory / docs toggles を適用。
- `822b5ee` サイドバーで Documents を並べ替え可能に。
- `3f4f9c6` Delete キーでサイドバー項目を削除可能に。
- `e8494bb` Document RAG 仕様書を追加。
- `5991713` Documents サイドバー挙動とレイアウトを改善。

## 2026-04-13

- `7112776` ワークスペース単位の Document RAG 機能を追加。
  - Documents 保存、チャンク分割、検索、チャット文脈への注入に対応。
  - Document Editor とサイドバー Documents セクションを追加。
- `3fb43b8` セッションをドラッグで別ワークスペースへ移動できるように。
- `11115d4` / `26cafd5` / `2dba7d7` Document RAG 計画メモを追加・拡張。
- `9bb54b9` Debug panel に system resource monitor を追加。

## 2026-04-12

- `dec9463` README に日本語のアーキテクチャ概要を追加。
- `5e62913` server label を inference server に変更。

## 2026-04-11

- `659c730` Activity Bar と System Prompt Editor view を追加し、右パネルを簡素化。
- `7387130` UI font size slider と system prompt dropdown 同期を追加。
- `be224cd` System Prompt Editor と active prompt selection を分離。
- `fe99015` Prompt Sidebar に rename/delete menu を追加。
- `a351460` renderer stream と chat store を整理。
- `0792374` ワークスペース作成後の session reset を修正。

## 2026-04-10

- `461bd01` Debug panel に memory cleanup tool を追加。
- `417f777` prompt logging と document prompt flow を改善。

## 2026-04-09

- `178419a` チャット画像を assets directory に保存するよう変更。
- `2bf7ded` Debug prompt log view を追加。
- `54daacc` チャット画像の lightbox を追加。
- `68f4a0e` drag and drop による画像添付を追加。

## 2026-04-08

- `cce176c` Settings に debug prompt log toggle を追加し、関連ドキュメントを追加。
- `0af5a0c` UI font selection settings を追加。
- `fbc057e` 校正機能の独立した control を追加。
- `8b23beb` 新規チャットをリスト上部へ配置。
- `c1817d1` AGENTS.md を追加。

## 2026-04-06

- `6eedbb0` Settings panel に correction prompt selector を追加。

## 2026-04-04

- `6b10e7a` llama-b8648 server binary を使用するよう更新。
- `59162c6` llama paths の BOM handling を修正。

## 2026-04-03

- `82282c5` multi-instance startup と llama-server conflict を修正。
- `9b72733` チャットのドラッグ入れ替えを追加。
- `5032a70` README を現行構成に更新。
- `989f41e` 編集中チャットメッセージの auto-resize を追加。
- `e76ca62` inline autocomplete の安定性を改善。
- UI 調整: メッセージ表示、日付表示、色、レイアウトなど。

## 2026-03-30

- `454b0c3` 入力エリアに自動補完機能を追加。
- `89573bf` 範囲選択テキストの校正機能を追加。
- `a88c127` チャットエリアに Ctrl+F 検索を追加。
- `4d1429e` 右サイドバーに hover tooltip と reset button を追加。
- `f49bafd` temperature 設定を追加。
- `.gitignore` とドキュメントを整理。

## 2026-03-28

- `d37cbf0` 右サイドバーにシステムプロンプトパネルを追加。
- `0bee1cf` 前回選択した system prompt を保存。
- `ea13e79` system prompt の上書き保存を追加。
- `507bab3` シークレットモードを追加。
- `b177b02` 最後のメッセージが user の場合に AI response 生成ボタンを表示。
- 大規模クリーンナップで settings store、Electron main/preload、UI 構成を整理。

## 2026-03-27

- `44e3ff5` `llama_paths.json` を Git 管理対象から除外。

## 2026-03-26

- モデル未選択時の入力制御、停止時挙動、空モデル状態での起動を調整。
- `7c8d20a` モデル選択ウィンドウを追加。
- `2f38f2b` 検索を高速化。
- `392b615` データベース効率化。
- `fee19a1` / `e4bf47f` ドキュメントを更新。

## 2026-03-25

- `8615672` 自動タイトル生成を追加。
- `4198999` サイドバーのドラッグアンドドロップを追加。
- `458e932` ModelBar と ModelPickerModal を追加し、サイドバー構成を調整。
- `7bff3b7` 会話後の経過時間、トークン数、生成統計を表示。
- `2e0c0b8` 思考の視覚化を追加。
- `03e9739` アプリアイコンを追加。
- 複数の UI 調整: レイアウト、色、入力UI、スクロールバー、チャット編集表示など。

## 2026-03-24

- `2b351ef` 初回コミット。
  - Electron + React + FastAPI ベースのローカル LLM チャットアプリを作成。
  - ワークスペース、会話履歴、Settings、LLM proxy、memory 関連の基本構成を追加。
- `57d320b` / `b093ab8` 記憶機能と関連挙動を更新。
- `6494492` 設定保存、llama manager、起動 batch などを追加。
- `8d61dc7` 画像追加に対応。
- `c94c8ec` ワークスペースと会話をツリー UI へ変更。
- `681784a` 会話アイコンを追加。
- `58de021` コンテキストをサークル表示。
- `fbf5075` 以前の設定を記憶する仕組みを追加。
