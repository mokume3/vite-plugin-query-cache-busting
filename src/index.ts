import { Ansis } from 'ansis'
import type { Plugin, ResolvedConfig, Rollup, UserConfig } from 'vite'
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
import { createPalette, formatFindings, formatIssue, formatSummary, type Palette } from './logger'
import { rewriteManifest } from './manifest'
import { normalizeOptions, type Options, type VerifyMode } from './options'
import { rewriteImports } from './rewrite-imports'
import { appendQuery, buildQuery, joinUrlSegments } from './url'
import { findMissingQuery, isTrackedName, type OutputFile } from './verify'
import { resolveVersion } from './version'

export type { Options, VerifyMode } from './options'

type RenderBuiltUrl = NonNullable<NonNullable<UserConfig['experimental']>['renderBuiltUrl']>
type RenderBuiltUrlContext = Parameters<RenderBuiltUrl>[1]

const DEFAULT_MANIFEST_FILE_NAME = '.vite/manifest.json'
const DEFAULT_ASSETS_DIR = 'assets'

export function queryCacheBusting(options: Options = {}): Plugin {
  const resolved = normalizeOptions(options)
  const palette = createPalette(new Ansis())
  let query = ''
  let config: ResolvedConfig
  let userRenderBuiltUrl: RenderBuiltUrl | undefined
  let fileNames: FileNamesDecision = { patch: {}, hashed: [], unverifiable: [] }
  let workerFileNames: FileNamesDecision = { patch: {}, hashed: [], unverifiable: [] }
  let wrapperCalled = false
  const renderBuiltUrl: RenderBuiltUrl = (filename, context) => {
    wrapperCalled = true
    return resolveBuiltUrl(palette, config, userRenderBuiltUrl, query, filename, context)
  }

  return {
    name: PLUGIN_NAME,
    apply: 'build',
    enforce: 'post',

    async config(userConfig) {
      userRenderBuiltUrl = userConfig.experimental?.renderBuiltUrl
      query = buildQuery(resolved.key, await resolveVersion(resolved.version))
      const decided = decideOutputFileNames(palette, userConfig)
      fileNames = decided.fileNames
      workerFileNames = decided.workerFileNames
      return { build: decided.build, worker: decided.worker, experimental: { renderBuiltUrl } }
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig
      applyResolvedConfigIssues(palette, resolvedConfig, renderBuiltUrl, fileNames, workerFileNames)
    },

    // vite:build-import-analysis の __vitePreload 依存配列解決（指定子文字列で bundle を
    // 引く）より後に import を書き換える必要があるため order: 'post' にしている。
    generateBundle: {
      order: 'post',
      handler(outputOptions, bundle) {
        if (this.environment?.config.consumer === 'server') return
        const { manifestOption, manifestFileName } = resolveManifestTarget(config)
        detectApiDrift(palette, bundle, wrapperCalled)
        rewriteChunkImports(palette, config, bundle, outputOptions, query)
        rewriteManifestOutput(palette, bundle, manifestOption, manifestFileName, query)
        const { files, referenceNames } = collectOutputFiles(bundle, manifestFileName)
        verifyOutput(palette, config, resolved.verify, files, referenceNames, query)
        logSummary(palette, config, files, query)
      },
    },
  }
}

export default queryCacheBusting

function throwIssue(palette: Palette, issue: Parameters<typeof formatIssue>[2]): never {
  throw new Error(formatIssue(palette, 'error', issue))
}
/** config.build.manifest から、書き換え対象の manifest ファイル名を決める */
function resolveManifestTarget(config: ResolvedConfig): {
  manifestOption: ResolvedConfig['build']['manifest']
  manifestFileName: string
} {
  const manifestOption = config.build.manifest
  const manifestFileName =
    typeof manifestOption === 'string' ? manifestOption : DEFAULT_MANIFEST_FILE_NAME
  return { manifestOption, manifestFileName }
}

