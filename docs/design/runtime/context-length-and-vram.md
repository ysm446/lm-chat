# コンテキスト長と VRAM の関係

このドキュメントは、LM Chat における `ctx_size` の意味と、  
コンテキスト長を増やしたときに VRAM がどう増えるかを整理したものです。

---

## 結論

このアプリでは、`ctx_size` は「モデル切替時に llama-server を起動するときの設定値」です。  
会話ごとに変わる一時的な上限ではなく、モデルロード時のサーバ設定として使われます。

そのため、`ctx_size=32768` を選んでモデルをロードすると、  
少なくともその長さを扱えるような KV cache などの実行用メモリが確保されます。

大まかな理解としては次の通りです。

- モデル重みのメモリは、コンテキスト長にほぼ依存しない
- KV cache は、コンテキスト長にほぼ比例して増える
- 実行時バッファや CUDA まわりの一時領域も少し必要

つまり、

```text
総VRAM ≈ モデル重み + KV cache + 実行バッファ
```

という形で考えると分かりやすいです。

---

## このアプリでの `ctx_size` の使われ方

設定値 `ctx_size` は `config.json` に保存されます。

- デフォルト値は `32768`
- `PATCH /config` で保存される
- モデル切替時に `switch_model(..., ctx_size=...)` に渡される

関連箇所:

- [backend/config_store.py](../backend/config_store.py)
- [backend/server.py](../backend/server.py)
- [backend/llama_manager.py](../backend/llama_manager.py)

処理の流れは次の通りです。

1. フロントエンドで `ctx_size` を保存する
2. バックエンドが `config["ctx_size"]` を読む
3. モデル切替時に `llama-server --ctx-size <値>` を付けて起動する

実装上、`switch_model()` は以下のように `--ctx-size` を渡しています。

```python
cmd = [
    exe,
    "--model", model_path,
    "--host", "127.0.0.1",
    "--port", llama_port,
    "--ctx-size", str(ctx_size),
    "--n-gpu-layers", str(n_gpu_layers),
    "--flash-attn", "on",
    "--parallel", "1",
]
```

`--parallel 1` なので、このアプリでは同時実行スロット数による KV cache の多重確保は起きにくい構成です。

---

## なぜコンテキスト長で VRAM が増えるのか

主な理由は KV cache です。

Transformer は、過去トークンの Key / Value を層ごとに保持しながら次のトークンを生成します。  
この保存領域が KV cache で、保持できるトークン数が増えるほど必要メモリも増えます。

概算は次の形で表せます。

```text
KV cache bytes
≈ n_layers × n_ctx × 2 × n_kv_heads × head_dim × bytes_per_elem
```

ここで:

- `n_layers`: 層数
- `n_ctx`: コンテキスト長
- `2`: K と V の 2 つ
- `n_kv_heads`: KV ヘッド数
- `head_dim`: 1 ヘッドあたりの次元数
- `bytes_per_elem`: 要素サイズ

この式から分かる通り、単純な full attention モデルでは `n_ctx` を 2 倍にすると KV cache もほぼ 2 倍になります。

例えば:

- `8k -> 16k` で約 2 倍
- `8k -> 32k` で約 4 倍

になります。

---

## 「32k を選ぶと毎回 32k 分の計算をする」のか

それは少し違います。

- メモリは「32k まで扱えるように」先に確保されやすい
- ただし実際の計算量は、実際に入力したトークン数に応じて増える

つまり、`ctx_size=32768` にするとロード直後の VRAM 使用量は増えますが、  
毎回必ず 32k 全部を使って推論するわけではありません。

---

## Gemma 4 31B の例

ここでは `gemma-4-31B-it-Q6_K.gguf` を例にします。

まず、モデル本体の重みサイズは配布元で少し差がありますが、だいたい次の範囲です。

- `Q6_K` 本体: 約 `25 GB` から `27 GB`
- `mmproj` を使う構成では追加で約 `1.2 GB`

LM Chat は、モデルファイルと同じディレクトリに `mmproj` を見つけると自動で読み込みます。  
画像なしの会話だけなら `mmproj` は実質不要ですが、同居していると起動コマンドに追加されます。

### Gemma 4 31B の KV cache が単純比例でない理由

Gemma 4 31B はハイブリッド注意を使います。

- 全 60 層
- 50 層は sliding window attention
- 10 層だけが global / full attention

