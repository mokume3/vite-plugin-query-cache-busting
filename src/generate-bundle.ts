import type { ResolvedConfig, Rollup } from 'vite'

import { diagnostics } from './diagnostics'
import { apiDriftIssue, manifestMissingIssue, nonEsFormatIssue } from './guards'
import { formatDiagnostic, formatSummary, type Palette } from './logger'
import { rewriteManifest, rewriteSsrManifest } from './manifest'
import type { VerifyMode } from './options'
import { rewriteImports } from './rewrite-imports'
import { countQueryParams } from './url'
import { findMissingQuery, isTrackedName, type OutputFile } from './verify'

const DEFAULT_MANIFEST_FILE_NAME = '.vite/manifest.json'
const DEFAULT_SSR_MANIFEST_FILE_NAME = '.vite/ssr-manifest.json'

function throwIssue(palette: Palette, issue: Parameters<typeof formatDiagnostic>[2]): never {
  throw new Error(formatDiagnostic(palette, 'error', issue))
}

/** Decides the target filenames to rewrite from config.build.manifest / config.build.ssrManifest */
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

/** Checks whether assets were emitted even though the renderBuiltUrl wrapper was never called */
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

/** Rewrites chunk-to-chunk import specifiers to include the query, but only for ES-format output */
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

/** Adds the query to the manifest file's content (only when manifest is enabled) */
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

/** Adds the query to the ssr-manifest file's values (arrays of URLs), only when ssrManifest is enabled */
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

/** Collects output files and reference names (excluding the manifests) for verify and the summary log */
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

/** Verifies that no reference is missing the query, emitting a warning or exception depending on verify mode */
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

/** Emits a summary of the build result as an info log */
export function logSummary(
  palette: Palette,
  config: ResolvedConfig,
  files: OutputFile[],
  query: string,
): void {
  config.logger.info(formatSummary(palette, query, countByExtension(files, query)))
}

/**
 * Runs the body of the generateBundle hook in a fixed order.
 * Do not change the order: drift detection → chunk-to-chunk import rewriting → manifest rewriting → verify → summary.
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
