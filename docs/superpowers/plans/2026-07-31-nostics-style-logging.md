# nostics スタイルのログ表示への移行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vite-plugin-query-cache-busting` のエラー・警告ログを、[nostics](https://nostics.dev)（v1.2.0、ランタイム依存ゼロ）が採用している「`[CODE] message` + `├▶`/`╰▶` ツリー」というスタイルに移行する。

**Architecture:** `nostics` の `defineDiagnostics`（診断カタログ定義）と `Diagnostic` クラス（データ構造）だけを採用し、レポーター機構・標準フォーマッタ・`docsBase` は使わない。既存の `Issue { title, details, hints }` を `Diagnostic { name, message, fix, sources }` に置き換え、出力ルーティング（`throw new Error(...)` / `config.logger.warn(...)`）は今のまま自前で行う。

**Tech Stack:** TypeScript / `nostics`（新規依存）/ 既存の `ansis` / vitest / bun

**設計ドキュメント:** [docs/superpowers/specs/2026-07-31-nostics-style-logging-design.md](../specs/2026-07-31-nostics-style-logging-design.md)

## Global Constraints

これらは全タスクの要件に暗黙に含まれる。

- ランタイム依存は `ansis`・`magic-string`・`nostics` の3つだけ（本移行で `nostics` を追加する）
- `nostics` の**レポーター**（`createConsoleReporter`）・**標準フォーマッタ**（`formatDiagnostic`/`ansiFormatter`）・`docsBase`・`defineProdDiagnostics` は使わない。出力ルーティングは自前の `config.logger.warn(...)` / `throw new Error(...)` のまま
- 診断コードは `QCB_` プレフィックス＋人間が読める名前。命名は今回で確定させ、将来変えない前提とする
- 診断のブラケットは `[QCB_XXX]` のみ（`[query-cache-busting]` を付けない）。成功時サマリ（`formatSummary`）だけは今までどおり `[query-cache-busting]` を使う（診断ではないため）
- `why`/`fix` の本文・`sources` の値は無色。色は `[CODE]`・`error`/`warn` の単語・ツリー枝（`├▶`/`╰▶`）・`fix:`/`sources:` ラベルにのみ乗せる
- `src/options.ts` の `normalizeOptions` が投げるオプション検証エラー（`option "version"` 等）は**このスコープ外**。今までどおり `LOG_PREFIX` を使った素の `Error` のまま変更しない
- ログ・エラーメッセージは日本語のまま
- TDD。各タスクは「失敗するテストを書く → 失敗を確認 → 最小実装 → 成功を確認 → コミット」の順で進める
- コミットメッセージは Conventional Commits（`feat:` / `test:` / `chore:` / `docs:` / `refactor:`）
- 各タスクのコミット直前に `bun run format` と `bun run lint` を実行し、両方通してからコミットする。`bun run check` で lint + format:check + typecheck をまとめて実行できる
- コードスタイル: セミコロン無し・シングルクォート・インデント2スペース・行幅 100・末尾カンマあり・import 自動ソート（`bun run format` が整形する。プラン中のコード例の見た目と多少ずれても正常）
- `.oxlintrc.json` は変更しない。既存の override（`src/index.ts` の `max-dependencies`/`prefer-type-error` 無効化、`tests/**` の `require-await`/`no-useless-undefined`/`max-lines-per-function` 無効化）はそのまま有効

---

### Task 1: `nostics` の導入と診断カタログの定義

`nostics` を依存に追加し、既存13個の `Issue` ファクトリ + verify の取りこぼし検出、計14個の診断コードを1つのカタログにまとめる。このタスクはカタログが正しく動く（コンパイルでき、パラメータが型付けされ、`sources` が呼び出し時に反映される）ことだけを検証する。まだ `guards.ts`/`logger.ts` は書き換えない。

**Files:**
- Modify: `package.json`
- Create: `src/diagnostics.ts`
- Test: `tests/diagnostics.test.ts`

**Interfaces:**
- Produces: `diagnostics`（`nostics` の `defineDiagnostics` が返すオブジェクト）。14個のキー（`QCB_RELATIVE_BASE` / `QCB_LIB_MODE` / `QCB_CHUNK_IMPORT_MAP` / `QCB_VITE_TOO_OLD` / `QCB_VITE_UNVERIFIED` / `QCB_RENDER_BUILT_URL_HIJACKED` / `QCB_RENDER_BUILT_URL_OBJECT` / `QCB_API_DRIFT` / `QCB_NON_ES_FORMAT` / `QCB_MANIFEST_MISSING` / `QCB_HASHED_FILENAME_PATTERN` / `QCB_UNVERIFIABLE_FILENAME_PATTERN` / `QCB_MULTIPLE_OUTPUTS` / `QCB_MISSING_QUERY`）を持つ

- [ ] **Step 1: `nostics` を依存に追加する**

```bash
bun add nostics@^1.2.0
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/diagnostics.test.ts`:

```ts
import { describe, expect, test } from 'vitest'

import { diagnostics } from '../src/diagnostics'

describe('diagnostics', () => {
  test('静的な why/fix を持つコードは引数無しで呼べる', () => {
    const diagnostic = diagnostics.QCB_LIB_MODE()

    expect(diagnostic.name).toBe('QCB_LIB_MODE')
    expect(diagnostic.message).toBe(
      'ライブラリモード（build.lib）には対応していません: build.lib が設定されています',
    )
    expect(diagnostic.fix).toBe(
      '配布物の import 指定子に query が付くと、利用側のバンドラや Node のモジュール解決が壊れるためです。ライブラリのビルドでは plugins からこのプラグインを外してください。',
    )
  })

  test('関数の why はパラメータを埋め込む', () => {
    const diagnostic = diagnostics.QCB_VITE_TOO_OLD({ viteMajor: 7 })

    expect(diagnostic.message).toBe('Vite 8 以上が必要です（検出: 7）')
  })

  test('paths 配列を渡すコードは読点で連結する', () => {
    const diagnostic = diagnostics.QCB_HASHED_FILENAME_PATTERN({
      paths: [
        'build.rollupOptions.output.entryFileNames',
        'worker.rolldownOptions.output.chunkFileNames',
      ],
    })

    expect(diagnostic.message).toBe(
      '出力ファイル名パターンに [hash] が含まれています: build.rollupOptions.output.entryFileNames、worker.rolldownOptions.output.chunkFileNames',
    )
  })

  test('sources を呼び出し時に渡すと Diagnostic に反映される', () => {
    const diagnostic = diagnostics.QCB_MISSING_QUERY({
      count: 2,
      sources: ['assets/index.js:1:2043', 'assets/manifest.json:1:88'],
    })

    expect(diagnostic.message).toBe('query 未付与の参照が 2 件あります')
    expect(diagnostic.sources).toEqual(['assets/index.js:1:2043', 'assets/manifest.json:1:88'])
  })

  test('docsBase を設定していないので docs は undefined', () => {
    expect(diagnostics.QCB_LIB_MODE().docs).toBeUndefined()
  })
})
```

