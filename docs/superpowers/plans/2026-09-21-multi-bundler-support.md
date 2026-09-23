# Vite 6/7(Rollup)対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vite-plugin-query-cache-busting` を Vite 8(Rolldown)専用から Vite 6/7/8(Rollup + Rolldown)対応に拡張する。

**Architecture:** AST解析を `vite` の re-export ではなく `oxc-parser` の直接依存に切り替えてバンドラ非依存にし、worker output キーのデフォルト判定とバージョンガードをバンドラのメジャーバージョンに応じて分岐させる。CIにVite 6/7/8のマトリクステストを追加して継続的に検証する。

**Tech Stack:** TypeScript, Bun, Vite(6/7/8), oxc-parser, vitest, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-21-multi-bundler-support-design.md`(前提となる元設計は `docs/superpowers/specs/2026-07-30-query-cache-busting-design.md`)

## Global Constraints

- 対応バージョンは Vite 6 / 7 / 8 のみ。Vite 5 以下、Vite 9 以上は対象外(9以上は警告のみで続行)
- AST解析は `oxc-parser`(`^0.151.0`)を直接の `dependencies` として使う。`vite` からの `parseAst`/`parseSync` の re-export には依存しない
- `peerDependencies.vite` は `^6.0.0 || ^7.0.0 || ^8.0.0`
- 既存のテストスイート(182件、`bun run test -- --run`)は各タスク完了時点で必ず全件パスすること
- `bun run check`(lint + format:check + typecheck)は各タスク完了時点で必ずパスすること
- 破壊的変更を避ける: Vite 8 環境での既存の挙動(worker output キーのデフォルトが `rolldownOptions` になること等)は変えない
- 設計ドキュメント自体(`docs/superpowers/specs/2026-09-21-multi-bundler-support-design.md` の新規作成と、`2026-07-30-query-cache-busting-design.md` への改定注記の追加)はブレインストーミング時点で既に完了済み。本プランはコード・テスト・CI・READMEの実装のみを扱う

---

## Task 1: AST解析を `oxc-parser` の直接依存に切り替える

**Files:**
- Modify: `package.json`(`dependencies` に `oxc-parser` を追加)
- Modify: `src/rewrite-imports.ts:2`(import元を `vite` → `oxc-parser` に変更)
- Test: `tests/rewrite-imports.test.ts`(マルチバイト文字混在時のオフセット整合性テストを追加)

**Interfaces:**
- Consumes: なし(独立したタスク)
- Produces: `rewriteImports(code: string, query: string, fileName: string): RewriteResult | null` のシグネチャ・挙動は変更しない。内部実装のみ変更

- [ ] **Step 1: 現状のバグを再現する(Vite 6 環境でテストが落ちることを確認)**

インストール済みの `vite` を一時的に 6 に差し替える(`package.json`/`bun.lock` は変更しない)。

Run: `bun add vite@6 --no-save`

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun run test -- --run`
Expected: `tests/rewrite-imports.test.ts` と複数の `tests/integration/*.test.ts` が `TypeError: parseSync is not a function` で失敗する

- [ ] **Step 3: 元の Vite 8 環境に戻す**

Run: `bun install`
Expected: `node_modules/vite/package.json` の `version` が `8.3.0` に戻る

- [ ] **Step 4: `oxc-parser` を依存に追加する**

Run: `bun add oxc-parser`

`package.json` の `dependencies` に以下が追加されていることを確認する(バージョンは実際にインストールされたものに従う。執筆時点の最新は `^0.151.0`):

```json
"dependencies": {
    "@ampproject/remapping": "^2.3.0",
    "ansis": "^4.4.0",
    "magic-string": "^1.4.1",
    "nostics": "^1.2.0",
    "oxc-parser": "^0.151.0"
},
```

- [ ] **Step 5: `src/rewrite-imports.ts` の import元を変更する**

`src/rewrite-imports.ts:2` を次のように変更する(呼び出し側のシグネチャ・返り値は変わらないため、他の変更は不要):

```ts
import { MagicString } from 'magic-string'
import { parseSync } from 'oxc-parser'

import { appendQuery } from './url'
```

- [ ] **Step 6: 既存テストがすべてパスすることを確認する(Vite 8 環境)**

