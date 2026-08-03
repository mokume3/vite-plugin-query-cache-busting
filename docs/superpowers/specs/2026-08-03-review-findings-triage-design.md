# コードレビュー指摘の整理と修正方針 設計

作成日: 2026-08-03

## 1. 背景と目的

`/code-review medium` を `main` に対して実行した。`origin/main` と同期済みでツリーもクリーンだったため、レビュー範囲は `HEAD~2..HEAD`（i18n コミット `46567ef` と `0.3.0` バージョンバンプ `95efc0e`）とした。

重要な前提として、**8件の指摘はすべて既存コードの問題であり、レビュー対象のコミットが作り込んだものではない**。`46567ef` は `src/` の実行行を変更しておらず、唯一の挙動変更は `diagnostics.ts` の `join('、')` → `join(', ')` である。指摘は「翻訳作業が通り過ぎた箇所」として検出された。

したがって全件を即座に修正する義務はなく、採否を選択できる。本ドキュメントはその採否と、修正する項目の設計を確定させる。

## 2. 採否の判断

| # | 指摘 | 判断 | 根拠 |
| --- | --- | --- | --- |
| 1 | `&` 連結の query を未付与と誤検知 | 修正する | `verify: 'error'` でビルドが落ちる。正しい出力を不正と判定する唯一の指摘 |
| 6 | `appendQuery` 系の重複 | 修正する（1と同時） | 1の修正箇所そのもの。分けると片側だけ直る |
| 4 | 存在しない "v1" に言及 | 修正する | 文字列1行。ユーザーが自分に当てはまるか判断できない |
| 5 | ssr-manifest に合わない fix 文 | 修正する | 文字列1行 |
| 7 | `throwIssue` 二重定義とバイパス | 修正する | 振る舞い不変 |
| 8 | テスト名が実装と矛盾 | 修正する | 1行。放置すると誤った方向へ誘導する |
| 2 | sourcemap が更新されない / 捨てられる | 実測してから判断 | 第6節 |
| 3 | verify が O(総バイト×参照数) | 見送る | 第7節 |

## 3. 作業単位と順序

分割の基準は「リスクの質」で、レビュー時に確認すべき観点が単位ごとに1種類になるよう切る。

| 単位 | 内容 | 挙動変化 | 推奨バンプ |
| --- | --- | --- | --- |
| WU1 | 指摘 1 + 6 | あり | patch |
| WU2 | 指摘 4 + 5 + 8 | なし（文字列のみ） | patch |
| WU3 | 指摘 7 | なし | patch |
| WU4 | 指摘 2 | 第6節で決定 | 第6節で決定 |

順序は **WU1 → WU2 → WU3 → WU4**。

WU1 を先頭にするのは、これが唯一ユーザーが現に踏んでいる問題だからである。WU3 を WU1 より先にすると `generate-bundle.ts` のリファクタ済みコードの上に WU1 が乗り、WU1 の差分に無関係な移動が混ざる。

バージョンの最終選択は `RELEASING.md` の通り `bun run release` の `bumpp` が対話で聞くため、手元で決める。

## 4. WU1 の設計（指摘 1 + 6）

### 4.1 問題

`src/url.ts` の `appendQuery` / `appendQueryToBuiltUrl` は、URL に既存の query があるとセパレータに `&` を選ぶ。一方 `src/verify.ts:49` と `src/generate-bundle.ts:164` はリテラル `?${query}` を探す。書き込み側と読み取り側が別ファイルにあり、片方だけが仕様を知っている状態だった。

再現条件は `experimental.renderBuiltUrl` が query を含む URL を返す場合。

