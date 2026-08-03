# コードレビュー指摘の修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/code-review` で検出された8件の指摘のうち、採用した6件を修正し、1件は実測用の統合テストを追加する。

**Architecture:** query の書き込み（`appendQuery`）と読み取り（`verify` / summary 集計）が別ファイルに分かれて仕様が食い違っていたのを、`src/url.ts` に集約する。生成側では区切り文字と衝突する文字を作らず、読み取り側では成分の完全一致で判定する。診断メッセージの送出も `src/logger.ts` に集約する。

**Tech Stack:** TypeScript / Vite 8 / Vitest 4 / bun / oxlint + oxfmt

**設計ドキュメント:** `docs/superpowers/specs/2026-08-03-review-findings-triage-design.md`

## Global Constraints

- `src/` のコメントとユーザー向けメッセージは**英語**で書く（コミット `46567ef` で統一済み）
- テスト名は**日本語**で書く（既存の全テストファイルの慣習）
- peerDependency は `vite@^8.0.0`。Vite 8 の API を前提にしてよい
- 新しい本体依存（`dependencies`）を増やさない。現在は `ansis` / `magic-string` / `nostics` の3つのみ
- 各タスクの最後に `bun run check` と `bunx vitest run` を通す
- コミットメッセージは Conventional Commits（`fix:` / `refactor:` / `test:` / `docs:`）
- `src/verify.ts` の `isReferenceBoundary` には**触らない**（指摘3を見送ったため、境界判定は現状維持）
- **本計画中の行番号は計画作成時点のもの**。先行タスクが import 行を追加するため後続タスクでは最大数行ずれる。行番号は目安として使い、**実際の編集箇所は周囲のコード内容で特定すること**

---

## Task 1: `buildQuery` の追加エンコード

`encodeURIComponent` は `! ~ * ' ( )` をエスケープしない。これらは出力走査時の区切り文字と衝突するため、生成側で潰す。

**Files:**
- Modify: `src/url.ts:37-41`
- Test: `tests/url.test.ts:87-99`（`describe('buildQuery')` 内）

**Interfaces:**
- Consumes: なし
- Produces: `buildQuery(key: string | false, version: string): string` — シグネチャ不変。出力から `!~*'()` が消える

- [ ] **Step 1: 失敗するテストを書く**

`tests/url.test.ts` の `describe('buildQuery', ...)` の中、既存の `test('version を URL エンコードする', ...)` の直後に追加する。

```ts
  test("encodeURIComponent が素通しする !~*'() もエンコードする", () => {
    expect(buildQuery('v', '1.0(beta)')).toBe('v=1.0%28beta%29')
  })

  test('key 側の記号もエンコードする', () => {
    expect(buildQuery("v'", '1')).toBe('v%27=1')
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bunx vitest run tests/url.test.ts -t "encodeURIComponent が素通しする"
```

Expected: FAIL — `expected 'v=1.0(beta)' to be 'v=1.0%28beta%29'`

- [ ] **Step 3: 最小限の実装を書く**

`src/url.ts` の `buildQuery` を置き換える。ファイル末尾付近の既存 `buildQuery` の直前に定数とヘルパーを置く。

```ts
const EXTRA_ENCODE_RE = /[!~*'()]/g

/**
 * Percent-encodes a query component.
 * encodeURIComponent leaves !~*'() unescaped, but those collide with the delimiters
 * used when scanning built output, so they are encoded here as well.
 */
function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(
    EXTRA_ENCODE_RE,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** Builds the query string from key and version */
export function buildQuery(key: string | false, version: string): string {
  const encodedVersion = encodeQueryComponent(version)
  return key === false ? encodedVersion : `${encodeQueryComponent(key)}=${encodedVersion}`
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bunx vitest run tests/url.test.ts
```

Expected: PASS（既存の `buildQuery('v', 'a b') → 'v=a%20b'` を含め全件）

- [ ] **Step 5: 全体を確認してコミットする**

