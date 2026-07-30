# vite-plugin-query-cache-busting 設計

作成日: 2026-07-30

## 1. 背景と目的

Vite は本番ビルドで出力ファイル名にコンテンツハッシュを埋め込むことでキャッシュバスティングを行う（`assets/index-a1b2c3d4.js`）。本プラグインは、これをファイル名ではなく **クエリパラメータ**（`assets/index.js?v=202607302209`）による方式に置き換える。

採用の動機は次の2点。

- **配信環境の制約**: サーバ・CDN・既存テンプレートが固定ファイル名を参照する必要がある
- **デプロイ運用の都合**: 同一パスへの上書きデプロイが前提であり、ハッシュ付き旧ファイルの掃除やストレージ増加を避けたい

## 2. スコープ

query を付与する対象は **Vite がデフォルトでファイル名ハッシュを付けている参照と同等の範囲**とする。

対象に含むもの:

- HTML の `<script src>`（エントリチャンク）、`<link rel="stylesheet">`、`<link rel="modulepreload">`
- CSS の `url()`
- JS 内のアセット URL（`import img from './x.png'`、`new URL('./x.png', import.meta.url)`）
- `__vitePreload` の依存配列
- チャンク間の import 指定子（`import './dep.js'`、`import('./dep.js')`、`export * from './dep.js'`）
- `public/` の参照のうち、Vite が解決できるもの（後述の制限あり）

対象に含まないもの:

- 開発サーバ（`vite dev`）。Vite が既に `?t=` でモジュールを無効化しているため何もしない
- SSR ビルド（`environment.config.consumer === 'server'`）
- ソース中に文字列でハードコードされたパス

## 3. 前提と受け入れる制約

**query 方式に内在する制約**: 同一パスに上書きデプロイするため、古い HTML を保持しているクライアントが `app.js?v=<旧version>` を要求すると、サーバは新しい中身を返す。ファイル名ハッシュ方式のように旧バージョンのファイルが併存することはない。これは配信方式の性質でありプラグインでは解決できない。上書きデプロイを前提とする運用のもとで受け入れる。

**バージョンの粒度**: ファイル単位のコンテンツハッシュではなく、**ビルド単位の単一バージョン文字列**を全ファイルに一律付与する。デプロイのたびに全ファイルのキャッシュが無効化される代わりに、チャンクグラフを辿ったハッシュ伝播が不要になり、実装が大幅に単純化される。

**対応バージョン**: Vite 8 のみ（`peerDependencies: { vite: "^8.0.0" }`）。Vite 8 のバンドラは Rolldown であり、本設計は Rolldown の出力形式に依存する。Vite 6/7（Rollup）は対象外。

## 4. 公開 API

パッケージ名: `vite-plugin-query-cache-busting`
エクスポート: default export と名前付き export `queryCacheBusting` の両方

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import queryCacheBusting from 'vite-plugin-query-cache-busting'

export default defineConfig({
  base: '/',
  plugins: [
    queryCacheBusting({
      version: () => process.env.GIT_SHA ?? undefined,
      key: 'v',
      verify: 'warn',
    }),
  ],
})
```

```ts
export interface Options {
  /**
   * query に載せる値。
   * 関数が undefined を返した場合はデフォルト（ローカル時刻の YYYYMMDDHHmm）にフォールバックする。
   * @default ローカル時刻の YYYYMMDDHHmm（例: "202607302209"）
   */
  version?: string | (() => string | undefined | Promise<string | undefined>)

  /**
   * query のキー。false を指定するとキー無しの裸クエリ（"?202607302209"）になる。
   * @default 'v'
   */
  key?: string | false

