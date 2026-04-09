# メッセージ送信から返答までのフロー

ユーザーがメッセージを入力して送信ボタンを押すと、返答が画面に表示されるまでに以下のステップが走ります。

---

## 全体の流れ（概要）

```
[ユーザー入力]
     ↓ Enter / 送信ボタン
[MessageInput.tsx] handleSend()
     ↓
[chatStore.ts] sendMessage()
     ↓ オプティミスティック表示（仮メッセージを即座に表示）
[api.ts] streamChatMessage()
     ↓ POST /chat/send/stream
[server.py] chat_send_stream()
     ↓ ユーザーメッセージをDBに保存
     ↓ 記憶コンテキストを取得（memory_enabled=true の場合）
[llm_proxy.py] stream_chat_completion()
     ↓ POST → llama-server:8080/v1/chat/completions (stream=true)
[llama-server]
     ↓ SSEトークンストリーム
[server.py] event_stream() ← トークンを1つずつ転送
     ↓ data: {"type": "token", "content": "..."}
[api.ts] onToken コールバック
     ↓ Zustand の streamingText に追記
[ChatView.tsx] ← リアルタイム再レンダリング
     ↓ 生成完了
[server.py] アシスタントメッセージをDBに保存 + 記憶を保存
     ↓ data: {"type": "done", "session": {...}}
[chatStore.ts] onDone → セッション全体を更新
     ↓ 必要であればタイトルを自動生成
[画面に最終表示]
```

---

## ステップ詳解

### 1. ユーザーが入力・送信

**ファイル:** [src/renderer/components/MessageInput.tsx](../src/renderer/components/MessageInput.tsx)

- `Enter`（Shift なし）または送信ボタンで `handleSend()` が呼ばれる
- モデルが未選択 (`activeModelPath` が空) のときはボタン・テキストエリアが無効化されており送信不可
- 一時チャットモード (`tempChatMode`) の場合は `sendTempMessage()` に分岐する（DBに保存しない）
- 通常モードでは `sendMessage(sessionId, text, imageData)` を呼ぶ

### 2. オプティミスティック更新

**ファイル:** [src/renderer/stores/chatStore.ts](../src/renderer/stores/chatStore.ts) — `sendMessage()`

- ユーザーメッセージと空のアシスタントメッセージを**即座に** Zustand ストアに追加する
- これにより、APIの応答を待たずに画面にメッセージが表示される（UXの高速化）
- 両メッセージには一時的な `tmp-xxx` ID が付く

### 3. SSEリクエストを送信

**ファイル:** [src/renderer/api.ts](../src/renderer/api.ts) — `streamChatMessage()`

```
POST http://127.0.0.1:8000/chat/send/stream
{
  session_id, content, image_data,
  memory_enabled, thinking_enabled, system_prompt
}
```

- `fetch()` でリクエストを送信し、レスポンスボディを ReadableStream として読む
- `AbortController` に接続しており、ユーザーが停止ボタンを押すとストリームを中断できる

### 4. バックエンドがリクエストを受け取る

**ファイル:** [backend/server.py](../backend/server.py) — `chat_send_stream()`

1. **ユーザーメッセージをDBに保存**
   - `store.append_message()` で SQLite に書き込む

2. **セッションを取得**
   - DB からセッション全体（過去のメッセージ履歴を含む）を取得する

3. **記憶コンテキストを取得**（`memory_enabled=true` の場合）
   - `memory_engine.build_prompt_context()` がワークスペース単位の記憶を検索
   - ベクトル検索（`ruri-v3-310m` 埋め込み）とFTS5キーワード検索を組み合わせる
   - 関連する過去のQ&Aチャンクをシステムプロンプトに付加する

4. **温度設定を取得**
   - `config.json` から `temperature` を読む（デフォルト 0.8）

### 5. llama-server にストリーミングリクエストを送信

**ファイル:** [backend/llm_proxy.py](../backend/llm_proxy.py) — `stream_chat_completion()` → `_iter_stream()`

- `_build_messages()` でメッセージリストを構築する
  - システムプロンプト（+ 記憶コンテキスト）を先頭に追加
  - 画像がある場合は `image_url` 形式のコンテンツにする
- llama-server の `/v1/chat/completions` に `stream: true` でリクエストを送信
- `thinking_enabled` に応じて `chat_template_kwargs.enable_thinking` と `thinking.type` を制御

#### プロンプトはどうまとめられ、どの順序で送られるか

`_build_messages()` は llama-server に送る `messages` を次の順序で組み立てる。

1. `system`
   - ベースのシステムプロンプト
   - `memory_enabled=true` の場合は、その末尾に記憶コンテキストを連結
2. セッション内の過去メッセージを古い順にすべて
   - `user`
   - `assistant`
   - `user`
   - `assistant`
   - ...という保存順