Run: `bun run test -- --run`
Expected: 182件すべてパス

- [ ] **Step 7: マルチバイト文字混在時のオフセット整合性テストを追加する**

`tests/rewrite-imports.test.ts` の最後の `test('sourcemap を生成する', ...)` の後に追加する:

```ts
  test('マルチバイト文字を含むコードでも書き換え位置がずれない', () => {
    const code = 'const s = "日本語のコメントああああ"\nimport("./dep.js")\n'

    expect(rewriteImports(code, 'v=1', 'chunk.js')?.code).toBe(
      'const s = "日本語のコメントああああ"\nimport("./dep.js?v=1")\n',
    )
  })
```

- [ ] **Step 8: 追加したテストを実行してパスすることを確認する**

Run: `bun run test -- --run rewrite-imports`
Expected: PASS(新規テストを含め全件)

- [ ] **Step 9: Vite 6/7 環境でも直ることを確認する**

Run: `bun add vite@6 --no-save && bun run test -- --run`
Expected: 182件(+新規1件)すべてパス

Run: `bun add vite@7 --no-save && bun run test -- --run`
Expected: 同上、すべてパス

- [ ] **Step 10: Vite 8 環境に戻す**

Run: `bun install`
Expected: `node_modules/vite/package.json` の `version` が `8.3.0` に戻る

- [ ] **Step 11: lint/format/typecheck を確認する**

Run: `bun run check`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add package.json bun.lock src/rewrite-imports.ts tests/rewrite-imports.test.ts
git commit -m "$(cat <<'EOF'
feat: parse chunk AST with oxc-parser instead of vite's re-export

Vite's parseAst/parseSync re-export differs across majors (Rollup/acorn
for 6/7, Rolldown/oxc for 8+, and the export name itself changed between
majors). Depending on oxc-parser directly makes chunk-to-chunk import
rewriting bundler-version-independent.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: worker output キーのデフォルト値をバージョン依存にする

**Files:**
- Modify: `src/plugin-steps.ts`(`decideOutputFileNames`/`applyResolvedConfigIssues` に `viteMajor` パラメータを追加)
- Modify: `src/index.ts`(`viteMajor` を計算して両関数に渡す)
- Test: `tests/plugin-steps.test.ts`(新規作成)

**Interfaces:**
- Consumes: なし(独立したタスク。Task 1 の完了は前提としない)
- Produces:
  - `decideOutputFileNames(palette: Palette, userConfig: UserConfig, viteMajor: number): { fileNames, workerFileNames, workerKey, environments, worker }`(第3引数 `viteMajor` を追加)
  - `applyResolvedConfigIssues(palette: Palette, resolvedConfig: ResolvedConfig, renderBuiltUrl: RenderBuiltUrl, fileNames: FileNamesDecision, workerFileNames: FileNamesDecision, workerKey: WorkerOutputKey, viteMajor: number): void`(第7引数 `viteMajor` を追加)

- [ ] **Step 1: 失敗するテストを書く**

`tests/plugin-steps.test.ts` を新規作成する:

```ts
import { Ansis } from 'ansis'
import { describe, expect, test } from 'vitest'

import { createPalette } from '../src/logger'
import { decideOutputFileNames } from '../src/plugin-steps'

const palette = createPalette(new Ansis(0))

describe('decideOutputFileNames', () => {
  test('viteMajor が 8 以上で worker キー未指定なら rolldownOptions をデフォルトにする', () => {
    const result = decideOutputFileNames(palette, {}, 8)

    expect(result.workerKey).toBe('rolldownOptions')
  })

  test('viteMajor が 8 未満で worker キー未指定なら rollupOptions をデフォルトにする', () => {
    expect(decideOutputFileNames(palette, {}, 6).workerKey).toBe('rollupOptions')
    expect(decideOutputFileNames(palette, {}, 7).workerKey).toBe('rollupOptions')
  })

  test('worker.rolldownOptions.output を明示していれば viteMajor に関わらず優先する', () => {
    const result = decideOutputFileNames(
      palette,
      { worker: { rolldownOptions: { output: {} } } },
      6,
    )

    expect(result.workerKey).toBe('rolldownOptions')
  })

  test('worker.rollupOptions.output を明示していれば viteMajor に関わらず優先する', () => {
    const result = decideOutputFileNames(palette, { worker: { rollupOptions: { output: {} } } }, 8)

    expect(result.workerKey).toBe('rollupOptions')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun run test -- --run plugin-steps`