  /**
   * 出力に query 未付与の参照が残っていないかの自己検証。
   * @default 'warn'
   */
  verify?: 'warn' | 'error' | 'off'
}
```

デフォルトのキーを `'v'` とする理由: CDN のキャッシュキー設定では「クエリ文字列のうち特定のパラメータ名だけをキーに含める／除外する」という指定を行うことが多く、キー名が無いとその設定が書けないため。裸クエリが必要な場合は `key: false` で出力できる。

`version` が関数の場合、**ビルド開始時に1回だけ解決**して以降は使い回す。`renderBuiltUrl` が同期関数であるため、非同期の `version` を解決できるのはビルド開始前しかない。

デフォルトのタイムスタンプはローカル時刻。CI（UTC）とローカルで値が変わるが、値に求められる性質は「ビルドごとに変わること」のみなので実害はない。厳密に固定したい場合は `version` で指定する。

v1 では include/exclude によるバンドル出力の絞り込みは設けない。「一部の参照にだけ query が付く」状態はキャッシュ事故の原因になるため、バンドル出力については全付与か無効化かの二択に倒す。

## 5. アーキテクチャ

責務を小さく分割し、大半をバンドラ非依存の純粋関数として実装する。ビルドを回さないと検証できない部分を最小化するため。

| ファイル | 責務 | 依存 |
|---|---|---|
| `src/index.ts` | プラグイン本体。フックを組み立てる薄い層 | 下記すべて |
| `src/options.ts` | `Options` 型、デフォルト値、正規化 | なし |
| `src/version.ts` | `YYYYMMDDHHmm` の生成、`version` オプションの解決 | なし |
| `src/url.ts` | `appendQuery()` / `joinUrlSegments()` — 純粋関数 | なし |
| `src/rewrite-imports.ts` | 1チャンクぶんの import 指定子書き換え | `vite`(parseAst), `magic-string` |
| `src/guards.ts` | 非対応構成の検出とエラー生成 | 型のみ |
| `src/verify.ts` | 出力バンドルの取りこぼし検査 | なし |
| `src/logger.ts` | ログ整形 | `ansis` |

`options.ts` / `version.ts` / `url.ts` / `guards.ts` / `verify.ts` は Vite を起動せずに単体テストできる。実際にビルドを回す必要があるのは `rewrite-imports.ts` と結合部分のみ。

純粋関数群は `logger` を引数で受け取る形にし、`ansis` にも Vite にも直接依存させない。

`url.ts` の `appendQuery()` が扱う分岐:

- 既にクエリがある → `?` ではなく `&` で連結
- ハッシュフラグメント付き（`/a.css#foo`）→ フラグメントの前に挿入
- 外部 URL（`https://`、`//` 始まり）→ 何もしない
- `data:` / `blob:` → 何もしない

`joinUrlSegments()` は base と filename の連結を行う。Vite 内部の `joinUrlSegments` は公開 export に含まれないため自前で持つ。

## 6. フックとデータフロー

```
config(userConfig)
 ├─ 既存の experimental.renderBuiltUrl を退避
 ├─ version を解決（async 可・ビルド中1回だけ）
 └─ ラップした renderBuiltUrl を返す
        ↓
configResolved(config)
 ├─ guards: 非対応構成なら throw
 └─ config.experimental.renderBuiltUrl が自分のラッパーか確認
        ↓
[Vite/Rolldown のビルド]
 ├─ HTML の script/link/modulepreload ─┐
 ├─ CSS の url()                        ├→ ラップした renderBuiltUrl が ?v= を付与
 ├─ JS のアセット URL                   │
 ├─ __vitePreload の deps 配列          │
 └─ public/ の参照                     ─┘
        ↓
renderChunk(code, chunk)  [enforce: 'post']
 └─ parseAst + magic-string でチャンク間 import に ?v= を付与
        ↓
generateBundle(_, bundle)
 ├─ ラッパーが一度も呼ばれていなければ throw（API ドリフト検知）
 └─ verify: query 未付与の参照が残っていないか検査
```

プラグインは `apply: 'build'` 固定、`enforce: 'post'`。

### 6.1 renderBuiltUrl ラッパー