/** config フックが返す build/worker のパッチと、あとで使う fileNames・workerFileNames をまとめて決める */
function decideOutputFileNames(palette: Palette, userConfig: UserConfig) {
  const assetsDir = userConfig.build?.assetsDir ?? DEFAULT_ASSETS_DIR
  const key = userConfig.worker?.rollupOptions ? 'rollupOptions' : 'rolldownOptions'
  const output = userConfig.build?.rollupOptions?.output
  const workerOut =
    userConfig.worker?.rolldownOptions?.output ?? userConfig.worker?.rollupOptions?.output
  if (Array.isArray(output) || Array.isArray(workerOut)) throwIssue(palette, multipleOutputsIssue())
  const fileNames = decideFileNames((output ?? {}) as Record<string, unknown>, assetsDir)
  const workerFileNames = decideFileNames((workerOut ?? {}) as Record<string, unknown>, assetsDir)
  return {
    fileNames,
    workerFileNames,
    build: { rollupOptions: { output: fileNames.patch } },
    worker: { [key]: { output: workerFileNames.patch } },
  }
}

/** configResolved 時点の設定値から問題を集め、警告ログと例外に変換する */
function applyResolvedConfigIssues(
  palette: Palette,
  resolvedConfig: ResolvedConfig,
  renderBuiltUrl: RenderBuiltUrl,
  fileNames: FileNamesDecision,
  workerFileNames: FileNamesDecision,
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
  const hashed = [...fileNames.hashed, ...workerFileNames.hashed]
  const unverifiable = [...fileNames.unverifiable, ...workerFileNames.unverifiable]
  if (hashed.length > 0) errors.push(hashedFileNamePatternIssue(hashed))
  if (unverifiable.length > 0) warnings.push(unverifiableFileNamePatternIssue(unverifiable))
  for (const warning of warnings) {
    resolvedConfig.logger.warn(formatIssue(palette, 'warn', warning))
  }
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => formatIssue(palette, 'error', issue)).join('\n\n'))
  }
}

/** 既存の renderBuiltUrl 呼び出し結果を踏まえて、query 付きの URL を組み立てる */
function resolveBuiltUrl(
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
    throw new Error(formatIssue(palette, 'error', userHookReturnedObjectIssue()))
  }

  const url =
    typeof fromUserHook === 'string' ? fromUserHook : joinUrlSegments(config.base, filename)

  return appendQuery(url, query)
}

/** renderBuiltUrl ラッパーが一度も呼ばれていないのにアセットが出力されていないかを検査する */
function detectApiDrift(
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
function rewriteChunkImports(
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
    config.logger.warn(formatIssue(palette, 'warn', nonEsFormatIssue(String(outputOptions.format))))
  }
}

/** manifest ファイルの中身に query を書き加える（manifest が有効な場合のみ） */
function rewriteManifestOutput(
  palette: Palette,
  bundle: Rollup.OutputBundle,
  manifestOption: ResolvedConfig['build']['manifest'],
  manifestFileName: string,
  query: string,
): void {
  if (manifestOption !== true && typeof manifestOption !== 'string') return

  const manifest = bundle[manifestFileName]
  if (manifest === undefined || manifest.type !== 'asset') {
    throw new Error(formatIssue(palette, 'error', manifestMissingIssue(manifestFileName)))
  }
  manifest.source = rewriteManifest(String(manifest.source), query)
}

/** verify とサマリログのために、manifest を除いた出力ファイルと参照名の一覧を集める */
function collectOutputFiles(
  bundle: Rollup.OutputBundle,
  manifestFileName: string,
): { files: OutputFile[]; referenceNames: string[] } {
  const files: OutputFile[] = []
  const referenceNames: string[] = []

  for (const output of Object.values(bundle)) {
    if (output.fileName === manifestFileName) continue

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
function verifyOutput(
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

  const level = verifyMode === 'error' ? 'error' : 'warn'
  const message = formatFindings(palette, level, findings)

  if (level === 'error') throw new Error(message)
  config.logger.warn(message)
}

/** ビルド結果のサマリを info ログに出す */
function logSummary(
  palette: Palette,
  config: ResolvedConfig,
  files: OutputFile[],
  query: string,
): void {
  config.logger.info(formatSummary(palette, query, countByExtension(files, query)))
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