Expected: FAIL(`decideOutputFileNames` は現状2引数までしか受け取らず、型エラーまたは `viteMajor` 未使用のまま `rolldownOptions` 固定になり、6/7 のケースで失敗する)

- [ ] **Step 3: `src/plugin-steps.ts` を変更する**

先頭の import から `viteVersion`/`parseMajor` を削除する(この後 `index.ts` 側に移すため):

```ts
import type { ResolvedConfig, UserConfig } from 'vite'

import { decideFileNames, type FileNamesDecision, type OutputFileNames } from './file-names'
import {
  collectConfigIssues,
  hashedFileNamePatternIssue,
  hijackedRenderBuiltUrlIssue,
  multipleOutputsIssue,
  unverifiableFileNamePatternIssue,
  userHookReturnedObjectIssue,
} from './guards'
import { formatDiagnostic, type Palette, throwIssue, warnIssue } from './logger'
import { appendQueryToBuiltUrl, joinUrlSegments } from './url'
```

`decideOutputFileNames` のシグネチャと workerKey 判定を変更する:

```ts
export function decideOutputFileNames(
  palette: Palette,
  userConfig: UserConfig,
  viteMajor: number,
): {
  fileNames: FileNamesDecision
  workerFileNames: FileNamesDecision
  workerKey: WorkerOutputKey
  environments: { client: { build: { rollupOptions: { output: Partial<OutputFileNames> } } } }
  worker: Partial<Record<WorkerOutputKey, { output: Partial<OutputFileNames> }>>
} {
  const assetsDir = userConfig.build?.assetsDir ?? DEFAULT_ASSETS_DIR
  const output =
    userConfig.environments?.client?.build?.rollupOptions?.output ??
    userConfig.build?.rollupOptions?.output
  const rolldownOutput = userConfig.worker?.rolldownOptions?.output
  const rollupOutput = userConfig.worker?.rollupOptions?.output

  // Vite 8 未満(Rollup)には worker.rolldownOptions というキー自体が存在しないため、
  // 未指定時のデフォルトはバンドラのメジャーバージョンに応じて決める
  const defaultWorkerKey: WorkerOutputKey = viteMajor >= 8 ? 'rolldownOptions' : 'rollupOptions'
  const workerKey: WorkerOutputKey =
    rolldownOutput !== undefined
      ? 'rolldownOptions'
      : rollupOutput !== undefined
        ? 'rollupOptions'
        : defaultWorkerKey
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
```

`applyResolvedConfigIssues` のシグネチャと `collectConfigIssues` 呼び出しを変更する:

```ts
export function applyResolvedConfigIssues(
  palette: Palette,
  resolvedConfig: ResolvedConfig,
  renderBuiltUrl: RenderBuiltUrl,
  fileNames: FileNamesDecision,
  workerFileNames: FileNamesDecision,
  workerKey: WorkerOutputKey,
  viteMajor: number,
): void {
  const { errors, warnings } = collectConfigIssues({
    base: resolvedConfig.base,
    isLib: Boolean(resolvedConfig.build.lib),
    chunkImportMap: Boolean((resolvedConfig.build as { chunkImportMap?: unknown }).chunkImportMap),
    viteMajor,
  })
  // ...この後は変更なし
```

- [ ] **Step 4: `src/index.ts` を変更する**

import に `viteVersion` と `parseMajor` を追加し、モジュールスコープで `viteMajor` を計算する:

```ts
import { Ansis } from 'ansis'
import type { Plugin, ResolvedConfig, Rollup, UserConfig } from 'vite'
import { version as viteVersion } from 'vite'

import { PLUGIN_NAME } from './constants'
import type { FileNamesDecision } from './file-names'
import { runGenerateBundleStep } from './generate-bundle'
import { parseMajor } from './guards'
import { createPalette, type Palette } from './logger'
import { normalizeOptions, type Options, type ResolvedOptions } from './options'
import {
  applyResolvedConfigIssues,
  decideOutputFileNames,
  type RenderBuiltUrl,
  resolveBuiltUrl,
  type WorkerOutputKey,
} from './plugin-steps'
import { buildQuery } from './url'
import { resolveVersion } from './version'

export type { Options, VerifyMode } from './options'

const viteMajor = parseMajor(viteVersion)
```

