# vite-plugin-query-cache-busting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vite のキャッシュバスティングを、ファイル名ハッシュではなくクエリパラメータ（`assets/index.js?v=202607302209`）で行う Vite プラグインを作る。

**Architecture:** `config` フックで出力ファイル名パターンから `[hash]` を外し、アセット・CSS・HTML・preload・public の URL は Vite の `experimental.renderBuiltUrl` をラップして query を付与する。`renderBuiltUrl` を通らないチャンク間 import 指定子だけを `renderChunk` で `parseAst`（Vite が re-export する oxc パーサ）+ `magic-string` により書き換える。`generateBundle` で manifest の書き換えと自己検証を行う。

**Tech Stack:** TypeScript / Vite 8（バンドラは Rolldown）/ tsdown / vitest / magic-string / ansis / bun

**設計ドキュメント:** [docs/superpowers/specs/2026-07-30-query-cache-busting-design.md](../specs/2026-07-30-query-cache-busting-design.md)

## Global Constraints

これらは全タスクの要件に暗黙に含まれる。

- 対応 Vite は 8 系のみ。`peerDependencies` は `"vite": "^8.0.0"`
- ランタイム依存は `magic-string` と `ansis` の2つだけ。`oxc-parser` を直接の依存に追加しない（Vite が `parseAst` を re-export しているため）
- パッケージ名は `vite-plugin-query-cache-busting`。プラグインの `name` も同じ文字列
- ログのプレフィックスは `[query-cache-busting]`
- ログ・エラーメッセージは日本語。色は補助であり、色を落としても情報量が変わらないこと
- `src/` 配下は1ファイル1責務。`options.ts` / `version.ts` / `url.ts` / `guards.ts` / `verify.ts` / `manifest.ts` / `constants.ts` / `file-names.ts` は Vite にも ansis にも依存しない純粋モジュールに保つ
- TDD。各タスクは「失敗するテストを書く → 失敗を確認 → 最小実装 → 成功を確認 → コミット」の順で進める
- コミットメッセージは Conventional Commits（`feat:` / `test:` / `chore:` / `docs:` / `fix:`）
- linter は **oxlint**、formatter は **oxfmt**。設定は `.oxlintrc.json` / `.oxfmtrc.json`（設定済み）
- **各タスクのコミット直前に `bun run format` と `bun run lint` を実行し、両方通してからコミットする**。この計画のコード例は整形前の形なので、`bun run format` による整形（import のグループ分け・改行位置など）は差分として正常
- コードスタイルは `.oxfmtrc.json` に従う: セミコロン無し・シングルクォート・インデント2スペース・行幅 100・末尾カンマあり・import 自動ソート・`package.json` のキー自動ソート
- `tests/**` では `require-await` と `no-useless-undefined` を `.oxlintrc.json` の `overrides` で無効化してある。「async 関数を受け付けること」「`undefined` を返す関数を受け付けること」を検証するテストがこれらのルールに引っかかるが、その書き方こそがテストの主題だから
- `require-unicode-regexp` は `.oxlintrc.json` で無効化してある。このプラグインの正規表現は ASCII のビルド出力とファイル名パターンだけを相手にしており、`u` フラグを付ける実利が無い一方で、プレースホルダ検出の `/!~\{[0-9a-z]+\}~/` のようなパターンは `u` モードでは `\{` が不正なエスケープになり書き換えを強いられるため。**この計画に書かれた正規表現に `u` フラグを足さないこと**

## 設計ドキュメントからの差分

以下2点は spec の 5 章のモジュール表に無いが、実装上必要になったため本計画で追加する。

0. **`src/file-names.ts` と出力ファイル名からのハッシュ除去（Task 7・Task 11）** — spec の初版に「出力ファイル名から `[hash]` を外す」処理が抜けており、そのままでは `assets/index-a1b2c3d4.js?v=...` とハッシュとクエリの二重掛けになっていた。Task 2 のスパイクで判明し、spec 2 章・5 章・6 章・7 章・13 章・15.1 節に反映済み。利用者が `entryFileNames` などを明示指定していればそれを尊重し、そのパターンに `[hash]` が含まれていればビルドを落とす。

1. **`src/constants.ts`** — `PLUGIN_NAME` と `LOG_PREFIX` の定数置き場。`options.ts` などの純粋モジュールからもエラーメッセージ用に参照するため、`logger.ts`（ansis 依存）とは別に切り出す。
2. **`src/manifest.ts`（Task 10）と Task 11 での manifest 書き換え** — spec の 2 章のスコープに `.vite/manifest.json` が含まれていなかったが、バックエンド統合（spec 9.3 の `backend` fixture が想定する構成）ではテンプレートが manifest の `file` を読んでタグを組み立てるため、manifest を書き換えないとエントリファイルに query が付かず、その構成でのキャッシュバスティングが機能しない。`file` / `css` / `assets` の各パスのみ書き換え、`imports` / `dynamicImports`（manifest のキーであってパスではない）と `src` は書き換えない。

---

### Task 1: リポジトリ整備と依存の明示

現状の `package.json` は名前も説明もスターターのままで、`magic-string` も `vite` も間接依存でしか入っていない。oxlint / oxfmt と各種スクリプトは設定済みなので、それを壊さないよう残す。

キーの並び順は oxfmt の `sortPackageJson` が決めるため、下のブロックは既にソート済みの順序で書いてある（`peerDependencies` が `devDependencies` の後に来る点に注意）。

**Files:**
- Modify: `package.json`

- [ ] **Step 1: `package.json` を書き換える**

`package.json` の全体を以下で置き換える。

```json
{
  "name": "vite-plugin-query-cache-busting",
  "version": "0.0.0",
  "description": "Vite plugin that busts caches with a query parameter instead of a filename hash.",
  "keywords": [
    "vite",
    "vite-plugin",
    "cache-busting",
    "cache",
    "query"
  ],
  "homepage": "https://github.com/mokume3/vite-plugin-query-cache-busting#readme",
  "bugs": {
    "url": "https://github.com/mokume3/vite-plugin-query-cache-busting/issues"
  },
  "license": "MIT",
  "author": "Sagara <mokume.dev@gmail.com>",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/mokume3/vite-plugin-query-cache-busting.git"
  },
  "files": [
    "dist"
  ],
  "type": "module",
  "exports": {
    ".": "./dist/index.mjs",
    "./package.json": "./package.json"
  },
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch",
    "test": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "format": "oxfmt",
    "format:check": "oxfmt --check",
    "check": "bun run lint && bun run format:check && bun run typecheck",
    "release": "bumpp",
    "prepublishOnly": "bun run build"
  },
  "dependencies": {
    "ansis": "^4.3.1",
    "magic-string": "^0.30.21"
  },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "bumpp": "^11.1.0",
    "oxfmt": "^0.61.0",
    "oxlint": "^1.76.0",
    "tsdown": "^0.22.5",
    "typescript": "^7.0.2",
    "vite": "^8.2.0",
    "vitest": "^4.1.10"
  },
  "peerDependencies": {
    "vite": "^8.0.0"
  },
  "packageManager": "bun@1.3.14"
}
```

- [ ] **Step 2: 依存をインストールする**

```bash
bun install
```

Expected: エラーなく完了し、`node_modules/ansis`・`node_modules/magic-string`・`node_modules/vite` が存在する。

- [ ] **Step 3: lint / format / 型チェックが通ることを確認する**

```bash
bun run check
```

Expected: `oxlint` が 0 件、`oxfmt --check` が "All matched files use the correct format."、`tsc --noEmit` がエラーなし。

`oxfmt --check` が落ちた場合は `bun run format` を実行してから再度確認する。

- [ ] **Step 4: コミット**

```bash
git add package.json bun.lock
git commit -m "chore: set package metadata and declare direct dependencies"
```

---

### Task 2: 前提のスパイクテスト

spec 6.3 の前提（`renderChunk` の時点でチャンク間 import 指定子が最終形か、`parseAst` のノードが `start`/`end` を持つか）を実測で確認する。この結果次第で Task 9・Task 11 の実装場所が変わるため最初に行う。

**重要（spec 15.1 で実測済み）**: この前提は**出力ファイル名パターンから `[hash]` を外している場合にのみ成立する**。Vite のデフォルト（`assets/[name]-[hash].js`）のままだと、`renderChunk` には `import("./lazy-!~{001}~.js")` のようにハッシュのプレースホルダが渡ってくる。プラグイン本体（Task 11）は `config` フックでこのパターンを設定するので、スパイクテストでも同じ設定を再現したうえで検証する。

このテストは使い捨てにせず、前提が将来崩れたときに気づけるよう回帰テストとして残す。

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/fixtures/basic/index.html`
- Create: `tests/fixtures/basic/src/main.ts`
- Create: `tests/fixtures/basic/src/lazy.ts`
- Create: `tests/fixtures/basic/src/shared.ts`
- Create: `tests/fixtures/basic/src/style.css`
- Create: `tests/fixtures/basic/src/lazy.css`
- Create: `tests/fixtures/basic/src/logo.svg`
- Create: `tests/assumptions.test.ts`
- Delete: `src/index.ts`
- Delete: `tests/index.test.ts`

**Interfaces:**
- Produces: `tests/fixtures/basic/` — 以降の結合テスト（Task 11・Task 12）が同じ fixture を使う。エントリ HTML 1枚、CSS 2枚（うち1枚は `url()` でSVGを参照）、動的 import 1つ、main と lazy の両方から import される共有モジュール1つ、という構成。

- [ ] **Step 1: vitest の設定を作る**

Vite のビルドを回すテストがデフォルトの 5 秒タイムアウトに収まらないため、テストのタイムアウトを延ばす。

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
```

- [ ] **Step 2: `basic` fixture を作る**

`tests/fixtures/basic/index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>basic fixture</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`tests/fixtures/basic/src/main.ts`:

```ts
import './style.css'
import logoUrl from './logo.svg'
import { shared } from './shared'

const app = document.querySelector('#app')
if (app !== null) {
  app.innerHTML = `<img src="${logoUrl}" alt="${shared}" />`
}

document.addEventListener('click', () => {
  void import('./lazy')
})
```

`tests/fixtures/basic/src/lazy.ts`:

```ts
import './lazy.css'
import { shared } from './shared'

export const lazyValue = `lazy:${shared}`
```

`tests/fixtures/basic/src/shared.ts`:

```ts
export const shared = 'shared-value'
```

`tests/fixtures/basic/src/style.css`:

```css
.app {
  background-image: url('./logo.svg');
}
```

`tests/fixtures/basic/src/lazy.css`:

```css
.lazy {
  color: rebeccapurple;
}
```

`tests/fixtures/basic/src/logo.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="#4b8bbe"/></svg>
```

- [ ] **Step 3: スパイクテストを書く**

`tests/assumptions.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { build, parseAst } from 'vite'
import { expect, test } from 'vitest'

const basicRoot = fileURLToPath(new URL('./fixtures/basic', import.meta.url))

test('parseAst は import 指定子を start/end 付きの Literal で返す', () => {
  const ast = parseAst('import a from "./dep.js"\nexport * from "../other.js"\n') as unknown as {
    body: { source: { type: string, value: unknown, start: number, end: number } }[]
  }

  const [importNode, exportNode] = ast.body

  expect(importNode?.source.type).toBe('Literal')
  expect(importNode?.source.value).toBe('./dep.js')
  expect(typeof importNode?.source.start).toBe('number')
  expect(typeof importNode?.source.end).toBe('number')
  expect(exportNode?.source.value).toBe('../other.js')
})

// プラグイン本体が config フックで設定するのと同じ、[hash] を含まないパターン
const hashFreeOutput = {
  entryFileNames: 'assets/[name].js',
  chunkFileNames: 'assets/[name].js',
  assetFileNames: 'assets/[name].[ext]',
}

