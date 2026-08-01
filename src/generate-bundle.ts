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