`handleConfig` 内の呼び出しを変更する:

```ts
  const decided = decideOutputFileNames(palette, userConfig, viteMajor)
```

`handleConfigResolved` 内の呼び出しを変更する:

```ts
function handleConfigResolved(
  state: PluginState,
  palette: Palette,
  renderBuiltUrl: RenderBuiltUrl,
  resolvedConfig: ResolvedConfig,
): void {
  state.config = resolvedConfig
  applyResolvedConfigIssues(
    palette,
    resolvedConfig,
    renderBuiltUrl,
    state.fileNames,
    state.workerFileNames,
    state.workerKey,
    viteMajor,
  )
}
```

- [ ] **Step 5: テストを実行してパスすることを確認する**

Run: `bun run test -- --run`
Expected: 182件+新規4件がすべてパス(既存の `tests/integration/worker.test.ts` も含め回帰なし)

- [ ] **Step 6: lint/format/typecheck を確認する**

Run: `bun run check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/plugin-steps.ts src/index.ts tests/plugin-steps.test.ts
git commit -m "$(cat <<'EOF'
fix: default worker output key to rollupOptions below Vite 8

worker.rolldownOptions doesn't exist before Vite 8 (Rollup-based), so
defaulting to it unconditionally silently dropped the worker filename
patch under Vite 6/7. Thread viteMajor through so the default follows
the active bundler.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: バージョンガードを Vite 6 以上に拡張する

**Files:**
- Modify: `src/guards.ts`(`unsupportedViteMajorIssue` のしきい値変更)
- Modify: `src/diagnostics.ts`(`QCB_VITE_TOO_OLD`/`QCB_VITE_UNVERIFIED` の文言変更)
- Modify: `tests/guards.test.ts`(しきい値変更に合わせてテスト更新・追加)
- Modify: `tests/diagnostics.test.ts`(文言変更に合わせてテスト更新)

**Interfaces:**
- Consumes: なし(独立したタスク)
- Produces: `collectConfigIssues({ viteMajor, ... })` の外部シグネチャは変更しない。`viteMajor < 6` でエラー、`viteMajor > 8` で警告になる(旧: `< 8` でエラー)

- [ ] **Step 1: 失敗するテストを書く**

`tests/guards.test.ts` の `test('Vite 7 以下ならエラー', ...)` を次のように置き換える:

```ts
  test('Vite 5 以下ならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, viteMajor: 5 })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/Vite 6/)
  })

  test('Vite 6/7 は対応構成として扱う(エラーにならない)', () => {
    expect(collectConfigIssues({ ...supported, viteMajor: 6 }).errors).toEqual([])
    expect(collectConfigIssues({ ...supported, viteMajor: 7 }).errors).toEqual([])
  })
