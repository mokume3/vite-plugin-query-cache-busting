import { Ansis } from 'ansis'
import type { Plugin, ResolvedConfig, Rollup, UserConfig } from 'vite'

import { PLUGIN_NAME } from './constants'
import type { FileNamesDecision } from './file-names'
import { runGenerateBundleStep } from './generate-bundle'
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

interface PluginState {
  query: string
  config: ResolvedConfig
  userRenderBuiltUrl: RenderBuiltUrl | undefined
  fileNames: FileNamesDecision
  workerFileNames: FileNamesDecision
  workerKey: WorkerOutputKey
  wrapperCalled: boolean
}

function createInitialState(): PluginState {
  return {
    query: '',
    // configResolved より前には参照されない前提（Vite のフック呼び出し順序に依存）。
    config: undefined as unknown as ResolvedConfig,
    userRenderBuiltUrl: undefined,
    fileNames: { patch: {}, hashed: [], unverifiable: [] },
    workerFileNames: { patch: {}, hashed: [], unverifiable: [] },
    workerKey: 'rolldownOptions',
    wrapperCalled: false,
  }
}

/** config フック本体。query の確定と出力ファイル名パッチの決定を行い、次のフックのために state に控える */
async function handleConfig(
  state: PluginState,
  palette: Palette,
  resolved: ResolvedOptions,
  renderBuiltUrl: RenderBuiltUrl,
  userConfig: UserConfig,
): Promise<Partial<UserConfig>> {
  state.userRenderBuiltUrl = userConfig.experimental?.renderBuiltUrl
  state.query = buildQuery(resolved.key, await resolveVersion(resolved.version))

  const decided = decideOutputFileNames(palette, userConfig)
  state.fileNames = decided.fileNames
  state.workerFileNames = decided.workerFileNames
  state.workerKey = decided.workerKey

  return {
    environments: decided.environments,
    worker: decided.worker,
    experimental: { renderBuiltUrl },
  }
}

/** configResolved フック本体。確定した設定を state に控え、非対応構成を検査する */
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
  )
}

/** generateBundle フック本体。手前で server 環境を弾いた後に呼ばれる想定 */
function handleGenerateBundle(
  state: PluginState,
  palette: Palette,
  verifyMode: ResolvedOptions['verify'],
  outputOptions: Rollup.NormalizedOutputOptions,
  bundle: Rollup.OutputBundle,
): void {
  runGenerateBundleStep(
    palette,
    state.config,
    verifyMode,
    outputOptions,
    bundle,
    state.wrapperCalled,
    state.query,
  )
}

export function queryCacheBusting(options: Options = {}): Plugin {
  const resolved = normalizeOptions(options)
  const palette = createPalette(new Ansis())
  const state = createInitialState()

  const renderBuiltUrl: RenderBuiltUrl = (filename, context) => {
    state.wrapperCalled = true
    return resolveBuiltUrl(
      palette,
      state.config,
      state.userRenderBuiltUrl,
      state.query,
      filename,
      context,
    )
  }

  return {
    name: PLUGIN_NAME,
    apply: 'build',
    enforce: 'post',

    config: (userConfig) => handleConfig(state, palette, resolved, renderBuiltUrl, userConfig),

    configResolved: (resolvedConfig) =>
      handleConfigResolved(state, palette, renderBuiltUrl, resolvedConfig),

    // vite:build-import-analysis の __vitePreload 依存配列解決（指定子文字列で bundle を
    // 引く）より後に import を書き換える必要があるため order: 'post' にしている。
    generateBundle: {
      order: 'post',
      handler(outputOptions, bundle) {
        if (this.environment?.config.consumer === 'server') return
        handleGenerateBundle(state, palette, resolved.verify, outputOptions, bundle)
      },
    },
  }
}

export default queryCacheBusting