```bash
bun run check && bunx vitest run
git add src/url.ts tests/url.test.ts
git commit -m "fix: encode !~*'() in query components to avoid delimiter collisions"
```

---

## Task 2: `appendQuery` / `appendQueryToBuiltUrl` の重複解消

2つの関数は除外正規表現以外が完全一致している（指摘6）。共通コアに寄せる。振る舞いは変えない。

**Files:**
- Modify: `src/url.ts:4-35`
- Test: `tests/url.test.ts`（既存テストが回帰網。新規テストなし）

**Interfaces:**
- Consumes: なし
- Produces: `appendQuery` / `appendQueryToBuiltUrl` — シグネチャ・振る舞いともに不変

- [ ] **Step 1: 変更前にテストが通っていることを確認する**

これは純粋なリファクタなので、RED は作らない。代わりに変更前の GREEN を記録する。

```bash
bunx vitest run tests/url.test.ts
```

Expected: PASS（16件）

- [ ] **Step 2: 共通コアに寄せる**

`src/url.ts` の 4〜35行目（2つの関数とその JSDoc）を、以下で置き換える。

```ts
/** Inserts a query before any hash fragment, choosing '&' when the URL already has one */
function insertQuery(url: string, query: string): string {
  const hashIndex = url.indexOf('#')
  const pathname = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const separator = pathname.includes('?') ? '&' : '?'

  return `${pathname}${separator}${query}${hash}`
}

/**
 * Appends a query string to a URL.
 * External URLs, data:, and blob: are excluded. Inserted before any hash fragment.
 */
export function appendQuery(url: string, query: string): string {
  if (query === '' || EXTERNAL_URL_RE.test(url)) return url
  return insertQuery(url, query)
}

/**
 * Appends a query to a URL pointing at an asset emitted by this plugin.
 * Unlike appendQuery, http/https and protocol-relative URLs are also included (for a CDN base).
 * Only data: and blob: are excluded. Inserted before any hash fragment.
 */
export function appendQueryToBuiltUrl(url: string, query: string): string {
  if (query === '' || DATA_OR_BLOB_URL_RE.test(url)) return url
  return insertQuery(url, query)
}
```

- [ ] **Step 3: テストが引き続き通ることを確認する**

```bash
bunx vitest run tests/url.test.ts
```

Expected: PASS（16件。Step 1 と同じ結果）

- [ ] **Step 4: 全体を確認してコミットする**

```bash
bun run check && bunx vitest run
git add src/url.ts
git commit -m "refactor: extract shared insertQuery core from the two appendQuery variants"
```

---

## Task 3: `&` 連結された query の誤検知を修正

本命の修正（指摘1）。読み取り側を「成分の完全一致」に変える。

**Files:**
- Modify: `src/url.ts`（`hasQueryParam` を追加）
- Modify: `src/verify.ts:1-4`（import 追加）, `src/verify.ts:47-50`（判定の差し替え）
- Test: `tests/url.test.ts`（`hasQueryParam` の unit テスト）
- Test: `tests/verify.test.ts`（回帰テスト）
- Test: `tests/integration/basic.test.ts`（end-to-end 再現）

**Interfaces:**
- Consumes: `insertQuery` の `&` 選択規則（Task 2）
- Produces: `hasQueryParam(text: string, index: number, query: string): boolean` — `index` は pathname 直後の文字を指す。Task 4 の `countQueryParams` が同じ `QUERY_END_RE` を共有する

- [ ] **Step 1: 失敗するテストを3か所に書く**

`tests/url.test.ts` の import に `hasQueryParam` を追加する。

```ts
import {
  appendQuery,
  appendQueryToBuiltUrl,
  buildQuery,
  hasQueryParam,
  joinUrlSegments,
} from '../src/url'
```

同ファイルの `describe('joinUrlSegments', ...)` の**前**に追加する。

