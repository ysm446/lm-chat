# メッセージ横断検索の仕組み

サイドバーの検索は、会話の**本文をワークスペース横断で探す**ための機能です。
キーワード（全文検索）と意味（ベクトル検索）の両方を使い、結果をセッション単位に
まとめて返します。

このドキュメントは実装（`backend/store_search.py` / `backend/routes/search.py` /
`src/renderer/components/Sidebar.tsx`）に基づく設計解説です。

---

## 0. 3 種類の「検索」の位置づけ

LM Chat には検索が3つあり、目的が異なります。混同しないこと。

| 検索 | 対象 | 目的 | 実装 |
|---|---|---|---|
| **記憶検索** | 記憶チャンク（Q&A ペア） | LLM への**文脈自動注入** | `store_memory.search_memory` |
| **チャット内検索（Ctrl+F）** | 開いているセッションの本文 | その場のハイライト | `ChatView.tsx` |
| **横断検索（本ドキュメント）** | 全セッションのメッセージ本文 | 人間が**原文へたどり着く**ナビ | `store_search.search_messages` |

記憶検索と横断検索はどちらも「キーワード＋意味」だが、**記憶は要約的な文脈注入、横断検索は原文ナビ**という違いがある。だから別インデックス・別ロジックにしている。

---

## 1. 2 層構造

サイドバー検索は2つの層で動く。

1. **タイトルフィルタ（即時）** — セッションのタイトルを部分一致で絞り込む。これは従来からの挙動で、`Sidebar.tsx` がローカルに処理する（API 不要・即時）。
2. **本文横断検索（debounce）** — 入力が2文字以上のとき、300ms のデバウンスで `GET /search/messages` を呼び、本文のヒットを結果ブロックに表示する。

この2層は独立して表示される。タイトルだけ一致するセッションはツリー側に、本文が一致するセッションは検索結果ブロックに出る。

---

## 2. インデックス: `message_fts`

キーワード検索のために、メッセージ本文の全文検索インデックス `message_fts` を持つ。

```sql
CREATE VIRTUAL TABLE message_fts USING fts5(
    id UNINDEXED,
    content,
    tokenize='trigram'
);
```

- `memory_fts` と同じ standalone FTS5（`id UNINDEXED` + `content`）。
- トークナイザは `trigram`（日本語のような分かち書きのない言語でも部分一致が効く）。

### 自動同期（トリガ）

メッセージの書き込み経路は多い（`append` / `update` / `replace` / `delete` / `branch` /
`duplicate`）。各メソッドを手で直すと漏れやすいので、**`messages` テーブルへのトリガに一元化**する。

```sql
CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
    INSERT INTO message_fts (id, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
    DELETE FROM message_fts WHERE id = old.id;
END;
CREATE TRIGGER messages_fts_au AFTER UPDATE OF content ON messages BEGIN
    UPDATE message_fts SET content = new.content WHERE id = old.id;
END;
```

- キーは **TEXT の `id`**（rowid ではない）。これにより `VACUUM` で rowid が変わってもインデックスが壊れない。
- `AFTER UPDATE OF content` にしているので、位置（`position`）の並べ替えなど本文以外の更新では発火しない。

### バックフィル

既存 DB（トリガ導入前のメッセージ）は、`_init_db` で `message_fts` を新規作成した直後に一括投入する。

```sql
INSERT INTO message_fts (id, content) SELECT id, content FROM messages;
```

ライブラリを開いた瞬間に走るため、**切り替え先の別ライブラリも自動でインデックスされる**。

---

## 3. キーワード検索

`message_fts` に対してクエリを `"..."` で囲んで `MATCH` する。

```sql
SELECT m.id AS message_id, m.content, s.id AS session_id,
       s.title AS session_title, s.workspace_id
FROM message_fts f
JOIN messages m ON m.id = f.id
JOIN sessions  s ON s.id = m.session_id
WHERE f.content MATCH ?          -- （任意で AND s.workspace_id = ?）
ORDER BY rank
LIMIT top_k * 4;
```

- `workspace_id` を渡せばそのワークスペースだけ、渡さなければ**現在のライブラリ全体**が対象。
- `ORDER BY rank` で FTS5 の関連度順に取る。
- 上位 `top_k * 4` 件を候補にする。

ヒットには順位ベースの加点をする。

```text
keyword_score = 1 / (rrf_k + rank + 1)     # rrf_k = 60, rank は 0 始まり
```

各セッションについて、**最上位のキーワードヒットのメッセージ ID をジャンプ先**として保持する。

---

## 4. 意味検索（記憶ベクトルの流用）

意味検索は、**専用のベクトルを新設していない**。記憶システムが毎ターンの Q&A を
`memory_vec` に埋め込んで保存している（記憶ボタンの ON/OFF に関係なく保存は常に走る）ので、
**それをそのまま流用**する。＝ 検索のために新しくベクトル化する必要がない。

```sql
SELECT mc.session_id, mc.content, s.title AS session_title, s.workspace_id,
       vec_distance_cosine(mv.embedding, ?) AS distance
FROM memory_chunks mc
JOIN memory_vec mv ON mv.chunk_id = mc.id
JOIN sessions    s ON s.id = mc.session_id
WHERE 1=1                         -- （任意で AND s.workspace_id = ?）
ORDER BY distance ASC
LIMIT top_k * 4;
```