- [ ] **Step 3: テストが失敗することを確認する**

```bash
bun run test -- --run tests/diagnostics.test.ts
```

Expected: FAIL。`Failed to resolve import "../src/diagnostics"`。

- [ ] **Step 4: `src/diagnostics.ts` を書く**

```ts
import { defineDiagnostics } from 'nostics'

export const diagnostics = defineDiagnostics({
  codes: {
    QCB_RELATIVE_BASE: {
      why: (p: { base: string }) =>
        `相対 base には対応していません: base: ${JSON.stringify(p.base)}`,
      fix: "相対 base では Vite が JS 内の URL を実行時計算に切り替えるため、query を静的に付与できません。絶対パス（例: base: '/'）を指定してください。",
    },
    QCB_LIB_MODE: {
      why: 'ライブラリモード（build.lib）には対応していません: build.lib が設定されています',
      fix: '配布物の import 指定子に query が付くと、利用側のバンドラや Node のモジュール解決が壊れるためです。ライブラリのビルドでは plugins からこのプラグインを外してください。',
    },
    QCB_CHUNK_IMPORT_MAP: {
      why: 'build.chunkImportMap と併用できません: build.chunkImportMap が有効になっています',
      fix: 'Vite 自身が build.chunkImportMap と experimental.renderBuiltUrl の併用を非対応としています。どちらか一方を無効にしてください。',
    },
    QCB_VITE_TOO_OLD: {
      why: (p: { viteMajor: number }) => `Vite 8 以上が必要です（検出: ${p.viteMajor}）`,
      fix: 'experimental.renderBuiltUrl と parseAst の前提が Vite 8 未満では揃いません。Vite 8 以上にアップグレードしてください。',
    },
    QCB_VITE_UNVERIFIED: {
      why: (p: { viteMajor: number }) => `Vite ${p.viteMajor} は未検証です`,
      fix: 'このプラグインは Vite 8 でのみ検証されています。ビルド後に verify の警告が出ていないか確認してください。',
    },
    QCB_RENDER_BUILT_URL_HIJACKED: {
      why: 'experimental.renderBuiltUrl が別のプラグインに上書きされています: 解決後の設定値がこのプラグインのラッパーではありません',
      fix: 'renderBuiltUrl は1つしか設定できないため、このままではキャッシュバスティングが無言で無効になります。競合するプラグインを外すか、順序を調整してください。',
    },
    QCB_RENDER_BUILT_URL_OBJECT: {
      why: '既存の renderBuiltUrl がオブジェクトを返しました: { relative } / { runtime } の戻り値には対応していません',
      fix: '実行時計算になるため query を静的に付与できません。既存の renderBuiltUrl が文字列を返すようにしてください。',
    },
    QCB_API_DRIFT: {
      why: 'renderBuiltUrl がビルド中に一度も呼ばれませんでした: アセット・CSS・HTML が出力されているのにフックが呼ばれていません',
      fix: 'Vite 側の experimental.renderBuiltUrl の仕様が変わった可能性があります。このプラグインのバージョンと Vite のバージョンの組み合わせを確認してください。',
    },
    QCB_NON_ES_FORMAT: {
      why: (p: { format: string }) =>
        `ES 形式以外の出力ではチャンク間 import を書き換えられません: output.format: ${p.format}`,
      fix: 'SystemJS などの形式では import 指定子が AST の import ノードとして現れないためです。アセット・CSS・HTML への query 付与は引き続き行われます。',
    },
    QCB_MANIFEST_MISSING: {
      why: (p: { manifestFileName: string }) =>
        `manifest を書き換えられませんでした: 出力に ${p.manifestFileName} が見つかりません`,
      fix: 'Vite の manifest 生成がこのプラグインより後で行われた可能性があります。このままではバックエンド統合時に query が付かないため、ビルドを中断しました。',
    },
    QCB_HASHED_FILENAME_PATTERN: {
      why: (p: { paths: string[] }) =>
        `出力ファイル名パターンに [hash] が含まれています: ${p.paths.join('、')}`,
      fix: 'ファイル名ハッシュと query の二重掛けになり、このプラグインを使う意味がなくなります。パターンから [hash] を外してください。',
    },
    QCB_UNVERIFIABLE_FILENAME_PATTERN: {
      why: (p: { paths: string[] }) =>
        `出力ファイル名パターンが関数で指定されているため検証できません: ${p.paths.join('、')}`,
      fix: '関数が [hash] を含む名前を返さないか、静的に判定できません。ビルド後に出力ファイル名にハッシュが付いていないか確認してください。',
    },
    QCB_MULTIPLE_OUTPUTS: {
      why: 'build.rollupOptions.output が配列（複数出力）の構成には対応していません: output が配列で指定されています',
      fix: 'v1 では単一出力のみ対応しています。output を単一のオブジェクトにしてください。',
    },
    QCB_MISSING_QUERY: {
      why: (p: { count: number }) => `query 未付与の参照が ${p.count} 件あります`,
      fix: "ソース中に文字列でハードコードされたパスの可能性があります。意図的な場合は verify: 'off' で抑制できます。",
    },
  },
})
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
bun run test -- --run tests/diagnostics.test.ts
```

Expected: 5件すべて PASS。

- [ ] **Step 6: 型チェックが通ることを確認する**

`nostics` の型解決（`moduleResolution: bundler` での `.mjs` → `.d.mts` サイドカー解決）を確認する。

```bash
bun run typecheck
```

Expected: エラーなし。

- [ ] **Step 7: コミット**

```bash
git add package.json bun.lock src/diagnostics.ts tests/diagnostics.test.ts
git commit -m "feat: define the nostics diagnostic catalog"
```

---

### Task 2: `src/guards.ts` を `Diagnostic` を返す形に書き換える

既存13個の `xxxIssue()` 関数は同じ名前・同じシグネチャのまま、返す型を `Issue` から `nostics` の `Diagnostic` に変える。`collectConfigIssues` の構造は変えない。