3. 最後に今回送った最新の `user` メッセージ

画像付きユーザーメッセージは 1 メッセージの中でさらに次の順にまとめられる。

1. 添えたテキストがあれば `{"type": "text", "text": "..."}`
2. 画像本体を指す `{"type": "image_url", ...}`

つまり、画像付きメッセージは「画像だけ」ではなく「テキスト → 画像」の順で同じ `content` 配列に入って送られる。
また、会話の続きを生成するときも履歴全体から再度 `messages` を組み立てるため、過去の画像付きメッセージも再び入力に含まれる。

```python
# 送信ペイロードの例
{
  "model": "モデル名",
  "messages": [
    {"role": "system", "content": "システムプロンプト + 記憶"},
    {"role": "user", "content": "過去のメッセージ..."},
    {"role": "assistant", "content": "..."},
    {"role": "user", "content": "今回のメッセージ"}
  ],
  "stream": true,
  "temperature": 0.8,
  "chat_template_kwargs": {"enable_thinking": false},
  "thinking": {"type": "disabled"}
}
```

### 6. トークンをリアルタイムでフロントエンドに転送

**ファイル:** [backend/server.py](../backend/server.py) — `event_stream()`

- llama-server から SSE チャンクが届くたびに、フロントエンドへ転送する
- `reasoning_content`（思考内容）は `<think>...</think>` タグで囲んで送信する

```
data: {"type": "token", "content": "こんにちは"}
data: {"type": "token", "content": "、"}
data: {"type": "token", "content": "今日は..."}
```

### 7. フロントエンドがトークンを受け取って表示

**ファイル:** [src/renderer/api.ts](../src/renderer/api.ts) + [src/renderer/stores/chatStore.ts](../src/renderer/stores/chatStore.ts)

- SSEバッファを `\n\n` で分割してイベントを1つずつパース
- `onToken` コールバックが呼ばれるたびに Zustand の `streamingText` に追記
- Zustand のストア更新により `ChatView.tsx` が再レンダリングされ、テキストが増えていく

### 8. 生成完了：DB保存と最終更新

**ファイル:** [backend/server.py](../backend/server.py) — `event_stream()` の後半

生成が完了したら:

1. トークンをすべて結合してアシスタントメッセージを構成
2. **アシスタントメッセージをDBに保存**（生成統計付き）
   - `completion_tokens`, `tokens_per_second`, `elapsed_seconds`, `finish_reason`
3. **記憶を保存**
   - 今回の Q&A ペアを `memory_engine.save_session_messages()` でベクトル化して保存
4. セッション全体を返す

#### embedding は何をベクトル化しているか

- 基本単位は、連続する `user` + `assistant` の 1 往復
- 保存前に `Q: ユーザー文\nA: アシスタント文` という 1 本の文字列へまとめる
- その「Q&A ひとまとまりの文章」に対して embedding を計算する
- 長すぎる場合だけ 4000 文字単位で分割して複数チャンクにする
- `user` と `assistant` が対になっていない単独メッセージは、その単独文をそのままベクトル化する

```
data: {"type": "done", "session": { ...セッション全体... }}
```

### 9. フロントエンドが完了イベントを受け取る

**ファイル:** [src/renderer/stores/chatStore.ts](../src/renderer/stores/chatStore.ts) — `onDone()`

- オプティミスティックな仮メッセージ（`tmp-xxx`）をDBから取得した本物のメッセージ（正式ID付き）に差し替える
- `isSubmitting` を `false` に戻す
- 初回メッセージ（user + assistant の2件のみ）のとき、セッションタイトルを自動生成する

---

## 中断した場合（停止ボタン）

ユーザーが生成中に停止ボタンを押すと:

1. `AbortController.abort()` が呼ばれ、フェッチが中断される
2. `AbortError` をキャッチして生成済みの部分テキストを取得
3. `POST /history/sessions/{id}/messages` で部分テキストを `finish_reason: "user_stopped"` として DB に保存
4. `getSession()` でセッションを再取得して仮IDを正式IDに差し替える

---

## 一時チャットモードの場合

`tempChatMode` が ON のとき:

- `sendTempMessage()` → `POST /chat/temp/stream` に送る
- **DBへの書き込みは一切行わない**
- 記憶の参照・保存も行わない
- メッセージは Zustand の `tempMessages` のみに保持される
- モードを終了すると `tempMessages` はリセットされる

---

## SSEイベントの形式まとめ

| type | 内容 |
|------|------|
| `token` | `{ type: "token", content: "トークン文字列" }` |
| `done` | `{ type: "done", session: { ...セッション全体... } }` |
| `error` | `{ type: "error", detail: "エラーメッセージ" }` |