このため、全層がそのまま `n_ctx` に比例して膨らむモデルより、  
長コンテキスト時の KV cache 増加はやや緩やかです。

モデル設定の代表値は次の通りです。

- `num_hidden_layers = 60`
- `num_key_value_heads = 16`
- `head_dim = 256`
- `num_global_key_value_heads = 4`
- `global_head_dim = 512`
- `sliding_window = 1024`

### Gemma 4 31B の KV cache 概算

KV 要素が F16/BF16 相当の `2 byte` として概算すると、

```text
sliding層KV
≈ 50 × 1024 × 2 × 16 × 256 × 2 bytes
≈ 0.78 GiB

global層KV
≈ 10 × n_ctx × 2 × 4 × 512 × 2 bytes
≈ 81,920 bytes × n_ctx
```

これを各コンテキスト長に当てはめると、おおよそ次の通りです。

| ctx_size | KV cache 概算 |
| --- | --- |
| 8k | 約 1.4 GiB |
| 16k | 約 2.0 GiB |
| 32k | 約 3.3 GiB |
| 128k | 約 10.8 GiB |
| 256k | 約 20.8 GiB |

### `32k` の総VRAM目安

`gemma-4-31B-it-Q6_K.gguf` を `ctx_size=32768` で全載せする場合、ざっくり次の見積もりになります。

- モデル重み: `25〜27 GB`
- `mmproj`: `0〜1.2 GB`
- KV cache: 約 `3.3 GB`
- 実行バッファ・CUDA余白: 約 `1〜3 GB`

合計の目安:

- 画像なし寄り: 約 `29〜32 GB`
- `mmproj` 込みで余白多め: 約 `31〜34 GB`

これはあくまで概算です。  
実際には次の要因で前後します。

- llama.cpp / llama-server のビルド差
- GPU オフロード率
- KV cache の実装詳細
- Flash Attention の有無
- 量子化の種類
- 画像入力を使うかどうか

---

## 実運用での見方

`ctx_size` を上げるときは、次の 2 つを分けて考えると判断しやすいです。

### 1. その長さが本当に必要か

多くの会話では、常に 32k や 128k が必要とは限りません。  
長い履歴や大量の資料参照を頻繁に行わないなら、短めの `ctx_size` の方が VRAM 効率は良くなります。

### 2. GPU にどれだけ余白を残したいか

モデル本体が大きい 31B クラスでは、`ctx_size` を増やす余地が小さくなります。  
特に 24GB 級では 31B の Q6 はかなり厳しく、32GB でも余裕は大きくありません。

---

## このアプリで確認しやすいポイント

LM Chat には GPU 使用量を返す API があります。

- `GET /system/resources`

返却には GPU ごとの以下の情報が含まれます。

- `vram_used_gb`
- `vram_total_gb`
- `vram_percent`

そのため、`ctx_size` を変えてモデルを再ロードした直後の差分を見ると、  
実機でどれだけ増えたかを把握しやすいです。

---

## まとめ

LM Chat における `ctx_size` は、モデル切替時に `llama-server --ctx-size` として反映されます。  
この値を増やすと、主に KV cache のために VRAM 使用量が増えます。

`gemma-4-31B-it-Q6_K.gguf` の例では、`ctx_size=32768` にすると  
KV cache だけでおおよそ `3.3 GiB`、総VRAMはだいたい `29〜34 GB` 前後が目安です。

31B クラスではモデル本体がかなり大きいため、  
コンテキスト長は「長ければよい」ではなく、必要量と GPU 容量のバランスで決めるのが実用的です。

---

## 参考

- Google Gemma 4 31B IT model card: <https://huggingface.co/google/gemma-4-31B-it>
- Google Gemma 4 31B `config.json`: <https://huggingface.co/google/gemma-4-31B-it/blob/main/config.json>
- Unsloth `gemma-4-31B-it-Q6_K.gguf`: <https://huggingface.co/unsloth/gemma-4-31B-it-GGUF/blob/main/gemma-4-31B-it-Q6_K.gguf>
- Bartowski GGUF 配布ページ: <https://huggingface.co/bartowski/google_gemma-4-31B-it-GGUF>
- ggml-org `mmproj-gemma-4-31B-it-f16.gguf`: <https://huggingface.co/ggml-org/gemma-4-31B-it-GGUF/blob/main/mmproj-gemma-4-31B-it-f16.gguf>