```
(filename, ctx) => {
  ctx.ssr が true       → 退避した既存フックの戻り値をそのまま返す（query を足さない）
  既存フックがあれば呼ぶ
    → string を返した    → その値に appendQuery
    → object を返した    → エラー（{relative} / {runtime} は v1 非対応）
    → undefined を返した → joinUrlSegments(config.base, filename) に appendQuery
  既存フックが無い       → joinUrlSegments(config.base, filename) に appendQuery
}
```

`renderBuiltUrl` は Vite の config に1つしか設定できないため、他プラグインが後から上書きするとプラグインが無言で無効化される。これを防ぐため `configResolved` で解決後の値が自分のラッパーであることを確認する。

### 6.2 チャンク間 import の書き換え

`renderChunk` で `parseAst`（Vite が re-export する oxc パーサ）により AST を取得し、以下4種類のノードのソース文字列リテラルのみを `magic-string` で書き換える。

- `ImportDeclaration.source`
- `ExportNamedDeclaration.source`
- `ExportAllDeclaration.source`
- `ImportExpression.source`（文字列リテラルの場合のみ）

動的に組み立てられた `import(expr)` は対象外とする（Vite でも静的に解決できないため同じ扱い）。

`renderChunk` から `{ code, map }` を返し、sourcemap の連結は Rolldown に任せる。

`__vitePreload` の依存配列は絶対パス（`/assets/dep.js`）、`import()` の指定子は相対パス（`./dep.js`）だが、同じ URL に解決され、同じ query が付くため、モジュールの二重取得は発生しない。

### 6.3 実装前に実測で確認する前提

**「`renderChunk` の時点でチャンク間 import 指定子が最終的な相対パスになっている」**ことは未検証の前提である。ハッシュを使わないため確定しているはずだが、Rolldown での挙動は実測していない。実装の最初のタスクとして最小 fixture を1つビルドして確認する。

確認の結果、指定子が最終形でなかった場合は書き換えを `generateBundle` に移す。その場合 `chunk.code` を直接書き換えることになり、`chunk.map` を `magic-string` の生成するマップと自前でマージする必要が生じる。

## 7. エラー処理とガード

方針は「静かに壊れるくらいなら落とす」。キャッシュバスティングの不具合は画面上に現れず、時間が経ってから古いアセットを掴む形で顕在化するため、ビルド時に検知できることを最優先する。

### 7.1 ビルドを落とすもの

| 条件 | 検知の時点 | 理由 |
|---|---|---|
| 相対 base（`base` が `''`、`'./'`、`.` 始まり） | `configResolved` | Vite が JS 側で実行時計算（`new URL(dep, import.meta.url)`）に切り替えるため、query を静的に付与できない |
| `build.chunkImportMap` が有効 | `configResolved` | Vite 自身が `renderBuiltUrl` との併用を非対応として警告する |
| `build.lib`（ライブラリモード） | `configResolved` | 配布物の import 指定子に query が付くと、利用側のバンドラや Node の解決が壊れる |
| Vite のメジャーバージョンが 8 未満 | `configResolved` | `renderBuiltUrl` / `parseAst` の前提が揃わない |
| 解決後の `renderBuiltUrl` が自分のラッパーでない | `configResolved` | 他プラグインに上書きされ、プラグインが無言で無効化された状態 |
| 既存の `renderBuiltUrl` が object（`{relative}` / `{runtime}`）を返す | ラッパー呼び出し時 | 実行時計算になるため相対 base と同じ理由 |
| ラッパーがビルド中に一度も呼ばれず、かつ出力にアセット・CSS・HTML が存在する | `generateBundle` | Vite 側の API が変わったと判断する（12章のフォールバック判断材料） |

最後の1件はビルドの終盤まで判定できないため `generateBundle` で検査する。それ以外はビルド開始前に落とす。

### 7.2 警告に留めるもの

| 条件 | 挙動 |
|---|---|
| Vite のメジャーバージョンが 9 以上 | 未検証である旨を警告して続行。実害の検知は verify パスに委ねる |
| `output.format` が `es` 以外（`@vitejs/plugin-legacy` 併用時の SystemJS など） | チャンク間 import を書き換えられない旨を警告。`System.register` の依存配列は AST の import ノードではないため v1 では対象外 |

