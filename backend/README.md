# Backend

## 起動

`main` conda 環境を使用。

```powershell
conda activate main
python -m uvicorn backend.server:app --reload
```

`start.bat` からの起動時は自動的に上記コマンドが実行されます。

## 主なエンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/health` | ヘルスチェック |
| GET/POST/PATCH/DELETE | `/workspaces` | ワークスペース CRUD |
| GET/POST/PATCH/DELETE | `/history/sessions` | セッション CRUD |
| POST | `/history/sessions/{id}/branch` | セッション分岐 |
| DELETE/PATCH | `/history/messages/{id}` | メッセージ削除・編集 |
| POST | `/chat/send/stream` | SSE ストリーミングチャット |
| GET/PATCH | `/config` | 設定（ctx_size, n_gpu_layers）|
| GET | `/llama/status` | llama-server 状態確認 |
| GET | `/llama/props` | llama-server モデルプロパティ |
| POST | `/llama/switch-model` | モデル切り替え |
| POST | `/llama/eject` | llama-server 停止（VRAM 解放）|
| GET | `/models/local` | ローカル GGUF モデル一覧 |
| GET/POST | `/memory/*` | 記憶検索・統計・削除 |

## DB スキーマ

SQLite（`data/lm_chat.db`）。新カラムは `_init_db()` 内の `ALTER TABLE` で既存 DB に自動マイグレーション。

### messages テーブル
```sql
id TEXT, session_id TEXT, role TEXT, content TEXT,
image_data TEXT,            -- 画像（base64 data URL）
created_at TEXT,
completion_tokens INTEGER,  -- 生成トークン数
tokens_per_second REAL,     -- 生成速度
elapsed_seconds REAL,       -- 生成時間（秒）
finish_reason TEXT          -- 停止理由
```

## 設定ファイル

`data/config.json`:
```json
{
  "ctx_size": 32768,
  "n_gpu_layers": -1
}
```

`data/llama_paths.json`:
```json
{
  "llama_exe": "...",
  "active_model_path": "...",
  "mmproj_path": "...",
  "n_gpu_layers": -1
}
```
