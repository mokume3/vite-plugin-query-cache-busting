import { Ansis } from 'ansis'
import type { Plugin, ResolvedConfig } from 'vite'

import { PLUGIN_NAME } from './constants'
import type { FileNamesDecision } from './file-names'
import { createPalette } from './logger'
import { normalizeOptions, type Options } from './options'
import {
  applyResolvedConfigIssues,
  collectOutputFiles,
  decideOutputFileNames,
  detectApiDrift,
  logSummary,
  type RenderBuiltUrl,
  resolveBuiltUrl,
  resolveManifestTarget,
  rewriteChunkImports,
  rewriteManifestOutput,
  verifyOutput,
} from './plugin-steps'
import { buildQuery } from './url'
import { resolveVersion } from './version'

export type { Options, VerifyMode } from './options'

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