```

`tests/diagnostics.test.ts` の `test('関数の why はパラメータを埋め込む', ...)` を次のように置き換える:

```ts
  test('関数の why はパラメータを埋め込む', () => {
    const diagnostic = diagnostics.QCB_VITE_TOO_OLD({ viteMajor: 5 })

    expect(diagnostic.message).toBe('Vite 6 or later is required (detected: 5)')
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun run test -- --run guards diagnostics`
Expected: FAIL(`viteMajor: 6`/`7` が現状エラーになる。`viteMajor: 5` の message が期待値と一致しない)

- [ ] **Step 3: `src/guards.ts` を変更する**

```ts
function unsupportedViteMajorIssue(viteMajor: number): Diagnostic | undefined {
  if (viteMajor >= 6) return undefined
  return diagnostics.QCB_VITE_TOO_OLD({ viteMajor })
}
```

(`unverifiedViteMajorIssue` は `viteMajor > 8` のまま変更しない)

- [ ] **Step 4: `src/diagnostics.ts` を変更する**

```ts
    QCB_VITE_TOO_OLD: {
      why: (p: { viteMajor: number }) => `Vite 6 or later is required (detected: ${p.viteMajor})`,
      fix: 'The assumptions behind experimental.renderBuiltUrl and the AST parser used here have only been verified for Vite 6 and later. Upgrade to Vite 6 or later.',
    },
    QCB_VITE_UNVERIFIED: {
      why: (p: { viteMajor: number }) => `Vite ${p.viteMajor} is unverified`,
      fix: 'This plugin has been verified against Vite 6, 7, and 8. Check that no verify warnings appear after the build.',
    },
```

- [ ] **Step 5: テストを実行してパスすることを確認する**

Run: `bun run test -- --run`
Expected: 全件パス

- [ ] **Step 6: lint/format/typecheck を確認する**

Run: `bun run check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/guards.ts src/diagnostics.ts tests/guards.test.ts tests/diagnostics.test.ts
git commit -m "$(cat <<'EOF'
feat: lower minimum supported Vite version to 6

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `peerDependencies` の拡張と README 更新

**Files:**
- Modify: `package.json`(`peerDependencies.vite`)
- Modify: `README.md`(Requirements セクション)
- Modify: `README.ja.md`(Requirements セクション、存在すれば同等の記述)

**Interfaces:**
- Consumes: なし(独立したタスク。他タスクの完了は前提としない)
- Produces: なし(パッケージメタデータ・ドキュメントのみ)

- [ ] **Step 1: `package.json` を変更する**

```json
  "peerDependencies": {
    "vite": "^6.0.0 || ^7.0.0 || ^8.0.0"
  },
```

- [ ] **Step 2: `README.md` を変更する**

`## Requirements` セクションの `- Vite 8` を次のように変更する:

```markdown
## Requirements

- Vite 6, 7, or 8
```

- [ ] **Step 3: `README.ja.md` を変更する**

同じセクションの `- Vite 8` を次のように変更する:

```markdown
## Requirements

- Vite 6, 7, 8
```

- [ ] **Step 4: 変更箇所以外に `Vite 8` 単独表記が残っていないか確認する**

Run: `grep -rn "Vite 8" README.md README.ja.md`
Expected: 一致なし(0件)

- [ ] **Step 5: `bun run check` を実行する(package.json 変更が壊れていないことの確認)**

Run: `bun run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json README.md README.ja.md
git commit -m "$(cat <<'EOF'
docs: widen supported Vite range to 6, 7, 8

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CI に Vite 6/7/8 のマトリクステストを追加する

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1〜3 で修正されたコード(このタスクはそれらが完了している前提。CIで実際に検証するのはそのため)
- Produces: なし(CI設定のみ)

- [ ] **Step 1: 現状の `ci.yml` を確認する**

Run: `cat .github/workflows/ci.yml`
Expected: 単一の `test` ジョブが `bun run check` → `bun run test -- --run` → `bun run build` を実行している

- [ ] **Step 2: `.github/workflows/ci.yml` を書き換える**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        vite-version: [6, 7, 8]
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install --frozen-lockfile
      - name: Override installed vite version
        if: matrix.vite-version != 8
        run: bun add vite@${{ matrix.vite-version }} --no-save
      - run: bun run test -- --run

  check-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install --frozen-lockfile
      - run: bun run check
      - run: bun run test -- --run
      - run: bun run build
```

- [ ] **Step 3: ローカルで matrix.vite-version = 6 の手順を再現する**

Run: `bun install --frozen-lockfile && bun add vite@6 --no-save && bun run test -- --run`
Expected: 全件パス(Task 1〜3 が完了していれば)

- [ ] **Step 4: ローカルで matrix.vite-version = 7 の手順を再現する**

Run: `bun add vite@7 --no-save && bun run test -- --run`
Expected: 全件パス

- [ ] **Step 5: `check-and-build` 相当の手順を再現する**

Run: `bun install && bun run check && bun run test -- --run && bun run build`
Expected: すべて成功(`bun install` で Vite 8 に戻ることを確認)

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: add Vite 6/7/8 matrix testing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification

全タスク完了後、通しで確認する。

- [ ] Run: `bun install && bun run check && bun run test -- --run && bun run build`
- [ ] Run: `bun add vite@6 --no-save && bun run test -- --run`
- [ ] Run: `bun add vite@7 --no-save && bun run test -- --run`
- [ ] Run: `bun install`(Vite 8 に復元し、`git status` で `package.json`/`bun.lock` に差分が無いことを確認)