```
renderBuiltUrl: (f) => `https://cdn.example.com/${f}?token=xyz`
→ 出力: https://cdn.example.com/assets/a-abc123.js?token=xyz&v=1.0.0
→ verify が QCB_MISSING_QUERY として報告し、summary の件数からも漏れる
```

副次的に、現行の `startsWith('?' + query)` は `?v=10` を `?v=1` の一致と誤認する。

### 4.2 `src/url.ts` の構成

query の書き込みと読み取りを1ファイルに集約する。

| 関数 | 公開 | 役割 |
| --- | --- | --- |
| `insertQuery(url, query)` | 非公開 | ハッシュ手前に挿入し、既存 query があれば `&` を選ぶ |
| `appendQuery(url, query)` | 公開 | 外部 URL を除外して `insertQuery` に委譲 |
| `appendQueryToBuiltUrl(url, query)` | 公開 | `data:` / `blob:` を除外して `insertQuery` に委譲 |
| `hasQueryParam(text, index, query)` | 公開（新規） | `index` 以降の query 文字列に `query` が完全な成分として含まれるか |
| `countQueryParams(text, query)` | 公開（新規） | `text` 全体で `query` が完全な成分として現れる回数 |

`appendQuery` と `appendQueryToBuiltUrl` は「除外規則 + 委譲」の2行になり、指摘6の重複が消える。

### 4.3 判定規則

`hasQueryParam` の核は成分の完全一致である。

```ts
text.slice(index + 1, end).split('&').includes(query)
```

`end` は終端文字（4.4節）まで走査して決める。

| 入力 | 成分 | query が `v=1` のとき |
| --- | --- | --- |
| `?v=1` | `['v=1']` | 一致 |
| `?token=xyz&v=1` | `['token=xyz', 'v=1']` | 一致 |
| `?v=10` | `['v=10']` | 不一致（正しい） |

`?` は `verify.ts` の `PATH_CHAR_RE` に含まれないため、`isReferenceBoundary` が通った時点で `index + name.length` はちょうど query の開始位置になる。**境界判定ロジックには一切触れない**（指摘3を見送る以上、ここは動かさない）。

### 4.4 query 文字列の終端と `buildQuery` の追加エンコード

`hasQueryParam` は query 文字列の終端を決める必要がある。URL は JS の文字列リテラル・CSS の `url()`・HTML 属性の中にあるため、終端は `"` `'` `` ` `` 空白 `#` `<` `>` `)` のいずれかとする。

ここに衝突がある。`buildQuery` が使う `encodeURIComponent` は `! ~ * ' ( )` をエスケープしない。`version: "1.0(beta)"` を指定すると `?v=1.0(beta)` が生成され、CSS の `url(/a.js?v=1.0(beta))` の中で `)` が終端と解釈され、正しく付与された query を未付与と誤検知する。**今回直そうとしているバグと同じ種類のバグが別の入口から入る。**

対策として、読み取り側の終端規則に加えて **`buildQuery` 側で `! ~ * ' ( )` も追加エンコードする**。生成される query に区切りと衝突する文字が入らなくなり、曖昧さが根元で消える。

```
version: "1.0(beta)" → v=1.0%28beta%29
```

曖昧さを読み取り側で吸収するより、生成側で作らない方が浅い層で閉じる。既存テスト `buildQuery('v', 'a b') → 'v=a%20b'` は影響を受けない。

### 4.5 HTML エンティティによる区切り文字の変形（実装中に判明）

Task 3 の実装中に、同じ「書き込み側と読み取り側の形式不一致」がもう1経路あることが判明した。**Vite は HTML 属性内で `&` を `&amp;` にエスケープする。**

```
renderBuiltUrl が https://cdn.example.com/${f}?token=xyz を返すと
index.html の出力は src="https://cdn.example.com/assets/index.js?token=xyz&amp;v=testver"
```

`verify` は `.html` を走査対象に含むため、成分を素の `'&'` で分割すると `['token=xyz', 'amp;v=testver']` となり、正しく付与された query を未付与と誤検知する。実ビルドで確認済み。

対策として、区切りの判定に `&` と `&amp;` の両方を受け入れる。

```ts
const QUERY_SEPARATOR_RE = /&(?:amp;)?/
```

`QUERY_END_RE` に `;` は含まれないため、query 文字列の切り出し範囲は `&amp;` を跨いでも変わらない。生成側（4.4節）では潰せない — HTML エスケープは Vite が出力時に行うものであり、query の生成時点では存在しないためである。

### 4.6 呼び出し側の変更

| 場所 | 変更前 | 変更後 |
| --- | --- | --- |
| `src/verify.ts:49` | `!content.startsWith(\`?${query}\`, ...)` | `!hasQueryParam(content, index + name.length, query)` |
| `src/generate-bundle.ts:162` | `countByExtension` 内の手書きループ | `countQueryParams(file.content, query)` |

