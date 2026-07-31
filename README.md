# vite-plugin-query-cache-busting

Vite のキャッシュバスティングを、ファイル名ハッシュ（`assets/index-a1b2c3d4.js`）ではなく
クエリパラメータ（`assets/index.js?v=202607302209`）で行う Vite プラグインです。

ファイル名を固定したまま配信する必要がある環境（サーバ・CDN・既存テンプレートがパスを
参照している構成）や、同一パスへ上書きデプロイする運用を想定しています。

## Requirements

- Vite 8

## Install

```bash
npm install -D vite-plugin-query-cache-busting
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import queryCacheBusting from 'vite-plugin-query-cache-busting'

export default defineConfig({
  base: '/',
  plugins: [queryCacheBusting()],
})
```

出力は次のようになります。ファイル名からハッシュが消え、代わりにクエリが付きます。

```html
<script type="module" src="/assets/index.js?v=202607302209"></script>
<link rel="stylesheet" href="/assets/index.css?v=202607302209" />
```

プラグインは `entryFileNames` / `chunkFileNames` / `assetFileNames` を `[hash]` 無しのパターンに設定します（`build.assetsDir` は尊重します）。これらを `vite.config.ts` で明示指定している場合はその指定が優先されますが、パターンに `[hash]` が含まれているとビルドが失敗します。ファイル名ハッシュとクエリの二重掛けになり、このプラグインを使う意味がなくなるためです。

## Options

| オプション | 型                                                                      | デフォルト                    | 説明                                                                        |
| ---------- | ----------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| `version`  | `string \| (() => string \| undefined \| Promise<string \| undefined>)` | ローカル時刻の `YYYYMMDDHHmm` | query に載せる値。関数が `undefined` か空文字を返した場合はデフォルトに戻る |
| `key`      | `string \| false`                                                       | `'v'`                         | query のキー。`false` で `?202607302209` の裸クエリ                         |
| `verify`   | `'warn' \| 'error' \| 'off'`                                            | `'warn'`                      | 出力に query 未付与の参照が残っていないかの自己検証                         |

```ts
queryCacheBusting({
  version: () => process.env.GIT_SHA,
  key: 'v',
  verify: 'error',
})
```

`version` は**ビルド開始時に1回だけ**解決され、そのビルドの全ファイルに同じ値が付きます。
ファイル単位のコンテンツハッシュではないため、デプロイのたびに全ファイルのキャッシュが
無効化されます。

## 対象になる参照

- 出力ファイル名からのハッシュ除去（`entryFileNames` / `chunkFileNames` / `assetFileNames`）
- HTML の `<script src>` / `<link rel="stylesheet">` / `<link rel="modulepreload">`
- CSS の `url()`
- JS 内のアセット URL（`import img from './x.png'`、`new URL('./x.png', import.meta.url)`）
- `__vitePreload` の依存配列
- チャンク間の import 指定子
- `.vite/manifest.json` の `file` / `css` / `assets`
- `.vite/ssr-manifest.json` の各値（`build.ssrManifest` 有効時）

SSR ビルド（`vite build --ssr`）には何もしません。出力ファイル名も参照もそのままです。サーバ側のバンドルに query が付くと Node のモジュール解決が壊れるためです。

## エラー表示

対応していない設定やビルド後の検証結果は、[nostics](https://nostics.dev) と同じ「診断コード＋ツリー表示」で出します。

```
[QCB_RELATIVE_BASE] error  相対 base には対応していません: base: "./"
╰▶ fix: 相対 base では Vite が JS 内の URL を実行時計算に切り替えるため、query を静的に付与できません。絶対パス（例: base: '/'）を指定してください。
```

verify の警告・エラーは、取りこぼした参照の位置を `sources` にまとめて表示します。

```
[QCB_MISSING_QUERY] warn  query 未付与の参照が 2 件あります
├▶ fix: ソース中に文字列でハードコードされたパスの可能性があります。意図的な場合は verify: 'off' で抑制できます。
├▶ sources: assets/index.js:1:2043
╰▶ sources: assets/index.css:1:88
```

## 非対応の構成

以下はビルド時にエラーになります。

- 相対 base（`base: ''` / `'./'`）— Vite が JS 内の URL を実行時計算に切り替えるため
- ライブラリモード（`build.lib`）— 利用側のモジュール解決が壊れるため
- `build.chunkImportMap` — Vite 自身が `experimental.renderBuiltUrl` との併用を非対応としているため
- 他のプラグインによる `experimental.renderBuiltUrl` の上書き
- 明示指定した出力ファイル名パターンに `[hash]` が含まれる場合
- `build.rollupOptions.output` が配列（複数出力）の場合

## 既知の制限

- `public/` は Vite が参照を追跡できる箇所（処理対象の HTML、`import` されたもの）にのみ
  query が付きます。ソース中に文字列でハードコードされたパスには付きません
- `base` に percent-encode を含む構成は非対応です
- `@vitejs/plugin-legacy` の SystemJS 出力ではチャンク間 import を書き換えられません（警告が出ます）
- 出力ファイル名パターンを関数で指定している場合、`[hash]` を含むかを静的に検証できません（警告が出ます）
- `build.sourcemap` を有効にしている場合、チャンク間 import を含む行のマッピングが query の長さ分ずれます。書き換えを `generateBundle` で行うため sourcemap の自動連結が使えないためです。import 指定子をデバッグする場面はほぼ無いことから、合成せず制限としています
- ファイル名にハッシュが無いため、同じ `[name]` を持つチャンクが複数あると名前が衝突します。Rolldown が連番を付けて回避しますが、その連番はビルドごとに安定するとは限りません
- 同一パスへ上書きデプロイするため、古い HTML を保持しているクライアントは
  `?v=<旧version>` を要求しても新しい中身のファイルを受け取ります。これはクエリ方式に
  内在する性質で、このプラグインでは解決できません

## License

MIT