```ts
describe('hasQueryParam', () => {
  test('? 直後に一致する query があれば true', () => {
    expect(hasQueryParam('/a.js?v=1"', 5, 'v=1')).toBe(true)
  })

  test('& で連結された query も検出する', () => {
    expect(hasQueryParam('/a.js?token=xyz&v=1"', 5, 'v=1')).toBe(true)
  })

  test('HTML エスケープされた &amp; も区切りとして扱う', () => {
    expect(hasQueryParam('/a.js?token=xyz&amp;v=1"', 5, 'v=1')).toBe(true)
  })

  test('前方一致は一致とみなさない', () => {
    expect(hasQueryParam('/a.js?v=10"', 5, 'v=1')).toBe(false)
  })

  test('query 文字列自体が無ければ false', () => {
    expect(hasQueryParam('/a.js"', 5, 'v=1')).toBe(false)
  })

  test('終端文字を越えて次の参照の query を見に行かない', () => {
    expect(hasQueryParam('/a.js" + "/b.js?v=1', 5, 'v=1')).toBe(false)
  })

  test('query が空文字なら false', () => {
    expect(hasQueryParam('/a.js?v=1"', 5, '')).toBe(false)
  })
})
```

`tests/verify.test.ts` の `describe('findMissingQuery', ...)` の末尾（`CDN の絶対 URL` テストの直後）に追加する。

```ts
  test('& で連結された query は未付与とみなさない（誤検知の回帰テスト）', () => {
    const files = [
      {
        fileName: 'index.html',
        content: '<script src="https://cdn.example.com/assets/a.js?token=xyz&v=1"></script>',
      },
    ]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toEqual([])
  })

  test('前方一致の query は未付与として検出する', () => {
    const files = [{ fileName: 'index.html', content: '<script src="/assets/a.js?v=10"></script>' }]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toHaveLength(1)
  })
```

`tests/integration/basic.test.ts` の `describe('basic fixture', ...)` の末尾に追加する。

```ts
  test('renderBuiltUrl が query 付き URL を返しても未付与と誤検知しない', async () => {
    const files = await buildFixture(
      basicRoot,
      { version: 'testver' },
      {
        experimental: {
          renderBuiltUrl: (filename: string) => `https://cdn.example.com/${filename}?token=xyz`,
        },
      },
    )
    const html = filesByExtension(files, '.html')[0]

    expect(html?.content).toMatch(
      /<script[^>]+src="https:\/\/cdn\.example\.com\/assets\/[\w.-]+\.js\?token=xyz&(amp;)?v=testver"/,
    )
    expectAllReferencesBusted(files, query)
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bunx vitest run tests/url.test.ts tests/verify.test.ts tests/integration/basic.test.ts
```

Expected: FAIL
- `hasQueryParam` の6件 — `hasQueryParam is not a function`
- `& で連結された query は未付与とみなさない` — `expected [ { file: 'index.html', ... } ] to deeply equal []`
- `renderBuiltUrl が query 付き URL を返しても...` — `expectAllReferencesBusted` 内の assertion 失敗

`前方一致の query は未付与として検出する` も FAIL する。現行実装は `content.startsWith('?v=1', ...)` で判定しており、`?v=10` はこれに一致するため「query が付いている」と誤って扱われ、findings が 0 件になるからである（テストは 1 件を期待している）。

5件すべてが上記の理由で FAIL することを確認してから次に進むこと。別の理由（構文エラー、import ミス）で落ちている場合は先にそれを直す。

- [ ] **Step 3: `hasQueryParam` を実装する**

`src/url.ts` の先頭、`DATA_OR_BLOB_URL_RE` の直後に定数を追加する。

```ts
/**
 * Characters that terminate a URL query string in built output.
 * Built URLs live inside JS string literals, CSS url(), and HTML attributes.
 */