**Files:**
- Modify: `src/guards.ts`
- Modify: `tests/guards.test.ts`

**Interfaces:**
- Consumes: `diagnostics`（Task 1、`src/diagnostics.ts`）
- Produces: `parseMajor(version: string): number`（変更なし）、`ConfigSnapshot`（変更なし）、`collectConfigIssues(snapshot): { errors: Diagnostic[], warnings: Diagnostic[] }`、および `hijackedRenderBuiltUrlIssue()` / `userHookReturnedObjectIssue()` / `apiDriftIssue()` / `nonEsFormatIssue(format)` / `manifestMissingIssue(manifestFileName)` / `hashedFileNamePatternIssue(paths)` / `unverifiableFileNamePatternIssue(paths)` / `multipleOutputsIssue()` — いずれも `Diagnostic` を返す

- [ ] **Step 1: 失敗するテストを書く**

`tests/guards.test.ts` の全体を以下に置き換える。

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
    expect(errors[0]?.message).toMatch(/相対 base/)
    expect(errors[0]?.message).toMatch(/\.\//)
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
    expect(errors[0]?.message).toMatch(/build\.lib/)
  })

  test('chunkImportMap が有効ならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, chunkImportMap: true })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/chunkImportMap/)
  })

  test('Vite 7 以下ならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, viteMajor: 7 })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/Vite 8/)
  })

  test('Vite 9 以上なら警告', () => {
    const { errors, warnings } = collectConfigIssues({ ...supported, viteMajor: 9 })

    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toMatch(/未検証/)
  })

  test('複数の非対応構成をまとめて返す', () => {
    expect(
      collectConfigIssues({ base: './', isLib: true, chunkImportMap: true, viteMajor: 8 }).errors,
    ).toHaveLength(3)
  })
})