### 7.3 自己検証パス（`verify`）

`generateBundle` で、出力ファイル名の一覧と全出力ファイルの中身を突き合わせ、query が付いていない参照が残っていないかを検査する。検出時はファイル名・位置・前後のスニペットを添えて報告する。

これは文字列照合による検査だが、**書き換えではなく検出にしか使わない**ため、誤検出のコストは余計な警告が出ることに限られる。`verify: 'off'` で抑制、`verify: 'error'` でビルドを落とせる。

## 8. ログ出力

出力先は Vite の `config.logger`（`logLevel` と `customLogger` の設定を尊重するため）。整形のみ `src/logger.ts` で行う。

色付けには `ansis` を用いる。`ansis` は色対応の自動判定と `NO_COLOR` / `FORCE_COLOR` / `--no-color` の尊重を自前で行うため、色の有無を切り替えるオプションは設けない。

**原則**: 色は補助であり、色を落としても情報量が変わらないこと。ラベル・インデント・キャレットで構造を作り、色はその上に乗せるだけにする。CI のログや `customLogger` 経由でファイルに落とした場合に色が失われても読めるようにするため。

### 8.1 配色

| 要素 | 色 |
|---|---|
| プレフィックス `[query-cache-busting]` | `dim` + `cyan` |
| `error` / `warn` ラベル | `red.bold` / `yellow.bold` |
| ファイルパス・位置 | `cyan` |
| query 値（`?v=202607302209`） | `green` |
| 問題箇所（query 未付与の参照） | `red.underline` |
| 件数などの数値 | `bold` |
| 原因・対処の説明行 | `dim` |

### 8.2 出力イメージ

成功時（`logLevel: 'info'`）:

```
[query-cache-busting] ?v=202607302209 を 14 件の参照に付与 (js 8, css 3, html 3)
```

`verify` の検出時:

```
[query-cache-busting] warn  query が付いていない参照が 1 件あります

  assets/index.js:1:2043
    ...fetch("/assets/data.json")...
              ^^^^^^^^^^^^^^^^^^
  ソース中に文字列でハードコードされたパスの可能性があります。
  意図的な場合は verify: 'off' で抑制できます。
```

ガードのエラー時:

```
[query-cache-busting] error  相対 base には対応していません

  base: './'

  相対 base では Vite が JS 内の URL を実行時計算に切り替えるため、
  query を静的に付与できません。絶対パス（例: base: '/'）を指定してください。
```

## 9. テスト戦略

### 9.1 純粋関数の単体テスト（Vite 起動不要）

- `appendQuery`: 既存クエリあり → `&` 連結 / フラグメント付き → フラグメント前に挿入 / `https://`・`//` → 素通し / `data:`・`blob:` → 素通し
- `joinUrlSegments`: base の末尾スラッシュ有無 × filename の先頭スラッシュ有無の組み合わせ
- `version`: `YYYYMMDDHHmm` のゼロ埋め、文字列指定、関数指定、関数が `undefined` を返したときのフォールバック
- `options`: デフォルト値の適用、`key: false` の扱い
- `guards`: 非対応構成それぞれでエラーが出て、文言に原因と対処が含まれること
- `verify`: 未付与の参照を検出できること、付与済みを誤検出しないこと
- `logger`: 色レベルを `new Ansis(0)` で固定し、メッセージの中身をアサートする

### 9.2 `rewrite-imports` の単体テスト（ビルド不要）

JS 文字列を直接入力して出力をアサートする。

- `import x from './a.js'` / `export { y } from './b.js'` / `export * from './c.js'` / `import('./d.js')` → いずれも書き換わる
- `import(someVariable)` → 書き換えない
- コメント内・無関係な文字列リテラル内の `'./a.js'` → 書き換えない（AST ベースであることの検証）
- sourcemap が生成され、位置がずれていないこと

### 9.3 結合テスト（実際に `vite build` を回す）

`vite` の JS API（`build()`）を vitest から呼び、fixture ごとに出力を検証する。

