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

/** Decides the environments.client/worker patch returned by the config hook, along with fileNames/workerFileNames for later use */
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
  // SSR is out of scope for this plugin. Patching build.rollupOptions.output unconditionally
  // would also affect SSR builds that don't inherit environments.client, so this only
  // writes to the client environment.
  const output =
    userConfig.environments?.client?.build?.rollupOptions?.output ??
    userConfig.build?.rollupOptions?.output
  const rolldownOutput = userConfig.worker?.rolldownOptions?.output
  const rollupOutput = userConfig.worker?.rollupOptions?.output

  // If only the deprecated rollupOptions has an output, write back to that instead
  const workerKey: WorkerOutputKey =
    rolldownOutput === undefined && rollupOutput !== undefined ? 'rollupOptions' : 'rolldownOptions'
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
    throw new Error(formatDiagnostic(palette, 'error', userHookReturnedObjectIssue()))
  }

  const url =
    typeof fromUserHook === 'string' ? fromUserHook : joinUrlSegments(config.base, filename)

  return appendQueryToBuiltUrl(url, query)
}
