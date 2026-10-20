import type { ResolvedConfig, UserConfig } from 'vite'

import { decideFileNames } from './file-names'
import type { FileNamesDecision, OutputFileNames } from './file-names'
import {
  collectConfigIssues,
  hashedFileNamePatternIssue,
  hijackedRenderBuiltUrlIssue,
  multipleOutputsIssue,
  unverifiableFileNamePatternIssue,
  userHookReturnedObjectIssue,
} from './guards'
import { formatDiagnostic, throwIssue, warnIssue } from './logger'
import type { Palette } from './logger'
import { appendQueryToBuiltUrl, joinUrlSegments } from './url'

export type RenderBuiltUrl = NonNullable<NonNullable<UserConfig['experimental']>['renderBuiltUrl']>
type RenderBuiltUrlContext = Parameters<RenderBuiltUrl>[1]

const DEFAULT_ASSETS_DIR = 'assets'

export type WorkerOutputKey = 'rollupOptions' | 'rolldownOptions'

/**
 * Decides which worker option key to patch. An explicitly configured key always wins;
 * otherwise it follows the active bundler, since worker.rolldownOptions doesn't exist
 * below Vite 8 (Rollup-based).
 */
function decideWorkerKey(
  hasRolldownOutput: boolean,
  hasRollupOutput: boolean,
  viteMajor: number,
): WorkerOutputKey {
  if (hasRolldownOutput) return 'rolldownOptions'
  if (hasRollupOutput) return 'rollupOptions'
  return viteMajor >= 8 ? 'rolldownOptions' : 'rollupOptions'
}

/** Decides the environments.client/worker patch returned by the config hook, along with fileNames/workerFileNames for later use */
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
  // SSR is out of scope for this plugin. Patching build.rollupOptions.output unconditionally
  // would also affect SSR builds that don't inherit environments.client, so this only
  // writes to the client environment.
  // rollupOptions is the only key on Vite 6/7 and an alias of rolldownOptions on Vite 8,
  // so reading it covers every supported version despite the deprecation.
  /* oxlint-disable typescript/no-deprecated */
  const output =
    userConfig.environments?.client?.build?.rollupOptions?.output ??
    userConfig.build?.rollupOptions?.output
  const rolldownOutput = userConfig.worker?.rolldownOptions?.output
  const rollupOutput = userConfig.worker?.rollupOptions?.output
  /* oxlint-enable typescript/no-deprecated */

  const workerKey = decideWorkerKey(
    rolldownOutput !== undefined,
    rollupOutput !== undefined,
    viteMajor,
  )
  const workerOut = rolldownOutput ?? rollupOutput

  if (Array.isArray(output) || Array.isArray(workerOut)) throwIssue(palette, multipleOutputsIssue())

  const fileNames = decideFileNames(output ?? {}, assetsDir)
  const workerFileNames = decideFileNames(workerOut ?? {}, assetsDir)

  return {
    fileNames,
    workerFileNames,
    workerKey,
    environments: { client: { build: { rollupOptions: { output: fileNames.patch } } } },
    worker: { [workerKey]: { output: workerFileNames.patch } },
  }
}

/** Prefixes the problem keys for the main build and worker output filename patterns with their actual config paths */
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

/** Collects problems from the config values at configResolved time, and turns them into warning logs and exceptions */
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

  if (resolvedConfig.experimental.renderBuiltUrl !== renderBuiltUrl) {
    errors.push(hijackedRenderBuiltUrlIssue())
  }

  const { hashed, unverifiable } = toConfigPaths(fileNames, workerFileNames, workerKey)
  if (hashed.length > 0) errors.push(hashedFileNamePatternIssue(hashed))
  if (unverifiable.length > 0) warnings.push(unverifiableFileNamePatternIssue(unverifiable))

  for (const warning of warnings) {
    warnIssue(palette, resolvedConfig.logger, warning)
  }

  if (errors.length > 0) {
    throw new Error(errors.map((issue) => formatDiagnostic(palette, 'error', issue)).join('\n\n'))
  }
}

/** Builds a query-appended URL, taking into account the result of calling the existing renderBuiltUrl */
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
    throwIssue(palette, userHookReturnedObjectIssue())
  }

  const url =
    typeof fromUserHook === 'string' ? fromUserHook : joinUrlSegments(config.base, filename)

  return appendQueryToBuiltUrl(url, query)
}
