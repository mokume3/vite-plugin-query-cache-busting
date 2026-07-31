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
import { formatIssue, type Palette } from './logger'
import { appendQueryToBuiltUrl, joinUrlSegments } from './url'

export type RenderBuiltUrl = NonNullable<NonNullable<UserConfig['experimental']>['renderBuiltUrl']>
type RenderBuiltUrlContext = Parameters<RenderBuiltUrl>[1]

const DEFAULT_ASSETS_DIR = 'assets'

function throwIssue(palette: Palette, issue: Parameters<typeof formatIssue>[2]): never {
  throw new Error(formatIssue(palette, 'error', issue))
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
    resolvedConfig.logger.warn(formatIssue(palette, 'warn', warning))
  }

  if (errors.length > 0) {
    throw new Error(errors.map((issue) => formatIssue(palette, 'error', issue)).join('\n\n'))
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
    throw new Error(formatIssue(palette, 'error', userHookReturnedObjectIssue()))
  }

  const url =
    typeof fromUserHook === 'string' ? fromUserHook : joinUrlSegments(config.base, filename)

  return appendQueryToBuiltUrl(url, query)
}