| fixture | 検証内容 |
|---|---|
| `basic` | HTML + CSS + 画像 + 動的 import。HTML の `script`/`link`/`modulepreload`、CSS の `url()`、JS のアセット URL、チャンク間 import、`__vitePreload` の deps がすべて同じ query を持つ |
| `multi-entry` | MPA で複数 HTML |
| `backend` | HTML 無し・`build.manifest: true`・`rollupOptions.input` で JS 指定 |
| `worker` | `new Worker(new URL('./w.js', import.meta.url))` |
| `unsupported` | 相対 base / lib モード / 他プラグインによる `renderBuiltUrl` 上書き → 期待通りエラーになる |

**共通アサーション**: 「出力ファイル名が query 無しで出現する箇所が一つも無い」を全 fixture に適用する。`verify.ts` をテストヘルパとして再利用し、実装とテストで同じ判定を共有する。

**決定性のテスト**: 同じ入力で `version` だけを変えて2回ビルドし、差分が query 部分のみであることを確認する。書き換えが入力に依存しない純粋な変換であることの保証になる。

## 10. リポジトリ整備

現状は `tsdown-starter` のテンプレートのままであり、以下が必要。

- `package.json` のメタ情報を書き換え（`name` / `description` / `author` / `repository` / `homepage` / `bugs` がプレースホルダのまま）
- `magic-string` と `ansis` を `dependencies` に明示（現在は tsdown 経由の間接依存でしか入っていない）
- `vite` を `devDependencies` と `peerDependencies`（`^8.0.0`）に明示（現在は vitest 経由の間接依存）
- `src/index.ts` / `tests/index.test.ts` のスターターのスタブを置き換え
- `prepublishOnly` が `pnpm run build` になっているが `packageManager` は bun のため `bun run build` に修正

## 11. 実装順序

1. リポジトリ整備（`package.json`、依存の明示）
2. **スパイク**: `renderChunk` の時点でチャンク間 import 指定子が最終形か確認（6.3）
3. 純粋関数（`url.ts` / `version.ts` / `options.ts`）+ 単体テスト
4. `logger.ts` + 単体テスト
5. `guards.ts` + 単体テスト
6. `rewrite-imports.ts` + 単体テスト
7. `renderBuiltUrl` ラッパーと `index.ts` の組み立て
8. `verify.ts` + 単体テスト
9. 結合テスト（fixtures）
10. README

スパイク（2）を最初に置くのは、結果次第で 6 と 7 の実装場所が `renderChunk` から `generateBundle` に変わるため。

## 12. フォールバック計画

本設計は Vite の `experimental.renderBuiltUrl` に依存する。以下のいずれかが起きた場合、**案2（`generateBundle` 一括後処理）**へ切り替える。

**切り替えの条件:**

- `renderBuiltUrl` が Vite から削除された、または `experimental` 名前空間から外れて挙動が変わった
- 7.1 の「ラッパーが一度も呼ばれない」ガードが発火する
- verify パスが恒常的に取りこぼしを検出し、`renderBuiltUrl` の適用範囲では埋められないと判明した

**案2の内容:**

`generateBundle` で `OutputBundle` を丸ごと受け取り、出力ファイル名の一覧を作って、全 JS / CSS / HTML から参照を見つけて書き換える。JS は `parseAst` で全文字列リテラルを列挙して照合、CSS は `postcss`、HTML は属性を書き換える。

**案2のコスト:**

- Vite の内部 API に依存しなくなり、API 安定性は上がる
- 3言語ぶんの書き換えロジックを自前で持つため、コード量とテスト量が増える
- JS 側で「文字列リテラルの中身がたまたま出力ファイル名と一致した」場合に誤爆する。AST を使っても、データとして持っている文字列か URL かは区別できない
- `chunk.code` を直接書き換えるため sourcemap を自前でマージする必要がある

切り替え時も `url.ts` / `version.ts` / `options.ts` / `guards.ts` / `verify.ts` / `logger.ts` はそのまま再利用できる。影響範囲は `index.ts` と `rewrite-imports.ts` に限られる。

