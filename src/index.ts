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
    // Assumes this is never read before configResolved (relies on Vite's hook call order).
    config: undefined as unknown as ResolvedConfig,
    userRenderBuiltUrl: undefined,
    fileNames: { patch: {}, hashed: [], unverifiable: [] },
    workerFileNames: { patch: {}, hashed: [], unverifiable: [] },
    workerKey: 'rolldownOptions',
    wrapperCalled: false,
  }
}

/** Body of the config hook. Resolves the query and decides the output filename patch, storing both in state for the next hook */
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

/** Body of the configResolved hook. Stores the resolved config in state and checks for unsupported configurations */
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

/** Body of the generateBundle hook. Expected to be called after the server environment has already been filtered out */
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

    // order: 'post' because import rewriting must happen after
    // vite:build-import-analysis resolves the __vitePreload dependency array
    // (which looks up the bundle by specifier string).
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