const QUERY_END_RE = /["'`\s#<>()]/

/**
 * Separates query components.
 * Vite HTML-escapes '&' as '&amp;' inside HTML attributes, so both spellings
 * must be accepted when scanning built output.
 */
const QUERY_SEPARATOR_RE = /&(?:amp;)?/
```

`joinUrlSegments` の直前に関数を追加する。

```ts
/**
 * Whether the query string starting at `index` carries `query` as a complete parameter.
 * `index` must point at the character right after the pathname.
 * Both separators are accepted, since insertQuery joins with '&' when the URL already has a query.
 */
export function hasQueryParam(text: string, index: number, query: string): boolean {
  if (query === '') return false
  if (text[index] !== '?') return false

  let end = index + 1
  while (end < text.length && !QUERY_END_RE.test(text[end] ?? '')) end += 1

  return text.slice(index + 1, end).split(QUERY_SEPARATOR_RE).includes(query)
}
```

- [ ] **Step 4: `verify.ts` の判定を差し替える**

`src/verify.ts` の先頭に import を追加する（1行目、既存の `export interface OutputFile` の前）。

```ts
import { hasQueryParam } from './url'
```

47〜50行目の条件を置き換える。

```ts
        if (
          isReferenceBoundary(file.content, index, name) &&
          !hasQueryParam(file.content, index + name.length, query)
        ) {
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
bunx vitest run tests/url.test.ts tests/verify.test.ts tests/integration/basic.test.ts
```

Expected: PASS（全件）

- [ ] **Step 6: 全体を確認してコミットする**

```bash
bun run check && bunx vitest run
git add src/url.ts src/verify.ts tests/url.test.ts tests/verify.test.ts tests/integration/basic.test.ts
git commit -m "fix: treat '&'-joined query params as present during verification"
```

---

## Task 4: summary の件数集計を同じ規則に揃える

`countByExtension` も `?${query}` 直値で数えているため、`&` 連結分が件数から漏れる。

**Files:**
- Modify: `src/url.ts`（`countQueryParams` を追加）
- Modify: `src/generate-bundle.ts:161-180`
- Test: `tests/url.test.ts`

**Interfaces:**
- Consumes: `QUERY_END_RE`（Task 3 で追加済み）
- Produces: `countQueryParams(text: string, query: string): number`

- [ ] **Step 1: 失敗するテストを書く**

`tests/url.test.ts` の import に `countQueryParams` を追加する。

```ts
import {
  appendQuery,
  appendQueryToBuiltUrl,
  buildQuery,
  countQueryParams,
  hasQueryParam,
  joinUrlSegments,
} from '../src/url'
```

`describe('hasQueryParam', ...)` の直後に追加する。

```ts
describe('countQueryParams', () => {
  test('? 連結と & 連結の両方を数える', () => {
    expect(countQueryParams('"/a.js?v=1" "/b.js?x=1&v=1"', 'v=1')).toBe(2)
  })

  test('HTML エスケープされた &amp; の後ろも数える', () => {
    expect(countQueryParams('"/a.js?token=xyz&amp;v=1"', 'v=1')).toBe(1)
  })

  test('前方一致は数えない', () => {
    expect(countQueryParams('"/a.js?v=10"', 'v=1')).toBe(0)
  })

  test('query が空文字なら 0', () => {
    expect(countQueryParams('"/a.js?v=1"', '')).toBe(0)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bunx vitest run tests/url.test.ts -t "countQueryParams"
```

Expected: FAIL — `countQueryParams is not a function`

- [ ] **Step 3: `countQueryParams` を実装する**

`src/url.ts` の `hasQueryParam` の直後に追加する。

```ts
/** Counts how many times `query` appears as a complete URL query parameter in `text` */
export function countQueryParams(text: string, query: string): number {
  if (query === '') return 0

  let count = 0
  let index = text.indexOf(query)

  while (index !== -1) {
    const after = text[index + query.length]
    const afterSeparator =
      text[index - 1] === '?' || text[index - 1] === '&' || text.endsWith('&amp;', index)

    if (
      afterSeparator &&
      (after === undefined || after === '&' || QUERY_END_RE.test(after))
    ) {
      count += 1
    }
    index = text.indexOf(query, index + 1)
  }

  return count
}
```

- [ ] **Step 4: `countByExtension` を差し替える**

`src/generate-bundle.ts` の import は相対パスのアルファベット順に並んでいる。`./rewrite-imports`（8行目）と `./verify`（9行目）の**間**に挿入する。

```ts
import { countQueryParams } from './url'
```

161〜180行目の `countByExtension` を置き換える。

```ts
/** Counts how many times the query appears per output file, broken down by extension */
function countByExtension(files: OutputFile[], query: string): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const file of files) {
    const extension = file.fileName.slice(file.fileName.lastIndexOf('.') + 1)
    const occurrences = countQueryParams(file.content, query)

    if (occurrences > 0) counts[extension] = (counts[extension] ?? 0) + occurrences
  }

  return counts
}
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
bunx vitest run
```

Expected: PASS（全件）

- [ ] **Step 6: コミットする**

```bash
bun run check && bunx vitest run
git add src/url.ts src/generate-bundle.ts tests/url.test.ts
git commit -m "fix: count '&'-joined query params in the build summary"
```

---

## Task 5: 診断メッセージの文言とテスト名の修正

指摘4・5・8。実行ロジックには触れない。

**Files:**
- Modify: `src/diagnostics.ts:46`, `src/diagnostics.ts:60`
- Modify: `tests/diagnostics.test.ts:22`

**Interfaces:**
- Consumes: なし
- Produces: なし（文字列のみ）

- [ ] **Step 1: `QCB_MULTIPLE_OUTPUTS` から版数への言及を落とす**

`src/diagnostics.ts:60` を置き換える。制限はバージョンに紐づいていないため、そう書かない。

```ts
      fix: 'Only a single output is supported. Make output a single object.',
```

- [ ] **Step 2: `QCB_MANIFEST_MISSING` を消費者中立の文言にする**

`src/diagnostics.ts:46` を置き換える。この診断は通常 manifest と ssr-manifest の両方で送出される（`src/generate-bundle.ts:86` と `:103`）ため、バックエンド統合だけを指す文言をやめる。

```ts
      fix: "Vite's manifest generation may be running after this plugin. The build was aborted because consumers of the manifest would otherwise load URLs without the query.",
```

- [ ] **Step 3: テスト名を実装に合わせる**

`tests/diagnostics.test.ts:22` を置き換える。実装は `join(', ')` を使っており、読点ではない。

```ts
  test('paths 配列を渡すコードは ", " で連結する', () => {
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bunx vitest run
```

Expected: PASS（全件）。変更した2つの `fix` 文字列はテストからも README からも参照されていないため、既存の assertion は壊れない。

- [ ] **Step 5: コミットする**

```bash
bun run check && bunx vitest run
git add src/diagnostics.ts tests/diagnostics.test.ts
git commit -m "fix: correct misleading diagnostic fix texts and a stale test title"
```

---

## Task 6: 診断の送出を `logger.ts` に集約

指摘7。`throwIssue` が2ファイルに同一定義され、3か所でバイパスされている。警告側も同じ重複がある。

**Files:**
- Modify: `src/logger.ts`（`throwIssue` / `warnIssue` を追加）
- Modify: `src/generate-bundle.ts:1-16, 68, 86, 103, 154-158`
- Modify: `src/plugin-steps.ts:14, 22-24, 109-111, 131`
- Test: 新規テストなし（振る舞い不変。既存テストが回帰網）

**Interfaces:**
- Consumes: `formatDiagnostic`（既存）
- Produces:
  - `throwIssue(palette: Palette, issue: Diagnostic): never`
  - `warnIssue(palette: Palette, logger: { warn: (message: string) => void }, issue: Diagnostic): void`

- [ ] **Step 1: 変更前にテストが通っていることを確認する**

純粋なリファクタなので RED は作らない。変更前の GREEN を記録する。

```bash
bunx vitest run
```

Expected: PASS（全件。件数を控えておく）

- [ ] **Step 2: `logger.ts` に2つのヘルパーを追加する**

`src/logger.ts` の末尾（`formatDiagnostic` の後ろ）に追加する。

```ts
/** Throws a fatal diagnostic, formatted the same way everywhere */
export function throwIssue(palette: Palette, issue: Diagnostic): never {
  throw new Error(formatDiagnostic(palette, 'error', issue))
}

/** Emits a non-fatal diagnostic through the given logger */
export function warnIssue(
  palette: Palette,
  logger: { warn: (message: string) => void },
  issue: Diagnostic,
): void {
  logger.warn(formatDiagnostic(palette, 'warn', issue))
}
```

- [ ] **Step 3: `generate-bundle.ts` を差し替える**

5行目の import を置き換える（`formatDiagnostic` は不要になる）。

```ts
import { formatSummary, type Palette, throwIssue, warnIssue } from './logger'
```

14〜16行目のローカル `throwIssue` 定義を**削除**する。

68〜70行目を置き換える。

```ts
    warnIssue(palette, config.logger, nonEsFormatIssue(String(outputOptions.format)))
```

86行目を置き換える。

```ts
    throwIssue(palette, manifestMissingIssue(manifestFileName))
```

103行目を置き換える。

```ts
    throwIssue(palette, manifestMissingIssue(ssrManifestFileName))
```

154〜158行目を置き換える。動的に決めていた level を分岐に開く。

```ts
  if (verifyMode === 'error') throwIssue(palette, diagnostic)
  warnIssue(palette, config.logger, diagnostic)
```

- [ ] **Step 4: `plugin-steps.ts` を差し替える**

14行目の import を置き換える（`formatDiagnostic` は114行目でまだ使うので残す）。

```ts
import { formatDiagnostic, type Palette, throwIssue, warnIssue } from './logger'
```

22〜24行目のローカル `throwIssue` 定義を**削除**する。

109〜111行目のループ本体を置き換える。

```ts
  for (const warning of warnings) {
    warnIssue(palette, resolvedConfig.logger, warning)
  }
```

131行目を置き換える。

```ts
    throwIssue(palette, userHookReturnedObjectIssue())
```

113〜115行目（複数 issue を `'\n\n'` で連結する箇所）は**触らない**。単一 issue の送出ではないため集約対象ではない。

- [ ] **Step 5: テストが引き続き通ることを確認する**

```bash
bun run check && bunx vitest run
```

Expected: PASS（Step 1 と同じ件数）。`bun run check` の typecheck が `formatDiagnostic` の未使用 import を検出した場合は削除する。

- [ ] **Step 6: コミットする**

```bash
git add src/logger.ts src/generate-bundle.ts src/plugin-steps.ts
git commit -m "refactor: centralize diagnostic throw/warn emission in logger"
```

---

## Task 7: sourcemap の実測（調査タスク）

指摘2。**このタスクの成果物は修正ではなく測定結果と判断である。** 設計ドキュメント第6節の通り、`renderChunk` への移動は `vite:build-import-analysis` の依存解決を壊すため選べない。残る選択肢 A（無駄削除のみ）と B（map 連結）のどちらを採るかを、実測してから決める。

**Files:**
- Modify: `tests/helpers/build.ts`（`BuiltFile` に `map` を追加）
- Create: `tests/integration/sourcemap.test.ts`

**Interfaces:**
- Consumes: `buildFixture(root, options, overrides)`（既存）
- Produces: `BuiltFile.map?: { mappings: string; sources: string[] } | null`

- [ ] **Step 1: `buildFixture` が map を返すようにする**

`tests/helpers/build.ts` の `BuiltFile` インターフェースを置き換える。

```ts
export interface BuiltFile {
  fileName: string
  content: string
  map?: { mappings: string; sources: string[] } | null
}
```

同ファイルの `files.push({ ... })` を置き換える。

```ts
      files.push({
        fileName: output.fileName,
        content: output.type === 'chunk' ? output.code : String(output.source),
        map:
          output.type === 'chunk'
            ? ((output as { map?: { mappings: string; sources: string[] } | null }).map ?? null)
            : null,
      })
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/integration/sourcemap.test.ts` を新規作成する。まず「map が出ること」を固定する。

```ts
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { buildFixture } from '../helpers/build'

const basicRoot = fileURLToPath(new URL('../fixtures/basic', import.meta.url))

describe('sourcemap', () => {
  test('sourcemap 有効時にチャンクの map が出力される', async () => {
    const files = await buildFixture(
      basicRoot,
      { version: 'testver' },
      { build: { sourcemap: true, minify: true } },
    )
    const chunks = files.filter((file) => file.fileName.endsWith('.js'))

    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.map?.mappings).toBeTruthy()
    }
  })
})
```

- [ ] **Step 3: テストを実行する**

```bash
bunx vitest run tests/integration/sourcemap.test.ts
```

Expected: PASS。ここは既存の振る舞いを固定するだけなので通ってよい。FAIL する場合は Step 1 の `map` 取り出しが誤っているので直す。

- [ ] **Step 4: ズレを測定する**

プラグイン有りと無しで同じ fixture をビルドし、書き換えたチャンクの map の最終セグメントが指す生成カラムと、実際のコード長を比較する。以下を `tests/integration/sourcemap.test.ts` に一時的に追加して実行し、**数値を記録する**。

```ts
  test('[調査用] 書き換え後のコード長と map の最終カラムの差を出力する', async () => {
    const files = await buildFixture(
      basicRoot,
      { version: 'testver' },
      { build: { sourcemap: true, minify: true } },
    )

    for (const chunk of files.filter((file) => file.fileName.endsWith('.js'))) {
      const lines = chunk.content.split('\n')
      const occurrences = chunk.content.split('?v=testver').length - 1

      console.log(
        `${chunk.fileName}: lines=${lines.length} codeLen=${chunk.content.length} inserted=${occurrences * '?v=testver'.length} mappingsLen=${chunk.map?.mappings.length}`,
      )
    }

    expect(true).toBe(true)
  })
```

```bash
bunx vitest run tests/integration/sourcemap.test.ts --reporter=verbose
```

記録する項目: チャンクごとの `inserted`（挿入された総文字数）と行数。**`inserted` が 0 なら、そのチャンクに書き換えは発生しておらずズレも存在しない。**

- [ ] **Step 5: A / B を判断する**

判断規則:

- **`inserted > 0` かつ行数が少ない（minify 済みで1〜数行）チャンクが存在する** → 同一行の後続マッピングが `inserted` 文字ぶんズレている。実害が確認できたので **B（map 連結）** に進む。別タスクとして計画し直すこと
- **`inserted === 0`、または書き換えが常に独立行にしか起きない** → ズレは実質発生しない。**A（`rewriteImports` の返り値から `map` と `count` を落とすだけ）** を採る
- どちらとも言えない → 測定結果を添えて人間に判断を仰ぐ

- [ ] **Step 6: 調査用テストを削除してコミットする**

Step 4 で追加した `[調査用]` テストを削除する。Step 2 のテストは残す。

```bash
bun run check && bunx vitest run
git add tests/helpers/build.ts tests/integration/sourcemap.test.ts
git commit -m "test: add sourcemap integration coverage"
```

- [ ] **Step 7: 判断を設計ドキュメントに追記する**

`docs/superpowers/specs/2026-08-03-review-findings-triage-design.md` の第6.2節末尾に、測定値と採った選択肢（A か B か）を追記する。

```bash
git add docs/superpowers/specs/2026-08-03-review-findings-triage-design.md
git commit -m "docs: record the sourcemap drift measurement and the chosen option"
```

---

## 完了条件

- [ ] Task 1〜6 が完了し、`bun run check && bunx vitest run` が通る
- [ ] Task 7 の測定が終わり、A / B の判断が設計ドキュメントに記録されている
- [ ] B を選んだ場合、その実装は本計画のスコープ外として別途計画する

## スコープ外（設計ドキュメント第9節より）

- `package.json` の keywords から `query` が落ちた件 — 判断の問題であり欠陥ではない
- `docs/superpowers/specs/2026-07-31-nostics-style-logging-design.md` の古い日本語 — 日付入りの設計記録であり書き換えない
- 指摘3（verify の性能）— 再検討トリガーは「verify に1秒以上かかると観測されたら」