## 13. 既知の制限

- `public/` は Vite が参照を追跡できる箇所（処理対象の HTML、`import` されたもの）のみ query が付く。ソース中に文字列でハードコードされた `/logo.png` のようなパスには付かない。同じファイルが query 付き／無しの2通りで取得される可能性はあるが、リクエストが1回増えるだけで不整合は起こらない
- `base` に percent-encode を含む場合は非対応。Vite 内部が使う `decodedBase` が公開型に存在しないため
- 相対 base（`base: ''` / `'./'`）非対応
- ライブラリモード非対応
- `@vitejs/plugin-legacy` の SystemJS 出力はチャンク間 import が書き換えられない
- 上書きデプロイ中、古い HTML を持つクライアントは新しい中身のファイルを受け取る（3章）

## 14. 却下した代替案

**ファイル単位のコンテンツハッシュ**: Vite の `[hash]` と同じ意味論を query に移す案。変更のないファイルのキャッシュが保たれる利点があるが、チャンクグラフを辿ったハッシュ伝播が必要になる。上書きデプロイ前提の運用ではビルド単位の単一バージョンで要求を満たせるため却下。

**`generateBundle` 一括後処理（案2）**: 上記12章の通り、フォールバック先として保持する。初期実装として選ばなかったのは、書き換え対象が「全文字列リテラル」に広がり誤爆の余地が構造的に残ること、および Vite の URL 生成規則（base 結合、エンコード、public との出し分け）を再実装する必要があるため。

**正規表現による一括置換（案3）**: 依存ゼロで数十行に収まるが、コメント内や無関係な文字列内も置換され、ミニファイ済みコードで誤爆が読みにくい形で表面化する。公開プラグインとしては採用しない。ただし「検出のみ」の用途では誤検出のコストが警告に留まるため、verify パス（7.3）で同等の仕組みを使う。

**`oxc-parser` を直接の依存に追加**: Vite 8 が `parseAst` / `parseAstAsync`（実体は Rolldown 同梱の oxc）を re-export しているため不要。直接依存させると oxc のネイティブバイナリが二重に入り、Vite/Rolldown 側とのバージョンずれが起こり得る。

## 15. 調査で確認した事実

`vite@8.2.0` の `node_modules/vite/dist/node/chunks/node.js` を読んで確認した内容。

| 参照の種類 | 生成箇所 | `renderBuiltUrl` を通るか |
|---|---|---|
| HTML の `<script src>`（エントリチャンク） | L24599-24603 `toOutputFilePath(filename, "asset")` | 通る |
| HTML の `<link rel="stylesheet">` / `modulepreload` | L24580-24593 | 通る |
| CSS の `url()` | L34029 `toOutputFilePathInCss` | 通る |
| JS 内のアセット URL | L33987 `toOutputFilePathInJS` | 通る |
| `__vitePreload` の deps 配列 | L28980-28984 | 通る |
| `public/` の参照（`type: "public"`） | 同上 | 通る |
| チャンク間の import 指定子 | Rolldown が直接出力 | **通らない** |

その他:

- `vite@8.2.0` の `dependencies` に `rolldown: ~1.2.0` が含まれ、`rollup` は含まれない（インストール済みは `rolldown@1.2.1`）
- `vite` は `parse` / `parseAst` / `parseAstAsync` / `parseSync` を export する
- `build.chunkImportMap` と `experimental.renderBuiltUrl` の併用について Vite 自身が警告を出す（L36757）
- `decodedBase` は `ResolvedConfig` の公開型に存在しない
- `joinUrlSegments` は `vite` の公開 export に含まれない
- `ansis@4.3.1` は依存ゼロで、名前付き export（`red` / `cyan` / `dim` / `bold` など）と `Ansis` クラスを提供する

**未検証の前提**: `renderChunk` の時点でチャンク間 import 指定子が最終的な相対パスになっているか（6.3、実装の最初のタスクで確認する）