## 5. WU2 / WU3 の設計

### 5.1 WU2 — 文言とテスト名

**指摘4** `QCB_MULTIPLE_OUTPUTS` の fix から版数への言及を落とす。制限はバージョンに紐づいていない。

```
現: v1 only supports a single output. Make output a single object.
新: Only a single output is supported. Make output a single object.
```

**指摘5** `QCB_MANIFEST_MISSING` の fix を消費者中立の文言にする。

```
現: ...the query would otherwise be missing when integrating with a backend.
新: ...consumers of the manifest would otherwise load URLs without the query.
```

診断コードを通常 / ssr の2つに割る案は**採らない**。原因も対処も両者で同一で、違うのは消費者の名前だけである。文言の差のために診断機構を複製するのは、指摘7で解消する重複を別の場所に作ることになる。`why` は既にファイル名を展開しており、どちらが落ちたかはユーザーに伝わっている。

**指摘8** `tests/diagnostics.test.ts` のテスト名を `paths 配列を渡すコードは ", " で連結する` に変更する。

### 5.2 WU3 — `throwIssue` / `warnIssue` の集約

`src/logger.ts` に `throwIssue` を移して export し、`generate-bundle.ts:14` と `plugin-steps.ts:22` の非公開コピーを削除する。バイパスしている3箇所（`generate-bundle.ts:86`・`:103`・`plugin-steps.ts:131`）を呼び出しに置き換える。

警告側も同じ重複がある（`generate-bundle.ts:68`・`:158`・`plugin-steps.ts:110`）ため、`warnIssue(palette, logger, issue)` も併せて置く。含めないと「エラーは集約済み、警告は手書き」という非対称が残る。

`plugin-steps.ts:114` は**触らない**。複数の issue を `'\n\n'` で連結する別物であり、集約対象ではない。

## 6. WU4 の設計（指摘2）

### 6.1 `renderChunk` への移動は選べない

当初は「`generateBundle` から `renderChunk` へ移し、`{ code, map }` を返して Rollup に map を連結させる」を根本修正として検討したが、**この案は破棄した**。

`src/index.ts:131-133` のコメントが守っている制約を Vite 本体で確認した。`vite:build-import-analysis` は **`generateBundle` で** チャンクの `import()` 指定子を読み、`bundle[...]` を引いて `__vitePreload` の依存配列を組み立てる。

```js
// vite:build-import-analysis の generateBundle
normalizedFile = path.posix.join(path.posix.dirname(chunk.fileName), url)
const chunk = bundle[filename]   // 指定子から導いたキーで bundle を引く
```

`renderChunk` は全プラグインで `generateBundle` より前に走る。そこで指定子に `?v=...` を足すと `normalizedFile` が `assets/dep-abc.js?v=1` となり bundle のキーに一致せず、依存解決が空振りする。結果はモジュールプリロードの破壊であり、sourcemap のズレより重い実害になる。

現在の `order: 'post'` はまさにこれを避けるための配置である。

### 6.2 残る選択肢と方針

`generateBundle` に留まる前提で取れるのは以下。

- **A. 無駄な `generateMap` を削除するだけ** — `map` と `count` を返り値から落とす。陳腐化は残る
- **B. `generateBundle` 内で sourcemap を連結する** — `output.map` を MagicString の map と合成して更新する。配置を変えずに陳腐化を直せるが、連結に `@ampproject/remapping` 相当の直接依存が1つ増える

**方針: まず `build.sourcemap: true` の統合テストを追加し、実際のズレ幅を観測してから A / B を選ぶ。**

`tests/integration/` に `sourcemap` を有効にしたビルドが1つも無いため、現状では壊れていても検出できない。統合テストは A でも B でも必要になるもので、単独で価値がある。テストを入れた時点で陳腐化が再現するはずであり、**再現しなければ指摘2の分析自体が誤っていたことになる。これが最初のチェックポイントである。**

### 6.3 測定結果と判断

`build.sourcemap: true` + `minify: true` で `tests/fixtures/basic` をビルドし、プラグイン有無で map を比較した。