describe('個別の Diagnostic', () => {
  test('どの Diagnostic も message と fix を持つ', () => {
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
      expect(issue.message.length).toBeGreaterThan(0)
      expect(issue.fix?.length ?? 0).toBeGreaterThan(0)
    }
  })

  test('nonEsFormatIssue は形式名を含む', () => {
    expect(nonEsFormatIssue('system').message).toMatch(/system/)
  })

  test('manifestMissingIssue はファイル名を含む', () => {
    expect(manifestMissingIssue('.vite/manifest.json').message).toMatch(/manifest\.json/)
  })

  test('hashedFileNamePatternIssue は渡した文字列をそのまま message に含める（前置しない）', () => {
    const issue = hashedFileNamePatternIssue([
      'build.rollupOptions.output.entryFileNames',
      'worker.rolldownOptions.output.chunkFileNames',
    ])

    expect(issue.message).toContain('build.rollupOptions.output.entryFileNames')
    expect(issue.message).toContain('worker.rolldownOptions.output.chunkFileNames')
  })

  test('unverifiableFileNamePatternIssue は渡した文字列をそのまま message に含める（前置しない）', () => {
    expect(
      unverifiableFileNamePatternIssue(['worker.rollupOptions.output.assetFileNames']).message,
    ).toContain('worker.rollupOptions.output.assetFileNames')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bun run test -- --run tests/guards.test.ts
```

Expected: FAIL。`errors[0]?.message` が `undefined`（現行の `Issue` は `title`/`details`/`hints` しか持たない）。

- [ ] **Step 3: `src/guards.ts` を書き換える**

全体を以下に置き換える。

```ts
import type { Diagnostic } from 'nostics'

import { diagnostics } from './diagnostics'

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

function relativeBaseIssue(base: string): Diagnostic | undefined {
  if (base !== '' && !base.startsWith('.')) return undefined
  return diagnostics.QCB_RELATIVE_BASE({ base })
}

function libModeIssue(isLib: boolean): Diagnostic | undefined {
  if (!isLib) return undefined
  return diagnostics.QCB_LIB_MODE()
}

function chunkImportMapIssue(chunkImportMap: boolean): Diagnostic | undefined {
  if (!chunkImportMap) return undefined
  return diagnostics.QCB_CHUNK_IMPORT_MAP()
}

function unsupportedViteMajorIssue(viteMajor: number): Diagnostic | undefined {
  if (viteMajor >= 8) return undefined
  return diagnostics.QCB_VITE_TOO_OLD({ viteMajor })
}

function unverifiedViteMajorIssue(viteMajor: number): Diagnostic | undefined {
  if (viteMajor <= 8) return undefined
  return diagnostics.QCB_VITE_UNVERIFIED({ viteMajor })
}

export function collectConfigIssues(snapshot: ConfigSnapshot): {
  errors: Diagnostic[]
  warnings: Diagnostic[]
} {
  const errors = [
    relativeBaseIssue(snapshot.base),
    libModeIssue(snapshot.isLib),
    chunkImportMapIssue(snapshot.chunkImportMap),
    unsupportedViteMajorIssue(snapshot.viteMajor),
  ].filter((issue): issue is Diagnostic => issue !== undefined)

  const warnings = [unverifiedViteMajorIssue(snapshot.viteMajor)].filter(
    (issue): issue is Diagnostic => issue !== undefined,
  )

  return { errors, warnings }
}

export function hijackedRenderBuiltUrlIssue(): Diagnostic {
  return diagnostics.QCB_RENDER_BUILT_URL_HIJACKED()
}

export function userHookReturnedObjectIssue(): Diagnostic {
  return diagnostics.QCB_RENDER_BUILT_URL_OBJECT()
}

export function apiDriftIssue(): Diagnostic {
  return diagnostics.QCB_API_DRIFT()
}

export function nonEsFormatIssue(format: string): Diagnostic {
  return diagnostics.QCB_NON_ES_FORMAT({ format })
}

export function manifestMissingIssue(manifestFileName: string): Diagnostic {
  return diagnostics.QCB_MANIFEST_MISSING({ manifestFileName })
}

export function hashedFileNamePatternIssue(paths: string[]): Diagnostic {
  return diagnostics.QCB_HASHED_FILENAME_PATTERN({ paths })
}

export function unverifiableFileNamePatternIssue(paths: string[]): Diagnostic {
  return diagnostics.QCB_UNVERIFIABLE_FILENAME_PATTERN({ paths })
}

export function multipleOutputsIssue(): Diagnostic {
  return diagnostics.QCB_MULTIPLE_OUTPUTS()
}
```

`Issue` インターフェースは削除する（誰も import しなくなるため）。

- [ ] **Step 4: テストが通ることを確認する**

```bash
bun run test -- --run tests/guards.test.ts
```

Expected: 14件すべて PASS。

- [ ] **Step 5: 全体の型チェックを確認する**

この時点で `src/logger.ts`（Task 3 未着手）はまだ `Issue`/`Finding` を import しており型エラーが出る想定。**このタスクではまだ `bun run typecheck` を実行しない。** Task 3〜5 が終わるまで型エラーが残るのは正常。

- [ ] **Step 6: コミット**

```bash
git add src/guards.ts tests/guards.test.ts
git commit -m "refactor: return nostics diagnostics from guards"
```

---

### Task 3: `src/logger.ts` を `formatDiagnostic` に統合する

`formatIssue`/`formatFindings` の2関数を `formatDiagnostic(palette, level, diagnostic)` という1関数に統合する。`formatSummary`/`createPalette`/`Palette` は変更しない（`Palette.bad` は削除）。

**Files:**
- Modify: `src/logger.ts`
- Modify: `tests/logger.test.ts`

**Interfaces:**
- Consumes: `nostics` の `Diagnostic` 型（`src/diagnostics.ts` を経由せず `nostics` から直接 import。`src/guards.ts` には依存しない）
- Produces: `formatDiagnostic(palette: Palette, level: IssueLevel, diagnostic: Diagnostic): string`。`Palette` から `bad` フィールドが無くなる

- [ ] **Step 1: 失敗するテストを書く**

`tests/logger.test.ts` の全体を以下に置き換える。

```ts
import { Ansis } from 'ansis'
import { Diagnostic } from 'nostics'
import { describe, expect, test } from 'vitest'

import { createPalette, formatDiagnostic, formatSummary } from '../src/logger'

// 色レベルを 0 に固定して、色コードではなくメッセージの中身を検証する
const plain = createPalette(new Ansis(0))

describe('formatSummary', () => {
  test('付与件数と内訳を1行で返す', () => {
    expect(formatSummary(plain, 'v=202607302209', { js: 8, css: 3, html: 3 })).toBe(
      '[query-cache-busting] ?v=202607302209 を 14 件の参照に付与 (js 8, css 3, html 3)',
    )
  })

  test('内訳が空なら括弧を出さない', () => {
    expect(formatSummary(plain, 'v=1', {})).toBe('[query-cache-busting] ?v=1 を 0 件の参照に付与')
  })

  test('件数 0 の拡張子は内訳に出さない', () => {
    expect(formatSummary(plain, 'v=1', { js: 2, css: 0 })).toBe(
      '[query-cache-busting] ?v=1 を 2 件の参照に付与 (js 2)',
    )
  })
})

describe('formatDiagnostic', () => {
  test('fix があれば1行のツリーで表示する', () => {
    const diagnostic = new Diagnostic({
      code: 'QCB_RELATIVE_BASE',
      why: '相対 base には対応していません: base: "./"',
      fix: '絶対パスを指定してください。',
    })

    const message = formatDiagnostic(plain, 'error', diagnostic)

    expect(message).toBe(
      [
        '[QCB_RELATIVE_BASE] error  相対 base には対応していません: base: "./"',
        '╰▶ fix: 絶対パスを指定してください。',
      ].join('\n'),
    )
  })

  test('fix も sources も無ければ見出しだけを返す', () => {
    const diagnostic = new Diagnostic({ code: 'QCB_TEST', why: 'タイトル' })

    expect(formatDiagnostic(plain, 'warn', diagnostic)).toBe('[QCB_TEST] warn  タイトル')
  })

  test('fix と複数の sources をツリーで表示する', () => {
    const diagnostic = new Diagnostic({
      code: 'QCB_MISSING_QUERY',
      why: 'query 未付与の参照が 2 件あります',
      fix: "ソース中に文字列でハードコードされたパスの可能性があります。意図的な場合は verify: 'off' で抑制できます。",
      sources: ['assets/index.js:1:2043', 'assets/manifest.json:1:88'],
    })

    const message = formatDiagnostic(plain, 'warn', diagnostic)

    expect(message).toBe(
      [
        '[QCB_MISSING_QUERY] warn  query 未付与の参照が 2 件あります',
        "├▶ fix: ソース中に文字列でハードコードされたパスの可能性があります。意図的な場合は verify: 'off' で抑制できます。",
        '├▶ sources: assets/index.js:1:2043',
        '╰▶ sources: assets/manifest.json:1:88',
      ].join('\n'),
    )
  })
})

describe('createPalette', () => {
  test('色レベル 1 なら ANSI コードが付く', () => {
    const colored = createPalette(new Ansis(1))

    expect(colored.path('x')).not.toBe('x')
    expect(colored.path('x')).toContain('x')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
bun run test -- --run tests/logger.test.ts
```

Expected: FAIL。`Failed to resolve import` または `formatDiagnostic is not a function`（まだ定義していないため）。

- [ ] **Step 3: `src/logger.ts` を書き換える**

全体を以下に置き換える。

```ts
import { Ansis } from 'ansis'
import type { Diagnostic } from 'nostics'

import { LOG_PREFIX } from './constants'

export type IssueLevel = 'warn' | 'error'

export interface Palette {
  prefix: (text: string) => string
  label: (level: IssueLevel, text: string) => string
  path: (text: string) => string
  query: (text: string) => string
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
    count: (text) => ansis.bold(text),
    hint: (text) => ansis.dim(text),
  }
}

export function formatSummary(
  palette: Palette,
  query: string,
  counts: Record<string, number>,
): string {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const breakdown = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([extension, count]) => `${extension} ${count}`)
    .join(', ')

  const head = `${palette.prefix(LOG_PREFIX)} ${palette.query(`?${query}`)} を ${palette.count(String(total))} 件の参照に付与`

  return breakdown === '' ? head : `${head} (${breakdown})`
}

/**
 * 診断を [CODE] level  message の見出し + fix/sources のツリー表示に整形する。
 * nostics の formatDiagnostic/ansiFormatter と同じレイアウト（├▶/╰▶ 接続）を踏襲するが、
 * severity（error/warn）の文字表記と色分けを自前で加えている。
 */
export function formatDiagnostic(
  palette: Palette,
  level: IssueLevel,
  diagnostic: Diagnostic,
): string {
  const header = `${palette.path(`[${diagnostic.name}]`)} ${palette.label(level, level)}  ${diagnostic.message}`

  const details: string[] = []
  if (diagnostic.fix !== undefined) details.push(`${palette.hint('fix:')} ${diagnostic.fix}`)
  if (diagnostic.sources !== undefined) {
    for (const source of diagnostic.sources) details.push(`${palette.hint('sources:')} ${source}`)
  }

  if (details.length === 0) return header

  return [
    header,
    ...details.map(
      (detail, index) => `${palette.hint(index < details.length - 1 ? '├▶' : '╰▶')} ${detail}`,
    ),
  ].join('\n')
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bun run test -- --run tests/logger.test.ts
```

Expected: 7件すべて PASS。

- [ ] **Step 5: コミット**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "refactor: format diagnostics with a code-and-tree layout"
```

---

### Task 4: `src/verify.ts` からスニペット・キャレット計算を削除する

`Finding` を `{ file, line, column, reference }` に縮小する。境界判定ロジック（`isReferenceBoundary`）は変更しない。

**Files:**
- Modify: `src/verify.ts`
- Modify: `tests/verify.test.ts`

**Interfaces:**
- Produces: `Finding { file: string, line: number, column: number, reference: string }`（`snippet`/`caretOffset` を削除）。`findMissingQuery(files, referenceNames, query): Finding[]` のシグネチャは変わらない

- [ ] **Step 1: テストを書き換える（スニペット・キャレットの検証を外す）**

`tests/verify.test.ts` の全体を以下に置き換える（元の18件から「スニペットとキャレット位置を返す」の1件だけを外した17件）。

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

  test('assetsDir: "" によるコメント行内の偶然の一致は検出しない', () => {
    const files = [
      {
        fileName: 'assets/index.js',
        content: '//#region tests/fixtures/basic/src/logo.svg\nconsole.log(1)',
      },
    ]
    expect(findMissingQuery(files, ['logo.svg'], 'v=1')).toEqual([])
  })

  test('引き続き検出する: <script src="...">', () => {
    const files = [{ fileName: 'index.html', content: '<script src="/assets/a.js"></script>' }]
    expect(findMissingQuery(files, ['assets/a.js'], 'v=1')).toHaveLength(1)
  })

  test('引き続き検出する: url(...) （( が区切り）', () => {
    const files = [{ fileName: 'assets/a.css', content: '.x{background:url(/assets/logo.svg)}' }]
    expect(findMissingQuery(files, ['assets/logo.svg'], 'v=1')).toHaveLength(1)
  })

  test('引き続き検出する: 配列リテラル内の文字列（" が区切り）', () => {
    const files = [{ fileName: 'assets/a.js', content: 'm.f=["/assets/lazy.js"]' }]
    expect(findMissingQuery(files, ['assets/lazy.js'], 'v=1')).toHaveLength(1)
  })

  test('CDN の絶対 URL（コロンを含む）を検出する（検出漏れの回帰テスト）', () => {
    const files = [
      {
        fileName: 'index.html',
        content: '<script src="https://cdn.example.com/assets/index.js"></script>',
      },
    ]
    expect(findMissingQuery(files, ['assets/index.js'], 'v=1')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 実装を変える前に、書き換えたテストが全件通ることを確認する**

現時点では `src/verify.ts` はまだ変更していない（`Finding` は `snippet`/`caretOffset` を含んだまま）。書き換えたテストが `snippet`/`caretOffset` を検証していないことを確認するため、まずこの状態のまま実行する。

```bash
bun run test -- --run tests/verify.test.ts
```

Expected: 17件すべて PASS（実装をまだ変えていないので落ちるテストは無い）。

- [ ] **Step 3: `src/verify.ts` から不要な計算を削除する**

全体を以下に置き換える。

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
}

const SCANNED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.css', '.html']
const NAME_CHAR_RE = /[A-Za-z0-9_.-]/
const PATH_CHAR_RE = /[A-Za-z0-9_.:/-]/
const URL_DELIMITER_RE = /["'`(=]/

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
  const names = referenceNames.filter((name) => isTrackedName(name))

  for (const file of files) {
    if (!isScannableFile(file.fileName)) continue

    for (const name of names) {
      let index = file.content.indexOf(name)

      while (index !== -1) {
        if (
          isReferenceBoundary(file.content, index, name) &&
          !file.content.startsWith(`?${query}`, index + name.length)
        ) {
          findings.push(createFinding(file.fileName, file.content, index, name))
        }
        index = file.content.indexOf(name, index + 1)
      }
    }
  }

  return findings
}

/**
 * 前後がファイル名の一部でないこと（より長いファイル名の一部への一致を弾く）。
 * 4段の判定をすべて満たした場合のみ参照とみなす。
 * 1. 直前が名前構成文字でないこと（"xassets/a.js" のような、より長い識別子の末尾への
 *    偶然の一致を弾く）
 * 2. 直後が名前構成文字でないこと（a.js.map のような、より長いファイル名の一部への
 *    一致を弾く）
 * 3. 一致位置から後ろ向きにパス構成文字（コロン・スラッシュを含む。CDN の絶対 URL
 *    "https://..." を辿りきれるようにするため）を辿る
 * 4. 辿り終えた手前の文字が URL を開く区切り文字（" ' ` ( =）であること。
 *    空白は区切り文字に含めない（コメント内のパスを弾くため）。ファイル先頭に
 *    達した場合は区切り文字が無いので参照とみなさない。
 */
function isReferenceBoundary(content: string, index: number, name: string): boolean {
  if (index > 0 && NAME_CHAR_RE.test(content[index - 1] ?? '')) return false

  const afterIndex = index + name.length
  if (afterIndex < content.length && NAME_CHAR_RE.test(content[afterIndex] ?? '')) return false

  let start = index
  while (start > 0 && PATH_CHAR_RE.test(content[start - 1] ?? '')) start -= 1

  if (start === 0) return false

  return URL_DELIMITER_RE.test(content[start - 1] ?? '')
}

function createFinding(
  fileName: string,
  content: string,
  index: number,
  reference: string,
): Finding {
  const before = content.slice(0, index)
  const line = before.split('\n').length
  const lineStart = before.lastIndexOf('\n') + 1
  const column = index - lineStart + 1

  return { file: fileName, line, column, reference }
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
bun run test -- --run tests/verify.test.ts
```

Expected: 17件すべて PASS。

- [ ] **Step 5: コミット**

```bash
git add src/verify.ts tests/verify.test.ts
git commit -m "refactor: drop unused snippet and caret computation from verify"
```

---

### Task 5: `plugin-steps.ts` / `generate-bundle.ts` の呼び出し側を配線し直す

`formatIssue`/`formatFindings` への参照を `formatDiagnostic` に差し替える。verify の取りこぼし検出は `diagnostics.QCB_MISSING_QUERY({ count, sources })` を直接呼ぶように変える（`guards.ts` を経由しない — 元々 `generate-bundle.ts` が自前で `formatFindings` を呼んでいた構造を踏襲する）。

**Files:**
- Modify: `src/plugin-steps.ts`
- Modify: `src/generate-bundle.ts`

**Interfaces:**
- Consumes: Task 1〜4 のすべて（`diagnostics`、`Diagnostic` を返す `guards.ts` の関数群、`formatDiagnostic`、縮小された `Finding`）
- Produces: 変更なし（`decideOutputFileNames` / `applyResolvedConfigIssues` / `resolveBuiltUrl` / `resolveManifestTarget` / `detectApiDrift` / `rewriteChunkImports` / `rewriteManifestOutput` / `rewriteSsrManifestOutput` / `collectOutputFiles` / `verifyOutput` / `logSummary` / `runGenerateBundleStep` の名前・シグネチャは一切変えない）

このタスクには新規の単体テストは無い。**既存の統合テスト（`tests/integration/*.test.ts`）が変更無しで通ることがこのタスクの検証**になる（`bun run typecheck` がここまでの4タスクで崩れていた型エラーを解消する最終タスクでもある）。

- [ ] **Step 1: `src/plugin-steps.ts` を書き換える**

全体を以下に置き換える（`formatIssue` → `formatDiagnostic` への差し替えのみ。ロジックは変えない）。

```ts
import type { ResolvedConfig, UserConfig } from 'vite'
import { version as viteVersion } from 'vite'

import { decideFileNames, type FileNamesDecision, type OutputFileNames } from './file-names'
import {
  collectConfigIssues,
  hashedFileNamePatternIssue,
  hijackedRenderBuiltUrlIssue,
  multipleOutputsIssue,
  parseMajor,
  unverifiableFileNamePatternIssue,
  userHookReturnedObjectIssue,
} from './guards'
import { formatDiagnostic, type Palette } from './logger'
import { appendQueryToBuiltUrl, joinUrlSegments } from './url'

export type RenderBuiltUrl = NonNullable<NonNullable<UserConfig['experimental']>['renderBuiltUrl']>
type RenderBuiltUrlContext = Parameters<RenderBuiltUrl>[1]

const DEFAULT_ASSETS_DIR = 'assets'

function throwIssue(palette: Palette, issue: Parameters<typeof formatDiagnostic>[2]): never {
  throw new Error(formatDiagnostic(palette, 'error', issue))
}

export type WorkerOutputKey = 'rollupOptions' | 'rolldownOptions'

/** config フックが返す environments.client/worker のパッチと、あとで使う fileNames・workerFileNames をまとめて決める */
export function decideOutputFileNames(
  palette: Palette,
  userConfig: UserConfig,
): {
  fileNames: FileNamesDecision
  workerFileNames: FileNamesDecision
  workerKey: WorkerOutputKey
  environments: { client: { build: { rollupOptions: { output: Partial<OutputFileNames> } } } }
  worker: Partial<Record<WorkerOutputKey, { output: Partial<OutputFileNames> }>>
} {
  const assetsDir = userConfig.build?.assetsDir ?? DEFAULT_ASSETS_DIR
  // SSR はこのプラグインの対象外。build.rollupOptions.output を無条件でパッチすると
  // environments.client を継承しない SSR ビルドまで巻き込むため、client 環境だけに書く。
  const output =
    userConfig.environments?.client?.build?.rollupOptions?.output ??
    userConfig.build?.rollupOptions?.output
  const rolldownOutput = userConfig.worker?.rolldownOptions?.output
  const rollupOutput = userConfig.worker?.rollupOptions?.output

  // output を持っているのが deprecated な rollupOptions だけなら、そちらに書き戻す
  const workerKey: WorkerOutputKey =
    rolldownOutput === undefined && rollupOutput !== undefined
      ? 'rollupOptions'
      : 'rolldownOptions'
  const workerOut = rolldownOutput ?? rollupOutput

  if (Array.isArray(output) || Array.isArray(workerOut)) throwIssue(palette, multipleOutputsIssue())

  const fileNames = decideFileNames((output ?? {}) as Record<string, unknown>, assetsDir)
  const workerFileNames = decideFileNames((workerOut ?? {}) as Record<string, unknown>, assetsDir)

  return {
    fileNames,
    workerFileNames,
    workerKey,
    environments: { client: { build: { rollupOptions: { output: fileNames.patch } } } },
    worker: { [workerKey]: { output: workerFileNames.patch } },
  }
}

/** 主ビルドと worker の出力ファイル名パターンの問題キーに、実際の設定パスを前置する */
function toConfigPaths(
  fileNames: FileNamesDecision,
  workerFileNames: FileNamesDecision,
  workerKey: WorkerOutputKey,
): { hashed: string[]; unverifiable: string[] } {
  const hashed = [
    ...fileNames.hashed.map((key) => `build.rollupOptions.output.${key}`),
    ...workerFileNames.hashed.map((key) => `worker.${workerKey}.output.${key}`),
  ]
  const unverifiable = [
    ...fileNames.unverifiable.map((key) => `build.rollupOptions.output.${key}`),
    ...workerFileNames.unverifiable.map((key) => `worker.${workerKey}.output.${key}`),
  ]
  return { hashed, unverifiable }
}

/** configResolved 時点の設定値から問題を集め、警告ログと例外に変換する */
export function applyResolvedConfigIssues(
  palette: Palette,
  resolvedConfig: ResolvedConfig,
  renderBuiltUrl: RenderBuiltUrl,
  fileNames: FileNamesDecision,
  workerFileNames: FileNamesDecision,
  workerKey: WorkerOutputKey,
): void {
  const { errors, warnings } = collectConfigIssues({
    base: resolvedConfig.base,
    isLib: Boolean(resolvedConfig.build.lib),
    chunkImportMap: Boolean((resolvedConfig.build as { chunkImportMap?: unknown }).chunkImportMap),
    viteMajor: parseMajor(viteVersion),
  })

  if (resolvedConfig.experimental.renderBuiltUrl !== renderBuiltUrl) {
    errors.push(hijackedRenderBuiltUrlIssue())
  }

  const { hashed, unverifiable } = toConfigPaths(fileNames, workerFileNames, workerKey)
  if (hashed.length > 0) errors.push(hashedFileNamePatternIssue(hashed))
  if (unverifiable.length > 0) warnings.push(unverifiableFileNamePatternIssue(unverifiable))

  for (const warning of warnings) {
    resolvedConfig.logger.warn(formatDiagnostic(palette, 'warn', warning))
  }

  if (errors.length > 0) {
    throw new Error(
      errors.map((issue) => formatDiagnostic(palette, 'error', issue)).join('\n\n'),
    )
  }
}

/** 既存の renderBuiltUrl 呼び出し結果を踏まえて、query 付きの URL を組み立てる */
export function resolveBuiltUrl(
  palette: Palette,
  config: ResolvedConfig,
  userRenderBuiltUrl: RenderBuiltUrl | undefined,
  query: string,
  filename: string,
  context: RenderBuiltUrlContext,
): ReturnType<RenderBuiltUrl> {
  if (context.ssr) return userRenderBuiltUrl?.(filename, context)

  const fromUserHook = userRenderBuiltUrl?.(filename, context)
  if (typeof fromUserHook === 'object' && fromUserHook !== null) {
    throw new Error(formatDiagnostic(palette, 'error', userHookReturnedObjectIssue()))
  }

  const url =
    typeof fromUserHook === 'string' ? fromUserHook : joinUrlSegments(config.base, filename)

  return appendQueryToBuiltUrl(url, query)
}
```

- [ ] **Step 2: `src/generate-bundle.ts` を書き換える**

全体を以下に置き換える。`verifyOutput` だけロジックの変更がある（`formatFindings(palette, level, findings)` の直接呼び出しを、`diagnostics.QCB_MISSING_QUERY({ count, sources })` を組み立ててから `formatDiagnostic` に渡す形に変える）。それ以外は `formatIssue` → `formatDiagnostic` の差し替えのみ。

```ts
import type { ResolvedConfig, Rollup } from 'vite'

import { diagnostics } from './diagnostics'
import { apiDriftIssue, manifestMissingIssue, nonEsFormatIssue } from './guards'
import { formatDiagnostic, formatSummary, type Palette } from './logger'
import { rewriteManifest, rewriteSsrManifest } from './manifest'
import type { VerifyMode } from './options'
import { rewriteImports } from './rewrite-imports'
import { findMissingQuery, isTrackedName, type OutputFile } from './verify'

const DEFAULT_MANIFEST_FILE_NAME = '.vite/manifest.json'
const DEFAULT_SSR_MANIFEST_FILE_NAME = '.vite/ssr-manifest.json'

function throwIssue(palette: Palette, issue: Parameters<typeof formatDiagnostic>[2]): never {
  throw new Error(formatDiagnostic(palette, 'error', issue))
}

/** config.build.manifest / config.build.ssrManifest から、書き換え対象のファイル名を決める */
export function resolveManifestTarget(config: ResolvedConfig): {
  manifestOption: ResolvedConfig['build']['manifest']
  manifestFileName: string
  ssrManifestOption: ResolvedConfig['build']['ssrManifest']
  ssrManifestFileName: string
} {
  const manifestOption = config.build.manifest
  const manifestFileName =
    typeof manifestOption === 'string' ? manifestOption : DEFAULT_MANIFEST_FILE_NAME

  const ssrManifestOption = config.build.ssrManifest
  const ssrManifestFileName =
    typeof ssrManifestOption === 'string' ? ssrManifestOption : DEFAULT_SSR_MANIFEST_FILE_NAME

  return { manifestOption, manifestFileName, ssrManifestOption, ssrManifestFileName }
}

/** renderBuiltUrl ラッパーが一度も呼ばれていないのにアセットが出力されていないかを検査する */
export function detectApiDrift(
  palette: Palette,
  bundle: Rollup.OutputBundle,
  wrapperCalled: boolean,
): void {
  const hasRenderableAssets = Object.values(bundle).some(
    (output) =>
      output.type === 'asset' &&
      isTrackedName(output.fileName) &&
      !output.fileName.endsWith('.json'),
  )

  if (!wrapperCalled && hasRenderableAssets) throwIssue(palette, apiDriftIssue())
}

/** ES 形式の出力に限り、チャンク間 import の指定子に query を書き換える */
export function rewriteChunkImports(
  palette: Palette,
  config: ResolvedConfig,
  bundle: Rollup.OutputBundle,
  outputOptions: Rollup.NormalizedOutputOptions,
  query: string,
): void {
  if (outputOptions.format === 'es') {
    for (const output of Object.values(bundle)) {
      if (output.type !== 'chunk') continue

      const result = rewriteImports(output.code, query, output.fileName)
      if (result !== null) output.code = result.code
    }
  } else {
    config.logger.warn(
      formatDiagnostic(palette, 'warn', nonEsFormatIssue(String(outputOptions.format))),
    )
  }
}

/** manifest ファイルの中身に query を書き加える（manifest が有効な場合のみ） */
export function rewriteManifestOutput(
  palette: Palette,
  bundle: Rollup.OutputBundle,
  manifestOption: ResolvedConfig['build']['manifest'],
  manifestFileName: string,
  query: string,
): void {
  if (manifestOption !== true && typeof manifestOption !== 'string') return

  const manifest = bundle[manifestFileName]
  if (manifest === undefined || manifest.type !== 'asset') {
    throw new Error(formatDiagnostic(palette, 'error', manifestMissingIssue(manifestFileName)))
  }
  manifest.source = rewriteManifest(String(manifest.source), query)
}

/** ssr-manifest ファイルの値（URL 配列）に query を書き加える（ssrManifest が有効な場合のみ） */
export function rewriteSsrManifestOutput(
  palette: Palette,
  bundle: Rollup.OutputBundle,
  ssrManifestOption: ResolvedConfig['build']['ssrManifest'],
  ssrManifestFileName: string,
  query: string,
): void {
  if (ssrManifestOption !== true && typeof ssrManifestOption !== 'string') return

  const ssrManifest = bundle[ssrManifestFileName]
  if (ssrManifest === undefined || ssrManifest.type !== 'asset') {
    throw new Error(formatDiagnostic(palette, 'error', manifestMissingIssue(ssrManifestFileName)))
  }
  ssrManifest.source = rewriteSsrManifest(String(ssrManifest.source), query)
}

/** verify とサマリログのために、manifest 類を除いた出力ファイルと参照名の一覧を集める */
export function collectOutputFiles(
  bundle: Rollup.OutputBundle,
  excludedFileNames: string[],
): { files: OutputFile[]; referenceNames: string[] } {
  const files: OutputFile[] = []
  const referenceNames: string[] = []
  const excluded = new Set(excludedFileNames)

  for (const output of Object.values(bundle)) {
    if (excluded.has(output.fileName)) continue

    referenceNames.push(output.fileName)

    const content =
      output.type === 'chunk'
        ? output.code
        : typeof output.source === 'string'
          ? output.source
          : null

    if (content !== null) files.push({ fileName: output.fileName, content })
  }

  return { files, referenceNames }
}

/** query 未付与の参照が残っていないかを検証し、verify モードに応じて警告または例外を出す */
export function verifyOutput(
  palette: Palette,
  config: ResolvedConfig,
  verifyMode: VerifyMode,
  files: OutputFile[],
  referenceNames: string[],
  query: string,
): void {
  if (verifyMode === 'off') return

  const findings = findMissingQuery(files, referenceNames, query)
  if (findings.length === 0) return

  const diagnostic = diagnostics.QCB_MISSING_QUERY({
    count: findings.length,
    sources: findings.map((finding) => `${finding.file}:${finding.line}:${finding.column}`),
  })

  const level = verifyMode === 'error' ? 'error' : 'warn'
  const message = formatDiagnostic(palette, level, diagnostic)

  if (level === 'error') throw new Error(message)
  config.logger.warn(message)
}

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

/** ビルド結果のサマリを info ログに出す */
export function logSummary(
  palette: Palette,
  config: ResolvedConfig,
  files: OutputFile[],
  query: string,
): void {
  config.logger.info(formatSummary(palette, query, countByExtension(files, query)))
}

/**
 * generateBundle フックの本体を、決められた順序で実行する。
 * ドリフト検知 → チャンク間 import 書き換え → manifest 書き換え → verify → サマリ、の順は変えないこと。
 */
export function runGenerateBundleStep(
  palette: Palette,
  config: ResolvedConfig,
  verifyMode: VerifyMode,
  outputOptions: Rollup.NormalizedOutputOptions,
  bundle: Rollup.OutputBundle,
  wrapperCalled: boolean,
  query: string,
): void {
  const { manifestOption, manifestFileName, ssrManifestOption, ssrManifestFileName } =
    resolveManifestTarget(config)

  detectApiDrift(palette, bundle, wrapperCalled)
  rewriteChunkImports(palette, config, bundle, outputOptions, query)
  rewriteManifestOutput(palette, bundle, manifestOption, manifestFileName, query)
  rewriteSsrManifestOutput(palette, bundle, ssrManifestOption, ssrManifestFileName, query)

  const { files, referenceNames } = collectOutputFiles(bundle, [
    manifestFileName,
    ssrManifestFileName,
  ])
  verifyOutput(palette, config, verifyMode, files, referenceNames, query)
  logSummary(palette, config, files, query)
}
```

- [ ] **Step 3: 全体の型チェックが通ることを確認する**

```bash
bun run typecheck
```

Expected: エラーなし。ここまでの4タスクで崩れていた型エラーがすべて解消される。

- [ ] **Step 4: 全テストを実行する**

```bash
bun run test -- --run
```

Expected: すべて PASS。**`tests/integration/*.test.ts` は1文字も変更していないので、ここで初めて実際にビルドを回して検証することになる。**

**もし `tests/integration/unsupported.test.ts` や `tests/integration/worker.test.ts` の正規表現アサーション（`/相対 base/`・`/build\.lib/`・`/renderBuiltUrl/`・`/\[hash\]/`・`/output/`・`/worker\.rolldownOptions\.output\.entryFileNames/`・`/build\.rollupOptions/` の否定）が落ちた場合:** テストの期待値を緩めず、`src/diagnostics.ts` の該当コードの `why` にその部分文字列が含まれているかを確認すること。Task 1 で定義した文言は元の `Issue` の `title`/`details` の文言をそのまま埋め込む設計なので、通常は一致するはず。

- [ ] **Step 5: コミット**

```bash
git add src/plugin-steps.ts src/generate-bundle.ts
git commit -m "refactor: wire nostics diagnostics into the plugin hooks"
```

---

### Task 6: README に出力例を追加し、最終確認する

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README に「エラー表示」節を追加する**

`README.md` の `## 非対応の構成` の直前に、以下を挿入する。

```markdown
## エラー表示

対応していない設定やビルド後の検証結果は、[nostics](https://nostics.dev) と同じ「診断コード＋ツリー表示」で出します。

\`\`\`
[QCB_RELATIVE_BASE] error  相対 base には対応していません: base: "./"
╰▶ fix: 相対 base では Vite が JS 内の URL を実行時計算に切り替えるため、query を静的に付与できません。絶対パス（例: base: '/'）を指定してください。
\`\`\`

verify の警告・エラーは、取りこぼした参照の位置を `sources` にまとめて表示します。

\`\`\`
[QCB_MISSING_QUERY] warn  query 未付与の参照が 2 件あります
├▶ fix: ソース中に文字列でハードコードされたパスの可能性があります。意図的な場合は verify: 'off' で抑制できます。
├▶ sources: assets/index.js:1:2043
╰▶ sources: assets/manifest.json:1:88
\`\`\`

```

（挿入するのは上記のコードブロックの中身。バッククォート3つのフェンス自体はそのまま Markdown として書く。）

- [ ] **Step 2: 全テスト・lint・型チェック・ビルドを確認する**

```bash
bun run format && bun run test -- --run && bun run check && bun run build
```

Expected: すべて成功。テストは Task 5 時点と同じ件数で PASS、`bun run build` で `dist/index.mjs` と `dist/index.d.mts` が生成される。

- [ ] **Step 3: コミット**

```bash
git add README.md
git commit -m "docs: show the nostics-style diagnostic output"
```

---

## 完了条件

- `bun run test -- --run` が全件 PASS
- `bun run check`（oxlint + oxfmt --check + tsc --noEmit）がエラーなし
- `bun run build` が成功し `dist/` が生成される
- `tests/integration/*.test.ts` を1文字も変更せずに全件 PASS すること（既存のエラーメッセージへの正規表現アサーションが新フォーマットでも通ることの確認）
- `src/options.ts` の `normalizeOptions` が投げるエラーは変更されていないこと（スコープ外）