- クエリは `embed_query()`（Ruri v3 の非対称プレフィックス「検索クエリ: 」）でベクトル化する。
- `vec_distance_cosine` で cosine 距離を計算し、近い順に取る。

ヒットには順位ベースの加点をする。

```text
semantic_score = 1 / (rrf_k + rank + 1)    # rrf_k = 60
```

### 距離ゲート（閾値）

近い順に無条件で取ると**緩く拾いすぎる**。Ruri v3 は cosine 距離が**狭い帯域に圧縮**されており、
無関係な内容でも 0.2 前後（cosine 類似度 ≈ 0.8）に居るためだ。

実データ計測（このプロジェクトのライブラリ）:

| クエリの性質 | 上位の cosine 距離 |
|---|---|
| 関連あり | 約 0.15〜0.18 |
| 無関係 | 約 0.20〜0.26 |
| ありふれた語 | 約 0.19〜0.21 |

関連と無関係の境目は **0.19 付近**。そこで閾値を設ける。

```text
_SEMANTIC_MAX_DISTANCE = 0.19
```

```python
for rank, row in enumerate(vec_rows):
    if row["distance"] > _SEMANTIC_MAX_DISTANCE:
        break            # ORDER BY distance ASC なので以降も全て遠い
    ...
```

- 閾値を超えた意味ヒットは採用しない。
- `ORDER BY distance ASC` なので、超えた時点で `break` してよい。
- **キーワードヒットはこのゲートの影響を受けない**（常に表示）。精度が高いため。

効果（計測）: 無関係クエリのヒットが約 10 件 → 0 件、関連クエリは維持。

> この値はモデル（Ruri v3）とデータに依存する既定値。厳しくしたい / 緩めたい場合は下げ / 上げる。
> 将来的に設定スライダーで可変化する余地がある。

---

## 5. RRF 統合とセッション集約

キーワードと意味のスコアを**セッション単位で合算**する。

```text
session_score = Σ keyword_score + Σ semantic_score
```

- キーワードだけ / 意味だけ / 両方、のどれもありうる。両方でヒットしたセッションは加点が大きくなる。
- これは厳密な標準 RRF というより「RRF に近い順位融合」。狙いは「文字列一致」と「意味が近い」の両方を上位に寄せること。

**なぜセッション単位に集約するか**: キーワードは正確なメッセージを指せるが、意味検索の粒度は
Q&A ペア（≒セッション）止まり。粒度を揃えるため、結果は「該当セッション一覧」にまとめ、
各セッションには代表スニペットとジャンプ先メッセージ ID（あれば）を添える。

最終的に `session_score` の高い順に並べ、上位 `top_k`（既定 30）件を返す。

---

## 6. スニペットとジャンプ先

各セッションのヒットには次を持たせる。

- **スニペット**: クエリ語の周辺を切り出した抜粋（`_SNIPPET_CHARS = 160`）。キーワードヒットがあればその本文から、無ければ意味ヒットのチャンク本文から作る。
- **`message_id`**: キーワードヒットがあれば、最上位ヒットのメッセージ ID（ジャンプ先）。意味のみのヒットは `null`。
- **`sources`**: `["keyword"]` / `["semantic"]` / 両方。UI のバッジ（語 / 意）に対応。

---

## 7. API

```
GET /search/messages?query=<文字列>&workspace_id=<任意>&top_k=30
```

レスポンス:

```jsonc
{
  "query": "...",
  "hits": [
    {
      "session_id": "...",
      "session_title": "...",
      "workspace_id": "...",
      "message_id": "..." ,     // ジャンプ先。意味のみのヒットは null
      "snippet": "…該当箇所…",
      "score": 0.0331,
      "sources": ["keyword", "semantic"]
    }
  ]
}
```

空クエリ（空白のみ）は埋め込みを呼ばず即 `hits: []` を返す。

---

## 8. フロントエンド

`src/renderer/components/Sidebar.tsx`。

- 検索入力が2文字以上になったら 300ms デバウンスで `searchMessages()` を呼ぶ。
- 結果は `.sidebar-content-search` ブロックに表示。各ヒットはセッション名＋スニペット＋ソースバッジ（語 = キーワード / 意 = 意味）。
- ヒットをクリックすると `jumpToHit` が **該当ワークスペースへ切り替え＋そのセッションを選択**する（`currentWorkspaceId` を設定し、対象ワークスペースを展開し、`selectSession`）。

---

## 9. 今後（保留）

- **フェーズ3: `message_vec` の新設**。現状の意味検索は記憶ベクトル流用のため粒度が Q&A ペア（セッション単位）。原文メッセージ単位で正確にジャンプしたくなったら、メッセージ（またはメッセージのチャンク）専用のベクトルインデックスを作る。二重の埋め込みコストを払う価値があると分かってから着手する。
- **距離ゲートの可変化**。`_SEMANTIC_MAX_DISTANCE` を設定パネルのスライダーに出し、ライブラリごとに調整可能にする案。

---

## 10. まとめ

- 対象は**全セッションのメッセージ本文**（記憶チャンクではなく原文）。
- **キーワード**（`message_fts`・トリガ自動同期・trigram）と**意味**（`memory_vec` 流用＝新規ベクトル化なし）を走らせる。
- 両者を**順位融合（RRF 風）してセッション単位に集約**。
- 意味側には**距離ゲート（0.19）**を掛けて緩い拾いを抑える。キーワードは常に表示。
- 結果はスニペット＋ジャンプ先付きで、クリックで該当セッションへ飛ぶ。