async function captureRenderChunk(output: Record<string, string>) {
  const captured: { fileName: string, code: string }[] = []

  await build({
    root: basicRoot,
    base: '/',
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      assetsInlineLimit: 0,
      rollupOptions: { output },
    },
    plugins: [
      {
        name: 'capture-render-chunk',
        enforce: 'post',
        renderChunk(code, chunk) {
          captured.push({ fileName: chunk.fileName, code })
          return null
        },
      },
    ],
  })

  return captured
}

test('[hash] を外せば renderChunk はチャンク間 import の最終的な相対パスを受け取る', async () => {
  const captured = await captureRenderChunk(hashFreeOutput)

  expect(captured.length).toBeGreaterThan(1)

  const allCode = captured.map((chunk) => chunk.code).join('\n')

  // 動的 import が最終的な相対パスで出ている
  expect(allCode).toMatch(/import\(["']\.\/[\w.-]+\.js["']\)/)

  // 静的なチャンク間 import も最終的な相対パスで出ている
  expect(allCode).toMatch(/from\s*["']\.\/[\w.-]+\.js["']/)

  // ハッシュプレースホルダが残っていない
  expect(allCode).not.toMatch(/!~\{[0-9a-z]+\}~/)
})

test('[hash] が残っているとプレースホルダが渡ってくる（この設計が必要な理由）', async () => {
  const captured = await captureRenderChunk({
    entryFileNames: 'assets/[name]-[hash].js',
    chunkFileNames: 'assets/[name]-[hash].js',
    assetFileNames: 'assets/[name]-[hash].[ext]',
  })

  const allCode = captured.map((chunk) => chunk.code).join('\n')

  expect(allCode).toMatch(/!~\{[0-9a-z]+\}~/)
})
```

- [ ] **Step 4: スターターのスタブを削除する**

```bash
git rm src/index.ts tests/index.test.ts
```

- [ ] **Step 5: テストを実行して前提を確認する**

```bash
bun run test -- --run tests/assumptions.test.ts
```

Expected: 3 件とも PASS。

**PASS しなかった場合**: `[hash]` を外しても `renderChunk` の時点で指定子が最終形にならないということなので、実装を止めて報告する。その場合 Task 9 の書き換えは `renderChunk` ではなく `generateBundle` で行い、`chunk.map` と `magic-string` のマップを自前でマージする必要がある（spec 6.3）。

- [ ] **Step 6: コミット**

```bash
git add vitest.config.ts tests/assumptions.test.ts tests/fixtures/basic
git commit -m "test: verify renderChunk and parseAst assumptions with a build spike"
```

---

### Task 3: URL 操作の純粋関数

**Files:**
- Create: `src/url.ts`
- Test: `tests/url.test.ts`

**Interfaces:**
- Produces:
  - `appendQuery(url: string, query: string): string` — 外部 URL・`data:`・`blob:` は素通し。既存クエリがあれば `&`、無ければ `?` で連結。ハッシュフラグメントの手前に挿入
  - `buildQuery(key: string | false, version: string): string` — `'v=202607302209'` または `'202607302209'`
  - `joinUrlSegments(base: string, path: string): string` — Vite 内部の同名関数相当

- [ ] **Step 1: 失敗するテストを書く**

`tests/url.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { appendQuery, buildQuery, joinUrlSegments } from '../src/url'

describe('appendQuery', () => {
  test('クエリが無い URL には ? で連結する', () => {
    expect(appendQuery('/assets/a.js', 'v=1')).toBe('/assets/a.js?v=1')
  })

  test('既にクエリがある URL には & で連結する', () => {
    expect(appendQuery('/assets/a.js?x=1', 'v=1')).toBe('/assets/a.js?x=1&v=1')
  })

  test('ハッシュフラグメントの手前に挿入する', () => {
    expect(appendQuery('/assets/a.css#top', 'v=1')).toBe('/assets/a.css?v=1#top')
  })

  test('クエリとフラグメントが両方ある場合も手前に挿入する', () => {
    expect(appendQuery('/a.css?x=1#top', 'v=1')).toBe('/a.css?x=1&v=1#top')
  })

  test('http/https の外部 URL は変更しない', () => {
    expect(appendQuery('https://cdn.example.com/a.js', 'v=1')).toBe('https://cdn.example.com/a.js')
  })

  test('プロトコル相対 URL は変更しない', () => {
    expect(appendQuery('//cdn.example.com/a.js', 'v=1')).toBe('//cdn.example.com/a.js')
  })

  test('data: URI は変更しない', () => {
    expect(appendQuery('data:image/svg+xml,%3Csvg%3E', 'v=1')).toBe('data:image/svg+xml,%3Csvg%3E')
  })

  test('blob: URL は変更しない', () => {
    expect(appendQuery('blob:http://localhost/abc', 'v=1')).toBe('blob:http://localhost/abc')
  })

  test('query が空文字なら変更しない', () => {
    expect(appendQuery('/assets/a.js', '')).toBe('/assets/a.js')
  })
})

describe('buildQuery', () => {
  test('key ありならキー付きのクエリを返す', () => {
    expect(buildQuery('v', '202607302209')).toBe('v=202607302209')
  })

  test('key が false なら裸のクエリを返す', () => {
    expect(buildQuery(false, '202607302209')).toBe('202607302209')
  })

  test('version を URL エンコードする', () => {
    expect(buildQuery('v', 'a b')).toBe('v=a%20b')
  })
})

describe('joinUrlSegments', () => {
  test('base のスラッシュが重複しない', () => {
    expect(joinUrlSegments('/', 'assets/a.js')).toBe('/assets/a.js')
  })

  test('サブパスの base を結合できる', () => {
    expect(joinUrlSegments('/app/', 'assets/a.js')).toBe('/app/assets/a.js')
  })

  test('base に末尾スラッシュが無くても結合できる', () => {
    expect(joinUrlSegments('/app', '/assets/a.js')).toBe('/app/assets/a.js')
  })

  test('base が空なら path をそのまま返す', () => {
    expect(joinUrlSegments('', 'assets/a.js')).toBe('assets/a.js')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bun run test -- --run tests/url.test.ts
```

Expected: FAIL。`Failed to resolve import "../src/url"` のようなモジュール未解決エラー。

- [ ] **Step 3: 最小実装を書く**

`src/url.ts`:

```ts
const EXTERNAL_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/**
 * URL にクエリ文字列を付与する。
 * 外部 URL・data:・blob: は対象外。ハッシュフラグメントの手前に挿入する。
 */
export function appendQuery(url: string, query: string): string {
  if (query === '') return url
  if (EXTERNAL_URL_RE.test(url)) return url

  const hashIndex = url.indexOf('#')
  const pathname = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const separator = pathname.includes('?') ? '&' : '?'

  return `${pathname}${separator}${query}${hash}`
}

/** key と version からクエリ文字列を組み立てる */
export function buildQuery(key: string | false, version: string): string {
  const encodedVersion = encodeURIComponent(version)
  return key === false ? encodedVersion : `${encodeURIComponent(key)}=${encodedVersion}`
}

/** base と出力ファイル名を結合する（Vite 内部の joinUrlSegments 相当） */
export function joinUrlSegments(base: string, path: string): string {
  if (base === '' || path === '') return base + path

  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const prefixedPath = path.startsWith('/') ? path : `/${path}`

  return trimmedBase + prefixedPath
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bun run test -- --run tests/url.test.ts
```

Expected: 16 件すべて PASS。

- [ ] **Step 5: コミット**

```bash
git add src/url.ts tests/url.test.ts
git commit -m "feat: add url helpers for appending the cache-busting query"
```

---

### Task 4: バージョン解決

**Files:**
- Create: `src/version.ts`
- Test: `tests/version.test.ts`

**Interfaces:**
- Produces:
  - `type VersionOption = string | (() => string | undefined | Promise<string | undefined>)`
  - `formatTimestamp(date: Date): string` — ローカル時刻の `YYYYMMDDHHmm`
  - `resolveVersion(version: VersionOption | undefined, now?: Date): Promise<string>`

- [ ] **Step 1: 失敗するテストを書く**

`tests/version.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { formatTimestamp, resolveVersion } from '../src/version'

// ローカル時刻の 2026-07-30 22:09
const fixedDate = new Date(2026, 6, 30, 22, 9)

describe('formatTimestamp', () => {
  test('YYYYMMDDHHmm の 12 桁を返す', () => {
    expect(formatTimestamp(fixedDate)).toBe('202607302209')
  })

  test('1 桁の月日時分をゼロ埋めする', () => {
    expect(formatTimestamp(new Date(2026, 0, 5, 3, 4))).toBe('202601050304')
  })
})

describe('resolveVersion', () => {
  test('文字列をそのまま返す', async () => {
    await expect(resolveVersion('abc')).resolves.toBe('abc')
  })

  test('同期関数の戻り値を返す', async () => {
    await expect(resolveVersion(() => 'abc')).resolves.toBe('abc')
  })

  test('非同期関数の戻り値を返す', async () => {
    await expect(resolveVersion(async () => 'abc')).resolves.toBe('abc')
  })

  test('未指定ならタイムスタンプにフォールバックする', async () => {
    await expect(resolveVersion(undefined, fixedDate)).resolves.toBe('202607302209')
  })

  test('関数が undefined を返したらタイムスタンプにフォールバックする', async () => {
    await expect(resolveVersion(() => undefined, fixedDate)).resolves.toBe('202607302209')
  })

  test('関数が空文字を返したらタイムスタンプにフォールバックする', async () => {
    await expect(resolveVersion(() => '', fixedDate)).resolves.toBe('202607302209')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bun run test -- --run tests/version.test.ts
```

Expected: FAIL。`Failed to resolve import "../src/version"`。

- [ ] **Step 3: 最小実装を書く**

`src/version.ts`:

```ts
export type VersionOption = string | (() => string | undefined | Promise<string | undefined>)

/** Date をローカル時刻の YYYYMMDDHHmm にする */
export function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')

  return [
    String(date.getFullYear()),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('')
}

/**
 * version オプションを解決する。
 * 関数が undefined か空文字を返した場合はタイムスタンプにフォールバックする。
 */
export async function resolveVersion(
  version: VersionOption | undefined,
  now: Date = new Date(),
): Promise<string> {
  if (typeof version === 'string') return version

  if (typeof version === 'function') {
    const resolved = await version()
    if (resolved !== undefined && resolved !== '') return resolved
  }

  return formatTimestamp(now)
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bun run test -- --run tests/version.test.ts
```

Expected: 8 件すべて PASS。

- [ ] **Step 5: コミット**

```bash
git add src/version.ts tests/version.test.ts
git commit -m "feat: resolve the cache-busting version with a timestamp fallback"
```

---

### Task 5: 定数モジュールとオプションの正規化

定数は `options.ts` のエラーメッセージで実際に使われる形になるため、同じタスクで作る。`normalizeOptions` のテストがプレフィックスを検証することで定数も一緒に覆われる。

**Files:**
- Create: `src/constants.ts`
- Create: `src/options.ts`
- Test: `tests/options.test.ts`

**Interfaces:**
- Consumes: `VersionOption`（Task 4）
- Produces:
  - `PLUGIN_NAME: string`（`'vite-plugin-query-cache-busting'`）、`LOG_PREFIX: string`（`'[query-cache-busting]'`）— `src/constants.ts`
  - `interface Options { version?: VersionOption, key?: string | false, verify?: VerifyMode }`
  - `type VerifyMode = 'warn' | 'error' | 'off'`
  - `interface ResolvedOptions { version: VersionOption | undefined, key: string | false, verify: VerifyMode }`
  - `normalizeOptions(options?: Options): ResolvedOptions`

- [ ] **Step 1: 失敗するテストを書く**

`tests/options.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { normalizeOptions } from '../src/options'

describe('normalizeOptions', () => {
  test('未指定なら key は "v"、verify は "warn"', () => {
    expect(normalizeOptions()).toEqual({ version: undefined, key: 'v', verify: 'warn' })
  })

  test('指定した値をそのまま保持する', () => {
    expect(normalizeOptions({ version: 'abc', key: 'ver', verify: 'error' })).toEqual({
      version: 'abc',
      key: 'ver',
      verify: 'error',
    })
  })

  test('key: false を許可する', () => {
    expect(normalizeOptions({ key: false }).key).toBe(false)
  })

  test('version が空文字ならエラー', () => {
    expect(() => normalizeOptions({ version: '' })).toThrow(/version/)
  })

  test('key が空文字ならエラー', () => {
    expect(() => normalizeOptions({ key: '' })).toThrow(/key/)
  })

  test('key に "=" が含まれるとエラー', () => {
    expect(() => normalizeOptions({ key: 'a=b' })).toThrow(/key/)
  })

  test('key に空白が含まれるとエラー', () => {
    expect(() => normalizeOptions({ key: 'a b' })).toThrow(/key/)
  })

  test('verify が想定外の値ならエラー', () => {
    expect(() => normalizeOptions({ verify: 'loud' as never })).toThrow(/verify/)
  })

  test('エラーメッセージにプラグインのプレフィックスが入る', () => {
    expect(() => normalizeOptions({ key: '' })).toThrow(/\[query-cache-busting\]/)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bun run test -- --run tests/options.test.ts
```

Expected: FAIL。`Failed to resolve import "../src/options"`。

- [ ] **Step 3: 最小実装を書く**

まず定数モジュールを作る。

`src/constants.ts`:

```ts
export const PLUGIN_NAME = 'vite-plugin-query-cache-busting'

export const LOG_PREFIX = '[query-cache-busting]'
```

続いてオプションの正規化を書く。

`src/options.ts`:

```ts
import { LOG_PREFIX } from './constants'
import type { VersionOption } from './version'

export type VerifyMode = 'warn' | 'error' | 'off'

export interface Options {
  /**
   * query に載せる値。
   * 関数が undefined か空文字を返した場合はデフォルト（ローカル時刻の YYYYMMDDHHmm）にフォールバックする。
   * @default ローカル時刻の YYYYMMDDHHmm（例: "202607302209"）
   */
  version?: VersionOption

  /**
   * query のキー。false を指定するとキー無しの裸クエリ（"?202607302209"）になる。
   * @default 'v'
   */
  key?: string | false

  /**
   * 出力に query 未付与の参照が残っていないかの自己検証。
   * @default 'warn'
   */
  verify?: VerifyMode
}

export interface ResolvedOptions {
  version: VersionOption | undefined
  key: string | false
  verify: VerifyMode
}

const VERIFY_MODES: readonly VerifyMode[] = ['warn', 'error', 'off']
const INVALID_KEY_CHAR_RE = /[=?&#\s]/

export function normalizeOptions(options: Options = {}): ResolvedOptions {
  const { version, key = 'v', verify = 'warn' } = options

  if (version === '') {
    throw new Error(`${LOG_PREFIX} option "version" must not be an empty string`)
  }

  if (key !== false) {
    if (typeof key !== 'string' || key === '') {
      throw new Error(`${LOG_PREFIX} option "key" must be a non-empty string or false`)
    }
    if (INVALID_KEY_CHAR_RE.test(key)) {
      throw new Error(
        `${LOG_PREFIX} option "key" must not contain "=", "?", "&", "#" or whitespace, got ${JSON.stringify(key)}`,
      )
    }
  }

  if (!VERIFY_MODES.includes(verify)) {
    throw new Error(
      `${LOG_PREFIX} option "verify" must be one of "warn", "error", "off", got ${JSON.stringify(verify)}`,
    )
  }

  return { version, key, verify }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bun run test -- --run tests/options.test.ts
```

Expected: 9 件すべて PASS。

- [ ] **Step 5: コミット**

```bash
git add src/constants.ts src/options.ts tests/options.test.ts
git commit -m "feat: normalize and validate plugin options"
```

---

### Task 6: 検出結果のデータ構造と取りこぼし検査

`verify` は「書き換え」ではなく「検出」にしか使わない（spec 7.3）。誤検出のコストは警告が増えることに限られる。

**Files:**
- Create: `src/verify.ts`
- Test: `tests/verify.test.ts`

**Interfaces:**
- Consumes: なし（純粋モジュール）
- Produces:
  - `interface OutputFile { fileName: string, content: string }`
  - `interface Finding { file: string, line: number, column: number, reference: string, snippet: string, caretOffset: number }`
  - `isScannableFile(fileName: string): boolean` — `.js` `.mjs` `.cjs` `.css` `.html` のみ true
  - `isTrackedName(fileName: string): boolean` — `.map` で終わるものだけ false
  - `findMissingQuery(files: OutputFile[], referenceNames: string[], query: string): Finding[]`

- [ ] **Step 1: 失敗するテストを書く**

`tests/verify.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { findMissingQuery, isScannableFile, isTrackedName } from '../src/verify'

describe('isScannableFile', () => {
  test('js / css / html は走査対象', () => {
    expect(isScannableFile('assets/a.js')).toBe(true)
    expect(isScannableFile('assets/a.css')).toBe(true)
    expect(isScannableFile('index.html')).toBe(true)
  })

  test('map / json / 画像は走査対象外', () => {
    expect(isScannableFile('assets/a.js.map')).toBe(false)
    expect(isScannableFile('.vite/manifest.json')).toBe(false)
    expect(isScannableFile('assets/logo.svg')).toBe(false)
  })
})

describe('isTrackedName', () => {
  test('sourcemap は参照名として追跡しない', () => {
    expect(isTrackedName('assets/a.js.map')).toBe(false)
  })

  test('それ以外は追跡する', () => {
    expect(isTrackedName('assets/a.js')).toBe(true)
    expect(isTrackedName('assets/logo.svg')).toBe(true)
  })
})

describe('findMissingQuery', () => {
  test('query が付いていれば検出しない', () => {
    const files = [{ fileName: 'index.html', content: '<script src="/assets/a.js?v=1"></script>' }]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toEqual([])
  })

  test('query が付いていなければ検出する', () => {
    const files = [{ fileName: 'index.html', content: '<script src="/assets/a.js"></script>' }]
    const findings = findMissingQuery(files, ['assets/a.js'], 'v=1')

    expect(findings).toHaveLength(1)
    expect(findings[0]?.file).toBe('index.html')
    expect(findings[0]?.reference).toBe('assets/a.js')
    expect(findings[0]?.line).toBe(1)
    expect(findings[0]?.column).toBe(15)
  })

  test('別のバージョンの query は検出する', () => {
    const files = [{ fileName: 'index.html', content: '<script src="/assets/a.js?v=0"></script>' }]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toHaveLength(1)
  })

  test('より長いファイル名の一部に一致しても検出しない', () => {
    const files = [{ fileName: 'assets/a.js', content: '//# sourceMappingURL=a.js.map' }]
    expect(findMissingQuery(files, ['assets/a.js', 'a.js'], 'v=1')).toEqual([])
  })

  test('名前文字が直前にある場合は参照とみなさない', () => {
    const files = [{ fileName: 'assets/a.js', content: 'const x = "xassets/a.js"' }]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toEqual([])
  })

  test('画像アセットの参照も検出する', () => {
    const files = [{ fileName: 'assets/a.css', content: '.x{background:url(/assets/logo.svg)}' }]
    expect(findMissingQuery(files, ['assets/logo.svg'], 'v=1')).toHaveLength(1)
  })

  test('sourcemap ファイルは走査しない', () => {
    const files = [{ fileName: 'assets/a.js.map', content: '{"sources":["/assets/a.js"]}' }]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toEqual([])
  })

  test('行番号と桁番号を複数行で正しく計算する', () => {
    const files = [{ fileName: 'index.html', content: 'line1\n<link href="/assets/a.css">' }]
    const findings = findMissingQuery(files, ['assets/a.css'], 'v=1')

    expect(findings[0]?.line).toBe(2)
    expect(findings[0]?.column).toBe(14)
  })

  test('スニペットとキャレット位置を返す', () => {
    const files = [{ fileName: 'index.html', content: '<script src="/assets/a.js"></script>' }]
    const finding = findMissingQuery(files, ['assets/a.js'], 'v=1')[0]

    expect(finding?.snippet).toBe('<script src="/assets/a.js"></script>')
    expect(finding?.caretOffset).toBe(14)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bun run test -- --run tests/verify.test.ts
```

Expected: FAIL。`Failed to resolve import "../src/verify"`。

- [ ] **Step 3: 最小実装を書く**

`src/verify.ts`:

```ts
export interface OutputFile {
  fileName: string
  content: string
}

export interface Finding {
  file: string
  line: number
  column: number
  reference: string
  snippet: string
  caretOffset: number
}

const SCANNED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.css', '.html']
const NAME_CHAR_RE = /[A-Za-z0-9_.-]/
const SNIPPET_CONTEXT = 30

/** 中身を走査する対象のファイルか */
export function isScannableFile(fileName: string): boolean {
  return SCANNED_EXTENSIONS.some((extension) => fileName.endsWith(extension))
}

/** 参照名として追跡する対象のファイルか（sourcemap は URL として参照されないため除外） */
export function isTrackedName(fileName: string): boolean {
  return !fileName.endsWith('.map')
}

/**
 * 出力ファイルの中から、query が付いていない出力ファイル名への参照を探す。
 * 書き換えは行わず検出のみ。
 */
export function findMissingQuery(
  files: OutputFile[],
  referenceNames: string[],
  query: string,
): Finding[] {
  const findings: Finding[] = []
  const names = referenceNames.filter(isTrackedName)

  for (const file of files) {
    if (!isScannableFile(file.fileName)) continue

    for (const name of names) {
      let index = file.content.indexOf(name)

      while (index !== -1) {
        if (
          isReferenceBoundary(file.content, index, name)
          && !file.content.startsWith(`?${query}`, index + name.length)
        ) {
          findings.push(createFinding(file.fileName, file.content, index, name))
        }
        index = file.content.indexOf(name, index + 1)
      }
    }
  }

  return findings
}

/** 前後が名前文字でないこと（より長いファイル名の一部への一致を弾く） */
function isReferenceBoundary(content: string, index: number, name: string): boolean {
  if (index > 0 && NAME_CHAR_RE.test(content[index - 1] ?? '')) return false

  const afterIndex = index + name.length
  if (afterIndex >= content.length) return true

  return !NAME_CHAR_RE.test(content[afterIndex] ?? '')
}

function createFinding(fileName: string, content: string, index: number, reference: string): Finding {
  const before = content.slice(0, index)
  const line = before.split('\n').length
  const lineStart = before.lastIndexOf('\n') + 1
  const column = index - lineStart + 1

  const rawLineEnd = content.indexOf('\n', index)
  const lineEnd = rawLineEnd === -1 ? content.length : rawLineEnd

  const contextStart = Math.max(lineStart, index - SNIPPET_CONTEXT)
  const contextEnd = Math.min(lineEnd, index + reference.length + SNIPPET_CONTEXT)

  const prefix = contextStart > lineStart ? '...' : ''
  const suffix = contextEnd < lineEnd ? '...' : ''

  return {
    file: fileName,
    line,
    column,
    reference,
    snippet: `${prefix}${content.slice(contextStart, contextEnd)}${suffix}`,
    caretOffset: prefix.length + (index - contextStart),
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bun run test -- --run tests/verify.test.ts
```

Expected: 13 件すべて PASS。

- [ ] **Step 5: コミット**

```bash
git add src/verify.ts tests/verify.test.ts
git commit -m "feat: detect references that are missing the cache-busting query"
```

---

### Task 7: ガードと出力ファイル名パターン

このプラグインの前提は「出力ファイル名にハッシュが付かないこと」なので、パターンの決定と `[hash]` の検出は同じタスクで作る。パターン決定は純粋関数として `src/file-names.ts` に切り出し、その結果を使うエラー生成を `src/guards.ts` に置く。

**Files:**
- Create: `src/file-names.ts`
- Create: `src/guards.ts`
- Test: `tests/file-names.test.ts`
- Test: `tests/guards.test.ts`

**Interfaces:**
- Consumes: なし（純粋モジュール）
- Produces（`src/file-names.ts`）:
  - `interface OutputFileNames { entryFileNames: string, chunkFileNames: string, assetFileNames: string }`
  - `containsHashPlaceholder(pattern: string): boolean` — `[hash]` / `[hash:8]` を検出
  - `buildFileNames(assetsDir: string): OutputFileNames`
  - `interface FileNamesDecision { patch: Partial<OutputFileNames>, hashed: string[], unverifiable: string[] }`
  - `decideFileNames(userOutput: Record<string, unknown>, assetsDir: string): FileNamesDecision`
- Produces（`src/guards.ts`）:
  - `interface Issue { title: string, details: string[], hints: string[] }`
  - `interface ConfigSnapshot { base: string, isLib: boolean, chunkImportMap: boolean, viteMajor: number }`
  - `collectConfigIssues(snapshot: ConfigSnapshot): { errors: Issue[], warnings: Issue[] }`
  - `parseMajor(version: string): number`
  - `hijackedRenderBuiltUrlIssue(): Issue`
  - `userHookReturnedObjectIssue(): Issue`
  - `apiDriftIssue(): Issue`
  - `nonEsFormatIssue(format: string): Issue`
  - `manifestMissingIssue(manifestFileName: string): Issue`
  - `hashedFileNamePatternIssue(keys: string[]): Issue`
  - `unverifiableFileNamePatternIssue(keys: string[]): Issue`
  - `multipleOutputsIssue(): Issue`

- [ ] **Step 1: `file-names` の失敗するテストを書く**

`tests/file-names.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { buildFileNames, containsHashPlaceholder, decideFileNames } from '../src/file-names'

describe('containsHashPlaceholder', () => {
  test('[hash] を検出する', () => {
    expect(containsHashPlaceholder('assets/[name]-[hash].js')).toBe(true)
  })

  test('桁数指定つきの [hash:8] も検出する', () => {
    expect(containsHashPlaceholder('assets/[name]-[hash:8].js')).toBe(true)
  })

  test('ハッシュを含まないパターンは false', () => {
    expect(containsHashPlaceholder('assets/[name].js')).toBe(false)
  })
})

describe('buildFileNames', () => {
  test('assetsDir を前置したパターンを返す', () => {
    expect(buildFileNames('assets')).toEqual({
      entryFileNames: 'assets/[name].js',
      chunkFileNames: 'assets/[name].js',
      assetFileNames: 'assets/[name].[ext]',
    })
  })

  test('assetsDir が空なら前置しない', () => {
    expect(buildFileNames('')).toEqual({
      entryFileNames: '[name].js',
      chunkFileNames: '[name].js',
      assetFileNames: '[name].[ext]',
    })
  })

  test('ネストした assetsDir も扱える', () => {
    expect(buildFileNames('static/build').entryFileNames).toBe('static/build/[name].js')
  })
})

describe('decideFileNames', () => {
  test('利用者指定が無ければ3つとも埋める', () => {
    const decision = decideFileNames({}, 'assets')

    expect(decision.patch).toEqual(buildFileNames('assets'))
    expect(decision.hashed).toEqual([])
    expect(decision.unverifiable).toEqual([])
  })

  test('利用者が指定したキーは patch に含めず、他のキーだけ埋める', () => {
    const decision = decideFileNames({ entryFileNames: 'js/[name].js' }, 'assets')

    expect(decision.patch.entryFileNames).toBeUndefined()
    expect(decision.patch.chunkFileNames).toBe('assets/[name].js')
    expect(decision.hashed).toEqual([])
  })

  test('利用者指定に [hash] があれば hashed に入れる', () => {
    const decision = decideFileNames({ entryFileNames: 'js/[name]-[hash].js' }, 'assets')

    expect(decision.hashed).toEqual(['entryFileNames'])
    expect(decision.patch.entryFileNames).toBeUndefined()
  })

  test('関数で指定されたキーは unverifiable に入れる', () => {
    const decision = decideFileNames({ assetFileNames: () => 'x' }, 'assets')

    expect(decision.unverifiable).toEqual(['assetFileNames'])
    expect(decision.patch.assetFileNames).toBeUndefined()
  })

  test('複数キーの [hash] をまとめて返す', () => {
    const decision = decideFileNames(
      { entryFileNames: '[name]-[hash].js', chunkFileNames: '[name]-[hash].js' },
      'assets',
    )

    expect(decision.hashed).toEqual(['entryFileNames', 'chunkFileNames'])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bun run test -- --run tests/file-names.test.ts
```

Expected: FAIL。`Failed to resolve import "../src/file-names"`。

- [ ] **Step 3: `src/file-names.ts` を書く**

```ts
const HASH_PLACEHOLDER_RE = /\[hash(?::\d+)?\]/

export interface OutputFileNames {
  entryFileNames: string
  chunkFileNames: string
  assetFileNames: string
}

export interface FileNamesDecision {
  /** プラグインが設定するパターン（利用者が明示指定したキーは含まない） */
  patch: Partial<OutputFileNames>
  /** 利用者が指定したパターンのうち [hash] を含むキー */
  hashed: string[]
  /** 関数で指定されていて静的に検証できないキー */
  unverifiable: string[]
}

const FILE_NAME_KEYS = ['entryFileNames', 'chunkFileNames', 'assetFileNames'] as const

/** パターンにコンテンツハッシュのプレースホルダが含まれるか */
export function containsHashPlaceholder(pattern: string): boolean {
  return HASH_PLACEHOLDER_RE.test(pattern)
}

/** ハッシュを含まない出力ファイル名パターンを組み立てる */
export function buildFileNames(assetsDir: string): OutputFileNames {
  const prefix = assetsDir === '' ? '' : `${assetsDir}/`

  return {
    entryFileNames: `${prefix}[name].js`,
    chunkFileNames: `${prefix}[name].js`,
    assetFileNames: `${prefix}[name].[ext]`,
  }
}

/**
 * 利用者の output 設定を見て、プラグインが補うパターンと検査結果を返す。
 * 利用者が明示指定したキーは尊重し、上書きしない。
 */
export function decideFileNames(
  userOutput: Record<string, unknown>,
  assetsDir: string,
): FileNamesDecision {
  const defaults = buildFileNames(assetsDir)
  const patch: Partial<OutputFileNames> = {}
  const hashed: string[] = []
  const unverifiable: string[] = []

  for (const key of FILE_NAME_KEYS) {
    const value = userOutput[key]

    if (value === undefined) {
      patch[key] = defaults[key]
      continue
    }

    if (typeof value === 'string') {
      if (containsHashPlaceholder(value)) hashed.push(key)
      continue
    }

    unverifiable.push(key)
  }

  return { patch, hashed, unverifiable }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bun run test -- --run tests/file-names.test.ts
```

Expected: 12 件すべて PASS。

- [ ] **Step 5: `guards` の失敗するテストを書く**

`tests/guards.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  apiDriftIssue,
  collectConfigIssues,
  hashedFileNamePatternIssue,
  hijackedRenderBuiltUrlIssue,
  manifestMissingIssue,
  multipleOutputsIssue,
  nonEsFormatIssue,
  parseMajor,
  unverifiableFileNamePatternIssue,
  userHookReturnedObjectIssue,
} from '../src/guards'

const supported = { base: '/', isLib: false, chunkImportMap: false, viteMajor: 8 }

describe('parseMajor', () => {
  test('メジャーバージョンを取り出す', () => {
    expect(parseMajor('8.2.0')).toBe(8)
  })

  test('解釈できなければ 0 を返す', () => {
    expect(parseMajor('unknown')).toBe(0)
  })
})

describe('collectConfigIssues', () => {
  test('対応構成なら何も返さない', () => {
    expect(collectConfigIssues(supported)).toEqual({ errors: [], warnings: [] })
  })

  test('base が "./" ならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, base: './' })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.title).toMatch(/相対 base/)
    expect(errors[0]?.details.join('')).toMatch(/\.\//)
  })

  test('base が空文字ならエラー', () => {
    expect(collectConfigIssues({ ...supported, base: '' }).errors).toHaveLength(1)
  })

  test('base が "." 始まりならエラー', () => {
    expect(collectConfigIssues({ ...supported, base: '../x/' }).errors).toHaveLength(1)
  })

  test('ライブラリモードならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, isLib: true })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.title).toMatch(/build\.lib/)
  })

  test('chunkImportMap が有効ならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, chunkImportMap: true })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.title).toMatch(/chunkImportMap/)
  })

  test('Vite 7 以下ならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, viteMajor: 7 })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.title).toMatch(/Vite 8/)
  })

  test('Vite 9 以上なら警告', () => {
    const { errors, warnings } = collectConfigIssues({ ...supported, viteMajor: 9 })

    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.title).toMatch(/未検証/)
  })

  test('複数の非対応構成をまとめて返す', () => {
    expect(collectConfigIssues({ base: './', isLib: true, chunkImportMap: true, viteMajor: 8 }).errors)
      .toHaveLength(3)
  })
})

describe('個別の Issue', () => {
  test('どの Issue も title と hints を持つ', () => {
    const issues = [
      hijackedRenderBuiltUrlIssue(),
      userHookReturnedObjectIssue(),
      apiDriftIssue(),
      nonEsFormatIssue('system'),
      manifestMissingIssue('.vite/manifest.json'),
      hashedFileNamePatternIssue(['entryFileNames']),
      unverifiableFileNamePatternIssue(['assetFileNames']),
      multipleOutputsIssue(),
    ]

    for (const issue of issues) {
      expect(issue.title.length).toBeGreaterThan(0)
      expect(issue.hints.length).toBeGreaterThan(0)
    }
  })

  test('nonEsFormatIssue は形式名を含む', () => {
    expect(nonEsFormatIssue('system').details.join('')).toMatch(/system/)
  })

  test('manifestMissingIssue はファイル名を含む', () => {
    expect(manifestMissingIssue('.vite/manifest.json').details.join('')).toMatch(/manifest\.json/)
  })

  test('hashedFileNamePatternIssue は該当キー名を含む', () => {
    const issue = hashedFileNamePatternIssue(['entryFileNames', 'chunkFileNames'])

    expect(issue.details.join('')).toMatch(/entryFileNames/)
    expect(issue.details.join('')).toMatch(/chunkFileNames/)
  })

  test('unverifiableFileNamePatternIssue は該当キー名を含む', () => {
    expect(unverifiableFileNamePatternIssue(['assetFileNames']).details.join(''))
      .toMatch(/assetFileNames/)
  })
})
```

- [ ] **Step 6: テストが失敗することを確認する**

```bash
bun run test -- --run tests/guards.test.ts
```

Expected: FAIL。`Failed to resolve import "../src/guards"`。

- [ ] **Step 7: `src/guards.ts` を書く**

```ts
export interface Issue {
  title: string
  details: string[]
  hints: string[]
}

export interface ConfigSnapshot {
  base: string
  isLib: boolean
  chunkImportMap: boolean
  viteMajor: number
}

/** バージョン文字列からメジャーバージョンを取り出す。解釈できなければ 0 */
export function parseMajor(version: string): number {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10)
  return Number.isNaN(major) ? 0 : major
}

export function collectConfigIssues(snapshot: ConfigSnapshot): { errors: Issue[], warnings: Issue[] } {
  const errors: Issue[] = []
  const warnings: Issue[] = []

  if (snapshot.base === '' || snapshot.base.startsWith('.')) {
    errors.push({
      title: '相対 base には対応していません',
      details: [`base: ${JSON.stringify(snapshot.base)}`],
      hints: [
        '相対 base では Vite が JS 内の URL を実行時計算に切り替えるため、',
        "query を静的に付与できません。絶対パス（例: base: '/'）を指定してください。",
      ],
    })
  }

  if (snapshot.isLib) {
    errors.push({
      title: 'ライブラリモード（build.lib）には対応していません',
      details: ['build.lib が設定されています'],
      hints: [
        '配布物の import 指定子に query が付くと、利用側のバンドラや Node の',
        'モジュール解決が壊れるためです。',
      ],
    })
  }

  if (snapshot.chunkImportMap) {
    errors.push({
      title: 'build.chunkImportMap と併用できません',
      details: ['build.chunkImportMap が有効になっています'],
      hints: [
        'Vite 自身が build.chunkImportMap と experimental.renderBuiltUrl の',
        '併用を非対応としています。どちらか一方を無効にしてください。',
      ],
    })
  }

  if (snapshot.viteMajor < 8) {
    errors.push({
      title: `Vite 8 以上が必要です（検出: ${snapshot.viteMajor}）`,
      details: [],
      hints: ['experimental.renderBuiltUrl と parseAst の前提が Vite 8 未満では揃いません。'],
    })
  } else if (snapshot.viteMajor > 8) {
    warnings.push({
      title: `Vite ${snapshot.viteMajor} は未検証です`,
      details: [],
      hints: [
        'このプラグインは Vite 8 でのみ検証されています。',
        'ビルド後に verify の警告が出ていないか確認してください。',
      ],
    })
  }

  return { errors, warnings }
}

export function hijackedRenderBuiltUrlIssue(): Issue {
  return {
    title: 'experimental.renderBuiltUrl が別のプラグインに上書きされています',
    details: ['解決後の設定値がこのプラグインのラッパーではありません'],
    hints: [
      'renderBuiltUrl は1つしか設定できないため、このままではキャッシュバスティングが',
      '無言で無効になります。競合するプラグインを外すか、順序を調整してください。',
    ],
  }
}

export function userHookReturnedObjectIssue(): Issue {
  return {
    title: '既存の renderBuiltUrl がオブジェクトを返しました',
    details: ['{ relative } / { runtime } の戻り値には対応していません'],
    hints: [
      '実行時計算になるため query を静的に付与できません。',
      '既存の renderBuiltUrl が文字列を返すようにしてください。',
    ],
  }
}

export function apiDriftIssue(): Issue {
  return {
    title: 'renderBuiltUrl がビルド中に一度も呼ばれませんでした',
    details: ['アセット・CSS・HTML が出力されているのにフックが呼ばれていません'],
    hints: [
      'Vite 側の experimental.renderBuiltUrl の仕様が変わった可能性があります。',
      'このプラグインのバージョンと Vite のバージョンの組み合わせを確認してください。',
    ],
  }
}

export function nonEsFormatIssue(format: string): Issue {
  return {
    title: 'ES 形式以外の出力ではチャンク間 import を書き換えられません',
    details: [`output.format: ${format}`],
    hints: [
      'SystemJS などの形式では import 指定子が AST の import ノードとして現れないためです。',
      'アセット・CSS・HTML への query 付与は引き続き行われます。',
    ],
  }
}

export function manifestMissingIssue(manifestFileName: string): Issue {
  return {
    title: 'manifest を書き換えられませんでした',
    details: [`出力に ${manifestFileName} が見つかりません`],
    hints: [
      'Vite の manifest 生成がこのプラグインより後で行われた可能性があります。',
      'このままではバックエンド統合時に query が付かないため、ビルドを中断しました。',
    ],
  }
}

export function hashedFileNamePatternIssue(keys: string[]): Issue {
  return {
    title: '出力ファイル名パターンに [hash] が含まれています',
    details: keys.map((key) => `build.rollupOptions.output.${key}`),
    hints: [
      'ファイル名ハッシュと query の二重掛けになり、このプラグインを使う意味が',
      'なくなります。パターンから [hash] を外してください。',
    ],
  }
}

export function unverifiableFileNamePatternIssue(keys: string[]): Issue {
  return {
    title: '出力ファイル名パターンが関数で指定されているため検証できません',
    details: keys.map((key) => `build.rollupOptions.output.${key}`),
    hints: [
      '関数が [hash] を含む名前を返さないか、静的に判定できません。',
      'ビルド後に出力ファイル名にハッシュが付いていないか確認してください。',
    ],
  }
}

export function multipleOutputsIssue(): Issue {
  return {
    title: 'build.rollupOptions.output が配列（複数出力）の構成には対応していません',
    details: ['output が配列で指定されています'],
    hints: [
      'v1 では単一出力のみ対応しています。output を単一のオブジェクトにしてください。',
    ],
  }
}
```

- [ ] **Step 8: テストが通ることを確認する**

```bash
bun run test -- --run tests/guards.test.ts
```

Expected: 16 件すべて PASS。

- [ ] **Step 9: コミット**

```bash
git add src/file-names.ts src/guards.ts tests/file-names.test.ts tests/guards.test.ts
git commit -m "feat: resolve hash-free output file names and detect unsupported configs"
```

---

### Task 8: ログ整形

**Files:**
- Create: `src/logger.ts`
- Test: `tests/logger.test.ts`

**Interfaces:**
- Consumes: `LOG_PREFIX`（Task 5）、`Issue`（Task 7、型のみ）、`Finding`（Task 6、型のみ）
- Produces:
  - `interface Palette { prefix, label, path, query, bad, count, hint }`（各 `(text: string) => string`、`label` のみ `(level: 'warn' | 'error', text: string) => string`）
  - `createPalette(ansis?: Ansis): Palette`
  - `formatIssue(palette: Palette, level: 'warn' | 'error', issue: Issue): string`
  - `formatFindings(palette: Palette, level: 'warn' | 'error', findings: Finding[]): string`
  - `formatSummary(palette: Palette, query: string, counts: Record<string, number>): string`

- [ ] **Step 1: 失敗するテストを書く**

`tests/logger.test.ts`:

```ts
import { Ansis } from 'ansis'
import { describe, expect, test } from 'vitest'
import { createPalette, formatFindings, formatIssue, formatSummary } from '../src/logger'

// 色レベルを 0 に固定して、色コードではなくメッセージの中身を検証する
const plain = createPalette(new Ansis(0))

describe('formatSummary', () => {
  test('付与件数と内訳を1行で返す', () => {
    expect(formatSummary(plain, 'v=202607302209', { js: 8, css: 3, html: 3 }))
      .toBe('[query-cache-busting] ?v=202607302209 を 14 件の参照に付与 (js 8, css 3, html 3)')
  })

  test('内訳が空なら括弧を出さない', () => {
    expect(formatSummary(plain, 'v=1', {})).toBe('[query-cache-busting] ?v=1 を 0 件の参照に付与')
  })

  test('件数 0 の拡張子は内訳に出さない', () => {
    expect(formatSummary(plain, 'v=1', { js: 2, css: 0 }))
      .toBe('[query-cache-busting] ?v=1 を 2 件の参照に付与 (js 2)')
  })
})

describe('formatIssue', () => {
  test('タイトル・詳細・ヒントを整形する', () => {
    const message = formatIssue(plain, 'error', {
      title: '相対 base には対応していません',
      details: ["base: './'"],
      hints: ['絶対パスを指定してください。'],
    })

    expect(message).toBe(
      [
        '[query-cache-busting] error  相対 base には対応していません',
        '',
        "  base: './'",
        '',
        '  絶対パスを指定してください。',
      ].join('\n'),
    )
  })

  test('詳細が空なら詳細ブロックを出さない', () => {
    const message = formatIssue(plain, 'warn', { title: 'タイトル', details: [], hints: ['ヒント'] })

    expect(message).toBe(['[query-cache-busting] warn  タイトル', '', '  ヒント'].join('\n'))
  })
})

describe('formatFindings', () => {
  test('位置・スニペット・キャレットを整形する', () => {
    const message = formatFindings(plain, 'warn', [
      {
        file: 'assets/index.js',
        line: 1,
        column: 15,
        reference: 'assets/a.js',
        snippet: '<script src="/assets/a.js">',
        caretOffset: 14,
      },
    ])

    expect(message).toBe(
      [
        '[query-cache-busting] warn  query が付いていない参照が 1 件あります',
        '',
        '  assets/index.js:1:15',
        '    <script src="/assets/a.js">',
        '                  ^^^^^^^^^^^',
        '',
        '  ソース中に文字列でハードコードされたパスの可能性があります。',
        "  意図的な場合は verify: 'off' で抑制できます。",
      ].join('\n'),
    )
  })
})

describe('createPalette', () => {
  test('色レベル 1 なら ANSI コードが付く', () => {
    const colored = createPalette(new Ansis(1))

    expect(colored.bad('x')).not.toBe('x')
    expect(colored.bad('x')).toContain('x')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bun run test -- --run tests/logger.test.ts
```

Expected: FAIL。`Failed to resolve import "../src/logger"`。

- [ ] **Step 3: 最小実装を書く**

`src/logger.ts`:

```ts
import { Ansis } from 'ansis'
import { LOG_PREFIX } from './constants'
import type { Issue } from './guards'
import type { Finding } from './verify'

export type IssueLevel = 'warn' | 'error'

export interface Palette {
  prefix: (text: string) => string
  label: (level: IssueLevel, text: string) => string
  path: (text: string) => string
  query: (text: string) => string
  bad: (text: string) => string
  count: (text: string) => string
  hint: (text: string) => string
}

/**
 * 配色を作る。
 * テストでは new Ansis(0) を渡して色を無効化し、メッセージの中身を検証する。
 */
export function createPalette(ansis: Ansis = new Ansis()): Palette {
  return {
    prefix: (text) => ansis.cyan.dim(text),
    label: (level, text) => (level === 'error' ? ansis.red.bold(text) : ansis.yellow.bold(text)),
    path: (text) => ansis.cyan(text),
    query: (text) => ansis.green(text),
    bad: (text) => ansis.red.underline(text),
    count: (text) => ansis.bold(text),
    hint: (text) => ansis.dim(text),
  }
}

export function formatSummary(palette: Palette, query: string, counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const breakdown = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([extension, count]) => `${extension} ${count}`)
    .join(', ')

  const head = `${palette.prefix(LOG_PREFIX)} ${palette.query(`?${query}`)} を ${palette.count(String(total))} 件の参照に付与`

  return breakdown === '' ? head : `${head} (${breakdown})`
}

export function formatIssue(palette: Palette, level: IssueLevel, issue: Issue): string {
  const lines = [`${palette.prefix(LOG_PREFIX)} ${palette.label(level, level)}  ${issue.title}`]

  if (issue.details.length > 0) {
    lines.push('')
    for (const detail of issue.details) lines.push(`  ${detail}`)
  }

  if (issue.hints.length > 0) {
    lines.push('')
    for (const hint of issue.hints) lines.push(`  ${palette.hint(hint)}`)
  }

  return lines.join('\n')
}

export function formatFindings(palette: Palette, level: IssueLevel, findings: Finding[]): string {
  const lines = [
    `${palette.prefix(LOG_PREFIX)} ${palette.label(level, level)}  query が付いていない参照が ${palette.count(String(findings.length))} 件あります`,
    '',
  ]

  for (const finding of findings) {
    lines.push(`  ${palette.path(`${finding.file}:${finding.line}:${finding.column}`)}`)
    lines.push(`    ${finding.snippet}`)
    lines.push(`    ${' '.repeat(finding.caretOffset)}${palette.bad('^'.repeat(finding.reference.length))}`)
    lines.push('')
  }

  lines.push(`  ${palette.hint('ソース中に文字列でハードコードされたパスの可能性があります。')}`)
  lines.push(`  ${palette.hint("意図的な場合は verify: 'off' で抑制できます。")}`)

  return lines.join('\n')
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bun run test -- --run tests/logger.test.ts
```

Expected: 7 件すべて PASS。

- [ ] **Step 5: コミット**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat: format plugin logs with ansis"
```

---

### Task 9: チャンク間 import の書き換え

Task 2 のスパイクで確認した前提（`renderChunk` の時点で指定子が最終形、`parseAst` のノードが `start`/`end` を持つ）の上に実装する。

**Files:**
- Create: `src/rewrite-imports.ts`
- Test: `tests/rewrite-imports.test.ts`

**Interfaces:**
- Consumes: `appendQuery`（Task 3）
- Produces:
  - `interface RewriteResult { code: string, map: ReturnType<MagicString['generateMap']>, count: number }`
  - `rewriteImports(code: string, query: string, fileName: string): RewriteResult | null` — 書き換えが 0 件なら `null`

- [ ] **Step 1: 失敗するテストを書く**

`tests/rewrite-imports.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { rewriteImports } from '../src/rewrite-imports'

const rewrite = (code: string): string | null => rewriteImports(code, 'v=1', 'chunk.js')?.code ?? null

describe('rewriteImports', () => {
  test('静的 import を書き換える', () => {
    expect(rewrite('import a from "./dep.js"')).toBe('import a from "./dep.js?v=1"')
  })

  test('名前付き re-export を書き換える', () => {
    expect(rewrite('export { b } from "./dep.js"')).toBe('export { b } from "./dep.js?v=1"')
  })

  test('全体 re-export を書き換える', () => {
    expect(rewrite('export * from "./dep.js"')).toBe('export * from "./dep.js?v=1"')
  })

  test('動的 import を書き換える', () => {
    expect(rewrite('const p = import("./dep.js")')).toBe('const p = import("./dep.js?v=1")')
  })

  test('関数の中の動的 import も書き換える', () => {
    expect(rewrite('function load() { return import("../a/dep.js") }'))
      .toBe('function load() { return import("../a/dep.js?v=1") }')
  })

  test('絶対パスの指定子を書き換える', () => {
    expect(rewrite('import a from "/assets/dep.js"')).toBe('import a from "/assets/dep.js?v=1"')
  })

  test('複数の指定子をすべて書き換える', () => {
    const result = rewriteImports('import a from "./a.js"\nimport b from "./b.js"\n', 'v=1', 'chunk.js')

    expect(result?.count).toBe(2)
    expect(result?.code).toBe('import a from "./a.js?v=1"\nimport b from "./b.js?v=1"\n')
  })

  test('ベア指定子は書き換えない', () => {
    expect(rewrite('import a from "react"')).toBeNull()
  })

  test('外部 URL は書き換えない', () => {
    expect(rewrite('import a from "https://cdn.example.com/dep.js"')).toBeNull()
  })

  test('プロトコル相対 URL は書き換えない', () => {
    expect(rewrite('import a from "//cdn.example.com/dep.js"')).toBeNull()
  })

  test('変数を渡す動的 import は書き換えない', () => {
    expect(rewrite('const p = import(name)')).toBeNull()
  })

  test('source を持たない export は書き換えない', () => {
    expect(rewrite('const c = 1\nexport { c }')).toBeNull()
  })

  test('import 位置以外の文字列は書き換えない', () => {
    expect(rewrite('const s = "./dep.js"\n// see ./dep.js\n')).toBeNull()
  })

  test('書き換えが無ければ null を返す', () => {
    expect(rewriteImports('const a = 1', 'v=1', 'chunk.js')).toBeNull()
  })

  test('sourcemap を生成する', () => {
    const result = rewriteImports('import a from "./dep.js"', 'v=1', 'chunk.js')

    expect(result?.map.mappings.length).toBeGreaterThan(0)
    expect(result?.map.sources).toContain('chunk.js')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bun run test -- --run tests/rewrite-imports.test.ts
```

Expected: FAIL。`Failed to resolve import "../src/rewrite-imports"`。

- [ ] **Step 3: 最小実装を書く**

`src/rewrite-imports.ts`:

```ts
import MagicString from 'magic-string'
import { parseAst } from 'vite'
import { appendQuery } from './url'

interface AstNode {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

interface StringLiteralNode extends AstNode {
  type: 'Literal'
  value: string
}

export interface RewriteResult {
  code: string
  map: ReturnType<MagicString['generateMap']>
  count: number
}

const SOURCE_BEARING_TYPES = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
  'ImportExpression',
])

const SKIPPED_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'parent'])

/**
 * チャンク間の import 指定子に query を付与する。
 * 書き換え対象は import / export の source と import() の引数リテラルのみ。
 */
export function rewriteImports(code: string, query: string, fileName: string): RewriteResult | null {
  const ast = parseAst(code)
  const magicString = new MagicString(code)
  let count = 0

  walk(ast, (node) => {
    if (!SOURCE_BEARING_TYPES.has(node.type)) return

    const source = node.source
    if (!isStringLiteral(source)) return
    if (!isRewritableSpecifier(source.value)) return

    const rewritten = appendQuery(source.value, query)
    if (rewritten === source.value) return

    magicString.update(source.start, source.end, JSON.stringify(rewritten))
    count += 1
  })

  if (count === 0) return null

  return {
    code: magicString.toString(),
    map: magicString.generateMap({ hires: 'boundary', source: fileName }),
    count,
  }
}

/** AST を総なめして type を持つノードを訪問する */
function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (node === null || typeof node !== 'object') return

  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }

  const record = node as Record<string, unknown>
  if (typeof record.type === 'string') visit(record as AstNode)

  for (const key of Object.keys(record)) {
    if (SKIPPED_KEYS.has(key)) continue
    walk(record[key], visit)
  }
}

function isStringLiteral(node: unknown): node is StringLiteralNode {
  if (node === null || typeof node !== 'object') return false

  const record = node as Record<string, unknown>
  return record.type === 'Literal' && typeof record.value === 'string'
}

/** チャンクへの参照とみなせる指定子か（ベア指定子と外部 URL を除く） */
function isRewritableSpecifier(specifier: string): boolean {
  if (specifier.startsWith('//')) return false

  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bun run test -- --run tests/rewrite-imports.test.ts
```

Expected: 15 件すべて PASS。

- [ ] **Step 5: コミット**

```bash
git add src/rewrite-imports.ts tests/rewrite-imports.test.ts
git commit -m "feat: append the cache-busting query to chunk import specifiers"
```

---

### Task 10: manifest の書き換え

バックエンド統合ではテンプレートが `.vite/manifest.json` の `file` を読んでタグを組み立てるため、ここに query が無いとエントリファイルのキャッシュバスティングが機能しない。

**Files:**
- Create: `src/manifest.ts`
- Test: `tests/manifest.test.ts`

**Interfaces:**
- Consumes: `appendQuery`（Task 3）
- Produces: `rewriteManifest(source: string, query: string): string`

- [ ] **Step 1: 失敗するテストを書く**

`tests/manifest.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { rewriteManifest } from '../src/manifest'

const parse = (source: string): Record<string, Record<string, unknown>> =>
  JSON.parse(source) as Record<string, Record<string, unknown>>

describe('rewriteManifest', () => {
  test('file に query を付与する', () => {
    const source = JSON.stringify({ 'src/main.ts': { file: 'assets/main.js', isEntry: true } })

    expect(parse(rewriteManifest(source, 'v=1'))['src/main.ts']?.file).toBe('assets/main.js?v=1')
  })

  test('css と assets の各要素に query を付与する', () => {
    const source = JSON.stringify({
      'src/main.ts': { file: 'assets/main.js', css: ['assets/main.css'], assets: ['assets/logo.svg'] },
    })
    const entry = parse(rewriteManifest(source, 'v=1'))['src/main.ts']

    expect(entry?.css).toEqual(['assets/main.css?v=1'])
    expect(entry?.assets).toEqual(['assets/logo.svg?v=1'])
  })

  test('imports と dynamicImports は書き換えない（manifest のキーであってパスではない）', () => {
    const source = JSON.stringify({
      'src/main.ts': { file: 'assets/main.js', imports: ['_shared.js'], dynamicImports: ['src/lazy.ts'] },
    })
    const entry = parse(rewriteManifest(source, 'v=1'))['src/main.ts']

    expect(entry?.imports).toEqual(['_shared.js'])
    expect(entry?.dynamicImports).toEqual(['src/lazy.ts'])
  })

  test('src とその他のフィールドは書き換えない', () => {
    const source = JSON.stringify({ 'src/main.ts': { file: 'assets/main.js', src: 'src/main.ts', isEntry: true } })
    const entry = parse(rewriteManifest(source, 'v=1'))['src/main.ts']

    expect(entry?.src).toBe('src/main.ts')
    expect(entry?.isEntry).toBe(true)
  })

  test('複数エントリをすべて書き換える', () => {
    const source = JSON.stringify({
      'src/a.ts': { file: 'assets/a.js' },
      'src/b.ts': { file: 'assets/b.js' },
    })
    const manifest = parse(rewriteManifest(source, 'v=1'))

    expect(manifest['src/a.ts']?.file).toBe('assets/a.js?v=1')
    expect(manifest['src/b.ts']?.file).toBe('assets/b.js?v=1')
  })

  test('2 スペースインデントの JSON を返す', () => {
    const source = JSON.stringify({ 'src/main.ts': { file: 'assets/main.js' } })

    expect(rewriteManifest(source, 'v=1')).toContain('\n  "src/main.ts"')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bun run test -- --run tests/manifest.test.ts
```

Expected: FAIL。`Failed to resolve import "../src/manifest"`。

- [ ] **Step 3: 最小実装を書く**

`src/manifest.ts`:

```ts
import { appendQuery } from './url'

const PATH_ARRAY_FIELDS = ['css', 'assets'] as const

/**
 * Vite の manifest 内のファイルパスに query を付与する。
 * imports / dynamicImports は manifest のキーでありパスではないため書き換えない。
 */
export function rewriteManifest(source: string, query: string): string {
  const manifest = JSON.parse(source) as Record<string, Record<string, unknown>>

  for (const entry of Object.values(manifest)) {
    if (typeof entry.file === 'string') {
      entry.file = appendQuery(entry.file, query)
    }

    for (const field of PATH_ARRAY_FIELDS) {
      const value = entry[field]
      if (!Array.isArray(value)) continue

      entry[field] = value.map((item) => (typeof item === 'string' ? appendQuery(item, query) : item))
    }
  }

  return JSON.stringify(manifest, null, 2)
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bun run test -- --run tests/manifest.test.ts
```

Expected: 6 件すべて PASS。

- [ ] **Step 5: コミット**

```bash
git add src/manifest.ts tests/manifest.test.ts
git commit -m "feat: append the cache-busting query to manifest paths"
```

---

### Task 11: プラグイン本体の組み立て

ここまでの全モジュールを Vite のフックに繋ぐ。

**Files:**
- Create: `src/index.ts`
- Test: `tests/integration/basic.test.ts`
- Create: `tests/helpers/build.ts`

**Interfaces:**
- Consumes: Task 3〜10 のすべて
- Produces:
  - `queryCacheBusting(options?: Options): Plugin`（名前付き export）
  - `export default queryCacheBusting`
  - `export type { Options, VerifyMode } from './options'`
  - `tests/helpers/build.ts` の `buildFixture(root, options?, overrides?): Promise<BuiltFile[]>` と `expectAllReferencesBusted(files, query)` — Task 12 も使う

- [ ] **Step 1: 失敗する結合テストとテストヘルパを書く**

`tests/helpers/build.ts`:

```ts
import { build, mergeConfig, type InlineConfig } from 'vite'
import { expect } from 'vitest'
import queryCacheBusting from '../../src'
import type { Options } from '../../src'
import { findMissingQuery } from '../../src/verify'

export interface BuiltFile {
  fileName: string
  content: string
}

const MANIFEST_SUFFIX = 'manifest.json'

/** fixture をメモリ上でビルドして、出力ファイルの一覧を返す */
export async function buildFixture(
  root: string,
  options: Options = {},
  overrides: InlineConfig = {},
): Promise<BuiltFile[]> {
  const config = mergeConfig<InlineConfig, InlineConfig>(
    {
      root,
      base: '/',
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        assetsInlineLimit: 0,
      },
      plugins: [queryCacheBusting(options)],
    },
    overrides,
  )

  const result = await build(config)
  const bundles = (Array.isArray(result) ? result : [result]) as {
    output: ({ fileName: string } & ({ type: 'chunk', code: string } | { type: 'asset', source: string | Uint8Array }))[]
  }[]

  const files: BuiltFile[] = []
  for (const bundle of bundles) {
    for (const output of bundle.output) {
      files.push({
        fileName: output.fileName,
        content: output.type === 'chunk' ? output.code : String(output.source),
      })
    }
  }

  return files
}

/** 出力中に query 未付与の参照が1件も無いことを検証する */
export function expectAllReferencesBusted(files: BuiltFile[], query: string): void {
  const scanned = files.filter((file) => !file.fileName.endsWith(MANIFEST_SUFFIX))
  const names = scanned.map((file) => file.fileName)

  expect(findMissingQuery(scanned, names, query)).toEqual([])
}

/** 拡張子で出力ファイルを絞り込む */
export function filesByExtension(files: BuiltFile[], extension: string): BuiltFile[] {
  return files.filter((file) => file.fileName.endsWith(extension))
}
```

`tests/integration/basic.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { buildFixture, expectAllReferencesBusted, filesByExtension } from '../helpers/build'

const basicRoot = fileURLToPath(new URL('../fixtures/basic', import.meta.url))
const query = 'v=testver'

describe('basic fixture', () => {
  test('出力ファイル名にハッシュが付かない', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })

    expect(files.map((file) => file.fileName).sort()).toEqual([
      'assets/index.css',
      'assets/index.js',
      'assets/lazy.css',
      'assets/lazy.js',
      'assets/logo.svg',
      'index.html',
    ])
  })

  test('HTML の script と link に query が付く', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })
    const html = filesByExtension(files, '.html')[0]

    expect(html).toBeDefined()
    expect(html?.content).toMatch(/<script[^>]+src="\/assets\/[\w.-]+\.js\?v=testver"/)
    expect(html?.content).toMatch(/<link[^>]+href="\/assets\/[\w.-]+\.css\?v=testver"/)
  })

  test('CSS の url() に query が付く', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })
    const css = filesByExtension(files, '.css').map((file) => file.content).join('\n')

    expect(css).toMatch(/url\(\s*["']?\/assets\/[\w.-]+\.svg\?v=testver/)
  })

  test('チャンク間の import に query が付く', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })
    const js = filesByExtension(files, '.js').map((file) => file.content).join('\n')

    expect(js).toMatch(/from\s*["']\.\/[\w.-]+\.js\?v=testver["']/)
    expect(js).toMatch(/import\(["']\.\/[\w.-]+\.js\?v=testver["']\)/)
  })

  test('__vitePreload の依存配列に query が付く', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })
    const js = filesByExtension(files, '.js').map((file) => file.content).join('\n')

    expect(js).toMatch(/["']\/assets\/[\w.-]+\.css\?v=testver["']/)
  })

  test('query 未付与の参照が1件も残らない', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })

    expectAllReferencesBusted(files, query)
  })

  test('key: false なら裸のクエリになる', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver', key: false })
    const html = filesByExtension(files, '.html')[0]

    expect(html?.content).toMatch(/\.js\?testver"/)
    expectAllReferencesBusted(files, 'testver')
  })

  test('version 以外はビルド間で差分が出ない（書き換えが決定的）', async () => {
    const first = await buildFixture(basicRoot, { version: 'aaa' })
    const second = await buildFixture(basicRoot, { version: 'bbb' })

    expect(first.map((file) => file.fileName)).toEqual(second.map((file) => file.fileName))

    for (const [index, file] of first.entries()) {
      expect(file.content.replaceAll('v=aaa', 'v=QUERY'))
        .toBe(second[index]?.content.replaceAll('v=bbb', 'v=QUERY'))
    }
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bun run test -- --run tests/integration/basic.test.ts
```

Expected: FAIL。`Failed to resolve import "../../src"`。

- [ ] **Step 3: プラグイン本体を書く**

`src/index.ts`:

```ts
import { Ansis } from 'ansis'
import type { Plugin, ResolvedConfig, UserConfig } from 'vite'
import { version as viteVersion } from 'vite'
import { PLUGIN_NAME } from './constants'
import { decideFileNames, type FileNamesDecision } from './file-names'
import {
  apiDriftIssue,
  collectConfigIssues,
  hashedFileNamePatternIssue,
  hijackedRenderBuiltUrlIssue,
  manifestMissingIssue,
  multipleOutputsIssue,
  nonEsFormatIssue,
  parseMajor,
  unverifiableFileNamePatternIssue,
  userHookReturnedObjectIssue,
} from './guards'
import { createPalette, formatFindings, formatIssue, formatSummary } from './logger'
import { rewriteManifest } from './manifest'
import { normalizeOptions, type Options } from './options'
import { rewriteImports } from './rewrite-imports'
import { appendQuery, buildQuery, joinUrlSegments } from './url'
import { resolveVersion } from './version'
import { findMissingQuery, isTrackedName, type OutputFile } from './verify'

export type { Options, VerifyMode } from './options'

type RenderBuiltUrl = NonNullable<NonNullable<UserConfig['experimental']>['renderBuiltUrl']>

const DEFAULT_MANIFEST_FILE_NAME = '.vite/manifest.json'
const DEFAULT_ASSETS_DIR = 'assets'

export function queryCacheBusting(options: Options = {}): Plugin {
  const resolved = normalizeOptions(options)
  const palette = createPalette(new Ansis())

  let query = ''
  let config: ResolvedConfig
  let userRenderBuiltUrl: RenderBuiltUrl | undefined
  let fileNames: FileNamesDecision = { patch: {}, hashed: [], unverifiable: [] }
  let wrapperCalled = false
  let nonEsWarned = false

  const renderBuiltUrl: RenderBuiltUrl = (filename, context) => {
    wrapperCalled = true

    if (context.ssr) return userRenderBuiltUrl?.(filename, context)

    const fromUserHook = userRenderBuiltUrl?.(filename, context)
    if (typeof fromUserHook === 'object' && fromUserHook !== null) {
      throw new Error(formatIssue(palette, 'error', userHookReturnedObjectIssue()))
    }

    const url = typeof fromUserHook === 'string'
      ? fromUserHook
      : joinUrlSegments(config.base, filename)

    return appendQuery(url, query)
  }

  return {
    name: PLUGIN_NAME,
    apply: 'build',
    enforce: 'post',

    async config(userConfig) {
      userRenderBuiltUrl = userConfig.experimental?.renderBuiltUrl
      query = buildQuery(resolved.key, await resolveVersion(resolved.version))

      const userOutput = userConfig.build?.rollupOptions?.output
      if (Array.isArray(userOutput)) {
        throw new Error(formatIssue(palette, 'error', multipleOutputsIssue()))
      }

      fileNames = decideFileNames(
        (userOutput ?? {}) as Record<string, unknown>,
        userConfig.build?.assetsDir ?? DEFAULT_ASSETS_DIR,
      )

      return {
        build: { rollupOptions: { output: fileNames.patch } },
        experimental: { renderBuiltUrl },
      }
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig

      const { errors, warnings } = collectConfigIssues({
        base: resolvedConfig.base,
        isLib: Boolean(resolvedConfig.build.lib),
        chunkImportMap: Boolean((resolvedConfig.build as { chunkImportMap?: unknown }).chunkImportMap),
        viteMajor: parseMajor(viteVersion),
      })

      if (resolvedConfig.experimental.renderBuiltUrl !== renderBuiltUrl) {
        errors.push(hijackedRenderBuiltUrlIssue())
      }

      if (fileNames.hashed.length > 0) {
        errors.push(hashedFileNamePatternIssue(fileNames.hashed))
      }

      if (fileNames.unverifiable.length > 0) {
        warnings.push(unverifiableFileNamePatternIssue(fileNames.unverifiable))
      }

      for (const warning of warnings) {
        resolvedConfig.logger.warn(formatIssue(palette, 'warn', warning))
      }

      if (errors.length > 0) {
        throw new Error(errors.map((issue) => formatIssue(palette, 'error', issue)).join('\n\n'))
      }
    },

    renderChunk(code, chunk, outputOptions) {
      if (this.environment?.config.consumer === 'server') return null

      if (outputOptions.format !== 'es') {
        if (!nonEsWarned) {
          nonEsWarned = true
          config.logger.warn(formatIssue(palette, 'warn', nonEsFormatIssue(String(outputOptions.format))))
        }
        return null
      }

      const result = rewriteImports(code, query, chunk.fileName)
      if (result === null) return null

      return { code: result.code, map: result.map }
    },

    generateBundle(_outputOptions, bundle) {
      if (this.environment?.config.consumer === 'server') return

      const manifestOption = config.build.manifest
      const manifestFileName = typeof manifestOption === 'string' ? manifestOption : DEFAULT_MANIFEST_FILE_NAME

      const hasRenderableAssets = Object.values(bundle).some(
        (output) =>
          output.type === 'asset'
          && isTrackedName(output.fileName)
          && !output.fileName.endsWith('.json'),
      )

      if (!wrapperCalled && hasRenderableAssets) {
        throw new Error(formatIssue(palette, 'error', apiDriftIssue()))
      }

      if (manifestOption === true || typeof manifestOption === 'string') {
        const manifest = bundle[manifestFileName]
        if (manifest === undefined || manifest.type !== 'asset') {
          throw new Error(formatIssue(palette, 'error', manifestMissingIssue(manifestFileName)))
        }
        manifest.source = rewriteManifest(String(manifest.source), query)
      }

      const files: OutputFile[] = []
      const referenceNames: string[] = []

      for (const output of Object.values(bundle)) {
        if (output.fileName === manifestFileName) continue

        referenceNames.push(output.fileName)

        const content = output.type === 'chunk'
          ? output.code
          : typeof output.source === 'string' ? output.source : null

        if (content !== null) files.push({ fileName: output.fileName, content })
      }

      if (resolved.verify !== 'off') {
        const findings = findMissingQuery(files, referenceNames, query)

        if (findings.length > 0) {
          const level = resolved.verify === 'error' ? 'error' : 'warn'
          const message = formatFindings(palette, level, findings)

          if (level === 'error') throw new Error(message)
          config.logger.warn(message)
        }
      }

      config.logger.info(formatSummary(palette, query, countByExtension(files, query)))
    },
  }
}

export default queryCacheBusting

/** 出力ファイルごとに query の出現回数を拡張子別に数える */
function countByExtension(files: OutputFile[], query: string): Record<string, number> {
  const counts: Record<string, number> = {}
  const needle = `?${query}`

  for (const file of files) {
    const extension = file.fileName.slice(file.fileName.lastIndexOf('.') + 1)
    let occurrences = 0
    let index = file.content.indexOf(needle)

    while (index !== -1) {
      occurrences += 1
      index = file.content.indexOf(needle, index + 1)
    }

    if (occurrences > 0) counts[extension] = (counts[extension] ?? 0) + occurrences
  }

  return counts
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bun run test -- --run tests/integration/basic.test.ts
```

Expected: 7 件すべて PASS。

- [ ] **Step 5: 全テストと lint / format / 型チェックを通す**

```bash
bun run format && bun run test -- --run && bun run check
```

Expected: すべて PASS、lint 0 件、型エラーなし。

- [ ] **Step 6: コミット**

```bash
git add src/index.ts tests/helpers/build.ts tests/integration/basic.test.ts
git commit -m "feat: assemble the query cache busting vite plugin"
```

---

### Task 12: 残りの構成の結合テスト

**Files:**
- Create: `tests/fixtures/backend/src/main.ts`
- Create: `tests/fixtures/backend/src/lazy.ts`
- Create: `tests/fixtures/multi-entry/index.html`
- Create: `tests/fixtures/multi-entry/about.html`
- Create: `tests/fixtures/multi-entry/src/main.ts`
- Create: `tests/fixtures/multi-entry/src/about.ts`
- Create: `tests/fixtures/worker/index.html`
- Create: `tests/fixtures/worker/src/main.ts`
- Create: `tests/fixtures/worker/src/worker.ts`
- Create: `tests/integration/backend.test.ts`
- Create: `tests/integration/multi-entry.test.ts`
- Create: `tests/integration/worker.test.ts`
- Create: `tests/integration/unsupported.test.ts`

**Interfaces:**
- Consumes: `buildFixture` / `expectAllReferencesBusted` / `filesByExtension`（Task 11）

- [ ] **Step 1: backend fixture とテストを書く**

`tests/fixtures/backend/src/main.ts`:

```ts
export async function boot(): Promise<string> {
  const { lazyValue } = await import('./lazy')
  return lazyValue
}
```

`tests/fixtures/backend/src/lazy.ts`:

```ts
export const lazyValue = 'backend-lazy'
```

`tests/integration/backend.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { buildFixture, expectAllReferencesBusted } from '../helpers/build'

const backendRoot = fileURLToPath(new URL('../fixtures/backend', import.meta.url))

const backendOverrides = {
  build: {
    manifest: true,
    rollupOptions: { input: fileURLToPath(new URL('../fixtures/backend/src/main.ts', import.meta.url)) },
  },
}

describe('backend fixture（HTML 無し・manifest あり）', () => {
  test('manifest の file に query が付く', async () => {
    const files = await buildFixture(backendRoot, { version: 'testver' }, backendOverrides)
    const manifest = files.find((file) => file.fileName.endsWith('manifest.json'))

    expect(manifest).toBeDefined()

    const parsed = JSON.parse(manifest?.content ?? '{}') as Record<string, { file?: string }>
    const entry = Object.values(parsed)[0]

    expect(entry?.file).toMatch(/\.js\?v=testver$/)
  })

  test('manifest の imports はキーのままで書き換えない', async () => {
    const files = await buildFixture(backendRoot, { version: 'testver' }, backendOverrides)
    const manifest = files.find((file) => file.fileName.endsWith('manifest.json'))
    const parsed = JSON.parse(manifest?.content ?? '{}') as Record<string, { imports?: string[] }>

    for (const entry of Object.values(parsed)) {
      for (const importKey of entry.imports ?? []) {
        expect(importKey).not.toContain('?v=')
      }
    }
  })

  test('query 未付与の参照が1件も残らない', async () => {
    const files = await buildFixture(backendRoot, { version: 'testver' }, backendOverrides)

    expectAllReferencesBusted(files, 'v=testver')
  })
})
```

- [ ] **Step 2: backend テストを実行する**

```bash
bun run test -- --run tests/integration/backend.test.ts
```

Expected: 3 件すべて PASS。

**FAIL した場合**: `manifestMissingIssue` のエラーが出るなら、Vite の manifest プラグインがこのプラグインより後に `generateBundle` を実行しているということ。その場合は `generateBundle` ではなく `writeBundle` の直前に相当するフック順序を再検討し、報告する。

- [ ] **Step 3: multi-entry fixture とテストを書く**

`tests/fixtures/multi-entry/index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>home</title>
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`tests/fixtures/multi-entry/about.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>about</title>
  </head>
  <body>
    <script type="module" src="/src/about.ts"></script>
  </body>
</html>
```

`tests/fixtures/multi-entry/src/main.ts`:

```ts
export const page = 'home'
```

`tests/fixtures/multi-entry/src/about.ts`:

```ts
export const page = 'about'
```

`tests/integration/multi-entry.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { buildFixture, expectAllReferencesBusted, filesByExtension } from '../helpers/build'

const root = fileURLToPath(new URL('../fixtures/multi-entry', import.meta.url))

const multiEntryOverrides = {
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('../fixtures/multi-entry/index.html', import.meta.url)),
        about: fileURLToPath(new URL('../fixtures/multi-entry/about.html', import.meta.url)),
      },
    },
  },
}

describe('multi-entry fixture', () => {
  test('すべての HTML の script に query が付く', async () => {
    const files = await buildFixture(root, { version: 'testver' }, multiEntryOverrides)
    const htmlFiles = filesByExtension(files, '.html')

    expect(htmlFiles).toHaveLength(2)

    for (const html of htmlFiles) {
      expect(html.content).toMatch(/<script[^>]+src="\/assets\/[\w.-]+\.js\?v=testver"/)
    }
  })

  test('query 未付与の参照が1件も残らない', async () => {
    const files = await buildFixture(root, { version: 'testver' }, multiEntryOverrides)

    expectAllReferencesBusted(files, 'v=testver')
  })
})
```

- [ ] **Step 4: worker fixture とテストを書く**

`tests/fixtures/worker/index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>worker</title>
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`tests/fixtures/worker/src/main.ts`:

```ts
export const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
```

`tests/fixtures/worker/src/worker.ts`:

```ts
self.addEventListener('message', () => {
  self.postMessage('pong')
})
```

`tests/integration/worker.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { buildFixture, expectAllReferencesBusted, filesByExtension } from '../helpers/build'

const root = fileURLToPath(new URL('../fixtures/worker', import.meta.url))

describe('worker fixture', () => {
  test('worker の URL に query が付く', async () => {
    const files = await buildFixture(root, { version: 'testver' })
    const js = filesByExtension(files, '.js').map((file) => file.content).join('\n')

    expect(js).toMatch(/["']\/assets\/[\w.-]+\.js\?v=testver["']/)
  })

  test('query 未付与の参照が1件も残らない', async () => {
    const files = await buildFixture(root, { version: 'testver' })

    expectAllReferencesBusted(files, 'v=testver')
  })
})
```

- [ ] **Step 5: 非対応構成のテストを書く**

`tests/integration/unsupported.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { describe, expect, test } from 'vitest'
import { buildFixture, expectAllReferencesBusted } from '../helpers/build'

const basicRoot = fileURLToPath(new URL('../fixtures/basic', import.meta.url))

describe('非対応構成', () => {
  test('相対 base はビルドを落とす', async () => {
    await expect(buildFixture(basicRoot, { version: 'testver' }, { base: './' }))
      .rejects.toThrow(/相対 base/)
  })

  test('ライブラリモードはビルドを落とす', async () => {
    await expect(
      buildFixture(basicRoot, { version: 'testver' }, {
        build: {
          lib: {
            entry: fileURLToPath(new URL('../fixtures/basic/src/shared.ts', import.meta.url)),
            formats: ['es'],
          },
        },
      }),
    ).rejects.toThrow(/build\.lib/)
  })

  test('renderBuiltUrl を上書きするプラグインがあればビルドを落とす', async () => {
    const hijacker: Plugin = {
      name: 'hijacker',
      enforce: 'post',
      config() {
        return { experimental: { renderBuiltUrl: () => undefined } }
      },
    }

    await expect(buildFixture(basicRoot, { version: 'testver' }, { plugins: [hijacker] }))
      .rejects.toThrow(/renderBuiltUrl/)
  })

  test('key に "=" を含めるとエラー', async () => {
    // buildFixture は async なので、同期 throw も rejected promise として届く
    await expect(buildFixture(basicRoot, { key: 'a=b' })).rejects.toThrow(/key/)
  })

  test('利用者が [hash] 付きのファイル名パターンを指定するとビルドを落とす', async () => {
    await expect(
      buildFixture(basicRoot, { version: 'testver' }, {
        build: { rollupOptions: { output: { entryFileNames: 'assets/[name]-[hash].js' } } },
      }),
    ).rejects.toThrow(/\[hash\]/)
  })

  test('利用者が [hash] 無しのパターンを指定した場合は尊重する', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' }, {
      build: { rollupOptions: { output: { entryFileNames: 'js/[name].js' } } },
    })

    expect(files.some((file) => file.fileName === 'js/index.js')).toBe(true)
    expectAllReferencesBusted(files, 'v=testver')
  })

  test('output が配列ならビルドを落とす', async () => {
    await expect(
      buildFixture(basicRoot, { version: 'testver' }, {
        build: { rollupOptions: { output: [{ entryFileNames: 'assets/[name].js' }] } },
      }),
    ).rejects.toThrow(/output/)
  })
})
```

- [ ] **Step 6: 全テストを実行する**

```bash
bun run test -- --run
```

Expected: すべて PASS。

**「renderBuiltUrl を上書きするプラグイン」のテストが FAIL する場合**: プラグインの並び順によっては `hijacker` の `config` が先に走り、こちらのラッパーが後勝ちになる。その場合は `hijacker` を `plugins` 配列の後ろに置く（`mergeConfig` はプラグイン配列を連結するため、`overrides.plugins` は既定のプラグインより後になる）ことを確認し、それでも上書きされないなら期待値をこのプラグインが勝つ挙動に合わせて修正する。

- [ ] **Step 7: コミット**

```bash
git add tests/fixtures tests/integration
git commit -m "test: cover backend, multi-entry, worker and unsupported configurations"
```

---

### Task 13: README とビルドの確認

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README を書く**

`README.md` の全体を以下で置き換える。

````markdown
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

| オプション | 型 | デフォルト | 説明 |
|---|---|---|---|
| `version` | `string \| (() => string \| undefined \| Promise<string \| undefined>)` | ローカル時刻の `YYYYMMDDHHmm` | query に載せる値。関数が `undefined` か空文字を返した場合はデフォルトに戻る |
| `key` | `string \| false` | `'v'` | query のキー。`false` で `?202607302209` の裸クエリ |
| `verify` | `'warn' \| 'error' \| 'off'` | `'warn'` | 出力に query 未付与の参照が残っていないかの自己検証 |

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
- ファイル名にハッシュが無いため、同じ `[name]` を持つチャンクが複数あると名前が衝突します。Rolldown が連番を付けて回避しますが、その連番はビルドごとに安定するとは限りません
- 同一パスへ上書きデプロイするため、古い HTML を保持しているクライアントは
  `?v=<旧version>` を要求しても新しい中身のファイルを受け取ります。これはクエリ方式に
  内在する性質で、このプラグインでは解決できません

## License

MIT
````

- [ ] **Step 2: ビルドが通ることを確認する**

```bash
bun run build
```

Expected: `dist/index.mjs` と型定義が生成され、エラーなし。

- [ ] **Step 3: 全テストと lint / format / 型チェックを通す**

```bash
bun run format && bun run test -- --run && bun run check
```

Expected: すべて PASS、lint 0 件、型エラーなし。

- [ ] **Step 4: コミット**

```bash
git add README.md
git commit -m "docs: document usage, options and limitations"
```

---

## 完了条件

- `bun run test -- --run` が全件 PASS
- `bun run check`（oxlint + oxfmt --check + tsc --noEmit）がエラーなし
- `bun run build` が成功し `dist/` が生成される
- `tests/integration/*.test.ts` の全 fixture で「query 未付与の参照が 0 件」が成立する