| チャンク | 行数 | codeLen（無→有） | 挿入文字数 | mappings 一致 |
| --- | --- | --- | --- | --- |
| `assets/index.js` | 3 | 2230 → 2303 | 40 | 不一致 |
| `assets/lazy.js` | 2 | 105 → 115 | 10 | **一致** |

`assets/lazy.js` が決定的である。挿入によりコードが10文字伸びているにもかかわらず、**mappings 文字列がプラグイン無しのビルドと完全に一致している**。すなわち map は書き換え前のコードを指したままで、更新されていない。`assets/index.js` の mappings が不一致なのは `renderBuiltUrl` がレンダリング段階でアセット URL を変えているためであり、`generateBundle` 段階の挿入が map に反映されていない点は同じである。

`rewriteImports` が返す `map` を本番経路で読む箇所が無いことも grep で確認した（`src/generate-bundle.ts` は `result.code` のみ使用。`.map` と `.count` を読むのはテストのみ）。

**判断: B（`generateBundle` 内で sourcemap を連結する）を採る。** ズレは推測ではなく実測で確認された。ただし B の実装は本計画のスコープ外であり、`@ampproject/remapping` 相当の直接依存が1つ増えるため、別途計画を立てて実施する。

## 7. 見送り: 指摘3（verify の性能）

これはバグではなくコストであるため、他と判断基準が異なる。

実測値（合成入力・クリーンビルド）:

| 規模 | 時間 |
| --- | --- |
| 100ファイル / 2MB / 100参照 | 35ms |
| 500ファイル / 20MB / 500参照 | 1.7s |
| 1500ファイル / 45MB / 1500参照 | 12.3s |

1パス正規表現 + `Set` 引きに置き換えると同条件で約35倍速いという試算がある。

**見送る理由**は、置き換える対象が繊細でよくテストされたロジックだからである。`isReferenceBoundary` は4段の判定を持ち、「空白は区切りではない」「ファイル先頭は区切りとみなさない」といった非自明な規則がそれぞれ実際のバグ由来のテストで守られている。小規模プロジェクトでは35msで誤差の範囲であり、現時点で実プロジェクトの遅さは観測されていない。

**再検討のトリガー**: 実プロジェクトのビルドで verify に体感できる時間（目安1秒以上）がかかると観測された時点で着手する。その際は、旧実装をテスト内のオラクルとして一時的に残し、生成入力で新旧の一致を検証する差分テストを安全網として先に用意する。既存14テストは「過去に踏んだ地雷」の集合であって、境界規則の全域を覆ってはいない。

## 8. テスト戦略

| 単位 | テスト |
| --- | --- |
| WU1 | `tests/url.test.ts` に `hasQueryParam` / `countQueryParams` / 追加エンコードのテストを追加。`tests/verify.test.ts` に `&` 連結の回帰テストを追加。いずれも TDD で先に失敗を確認する |
| WU2 | `tests/diagnostics.test.ts` のテスト名修正のみ。変更する2つの `fix` 文字列はテスト・README のいずれからも参照されていないことを確認済みのため、新規テストは不要かつ既存テストも壊れない |
| WU3 | 振る舞い不変のため新規テストなし。既存158テストが回帰網 |
| WU4 | `tests/integration/` に `build.sourcemap: true` のケースを追加。これが A / B の判断材料になる |

全単位で `bun run check && bun run test -- --run` を通す。

## 9. スコープ外

- **`package.json` の keywords から `query` が落ちた件** — `vitejs` は `vite` と別トークンで冗長ではなく、`query` はパッケージ名と description に残るため発見性は失われない。判断の問題であり欠陥ではない
- **`docs/superpowers/specs/2026-07-31-nostics-style-logging-design.md` の日本語メッセージが古い件** — 日付入りの設計記録であり、v0.1.0 の時点で既に陳腐化していた。書き換えると当時の設計判断の記録を改竄することになる
- **`options.ts` の検証エラーが診断カタログを経由していない件** — レビューでは altitude 指摘として挙がったが、最終8件には残らなかった。将来 `QCB_INVALID_*` として取り込む余地はある
