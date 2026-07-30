import { Ansis } from 'ansis'
import type { Plugin, ResolvedConfig, UserConfig } from 'vite'
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
import { createPalette, formatFindings, formatIssue, formatSummary } from './logger'
import { rewriteManifest } from './manifest'
import { normalizeOptions, type Options } from './options'
import { rewriteImports } from './rewrite-imports'
import { appendQuery, buildQuery, joinUrlSegments } from './url'
import { findMissingQuery, isTrackedName, type OutputFile } from './verify'
import { resolveVersion } from './version'

export type { Options, VerifyMode } from './options'

type RenderBuiltUrl = NonNullable<NonNullable<UserConfig['experimental']>['renderBuiltUrl']>

const DEFAULT_MANIFEST_FILE_NAME = '.vite/manifest.json'
const DEFAULT_ASSETS_DIR = 'assets'

export function queryCacheBusting(options: Options = {}): Plugin {
  const resolved = normalizeOptions(options)
  const palette = createPalette(new Ansis())

  let query = ''
  let config: ResolvedConfig
  let userRenderBuiltUrl: RenderBuiltUrl | undefined
  let fileNames: FileNamesDecision = { patch: {}, hashed: [], unverifiable: [] }
  let wrapperCalled = false

  const renderBuiltUrl: RenderBuiltUrl = (filename, context) => {
    wrapperCalled = true

    if (context.ssr) return userRenderBuiltUrl?.(filename, context)

    const fromUserHook = userRenderBuiltUrl?.(filename, context)
    if (typeof fromUserHook === 'object' && fromUserHook !== null) {
      throw new Error(formatIssue(palette, 'error', userHookReturnedObjectIssue()))
    }

    const url =
      typeof fromUserHook === 'string' ? fromUserHook : joinUrlSegments(config.base, filename)

    return appendQuery(url, query)
  }

  return {
    name: PLUGIN_NAME,
    apply: 'build',
    enforce: 'post',

    async config(userConfig) {
      userRenderBuiltUrl = userConfig.experimental?.renderBuiltUrl
      query = buildQuery(resolved.key, await resolveVersion(resolved.version))

      const userOutput = userConfig.build?.rollupOptions?.output
      if (Array.isArray(userOutput)) {
        throw new Error(formatIssue(palette, 'error', multipleOutputsIssue()))
      }

      fileNames = decideFileNames(
        (userOutput ?? {}) as Record<string, unknown>,
        userConfig.build?.assetsDir ?? DEFAULT_ASSETS_DIR,
      )

      return {
        build: { rollupOptions: { output: fileNames.patch } },
        experimental: { renderBuiltUrl },
      }
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig

      const { errors, warnings } = collectConfigIssues({
        base: resolvedConfig.base,
        isLib: Boolean(resolvedConfig.build.lib),
        chunkImportMap: Boolean(
          (resolvedConfig.build as { chunkImportMap?: unknown }).chunkImportMap,
        ),
        viteMajor: parseMajor(viteVersion),
      })

      if (resolvedConfig.experimental.renderBuiltUrl !== renderBuiltUrl) {
        errors.push(hijackedRenderBuiltUrlIssue())
      }

      if (fileNames.hashed.length > 0) {
        errors.push(hashedFileNamePatternIssue(fileNames.hashed))
      }

      if (fileNames.unverifiable.length > 0) {
        warnings.push(unverifiableFileNamePatternIssue(fileNames.unverifiable))
      }

      for (const warning of warnings) {
        resolvedConfig.logger.warn(formatIssue(palette, 'warn', warning))
      }

      if (errors.length > 0) {
        throw new Error(errors.map((issue) => formatIssue(palette, 'error', issue)).join('\n\n'))
      }
    },

    // Vite の vite:build-import-analysis は __vitePreload の依存配列を generateBundle で
    // 解決する。その解決は動的 import の指定子を手がかりに bundle のキーを引くため、
    // 指定子を先に書き換えると依存配列が空になり、遅延チャンクの CSS がどこからも
    // 参照されなくなる。order: 'post' で Vite の処理が終わった後に書き換える。
    generateBundle: {
      order: 'post',
      handler(outputOptions, bundle) {
        if (this.environment?.config.consumer === 'server') return

        const manifestOption = config.build.manifest
        const manifestFileName =
          typeof manifestOption === 'string' ? manifestOption : DEFAULT_MANIFEST_FILE_NAME

        const hasRenderableAssets = Object.values(bundle).some(
          (output) =>
            output.type === 'asset' &&
            isTrackedName(output.fileName) &&
            !output.fileName.endsWith('.json'),
        )

        if (!wrapperCalled && hasRenderableAssets) {
          throw new Error(formatIssue(palette, 'error', apiDriftIssue()))
        }

        if (outputOptions.format === 'es') {
          for (const output of Object.values(bundle)) {
            if (output.type !== 'chunk') continue

            const result = rewriteImports(output.code, query, output.fileName)
            if (result !== null) output.code = result.code
          }
        } else {
          config.logger.warn(
            formatIssue(palette, 'warn', nonEsFormatIssue(String(outputOptions.format))),
          )
        }

        if (manifestOption === true || typeof manifestOption === 'string') {
          const manifest = bundle[manifestFileName]
          if (manifest === undefined || manifest.type !== 'asset') {
            throw new Error(formatIssue(palette, 'error', manifestMissingIssue(manifestFileName)))
          }
          manifest.source = rewriteManifest(String(manifest.source), query)
        }

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

        if (resolved.verify !== 'off') {
          const findings = findMissingQuery(files, referenceNames, query)

          if (findings.length > 0) {
            const level = resolved.verify === 'error' ? 'error' : 'warn'
            const message = formatFindings(palette, level, findings)

            if (level === 'error') throw new Error(message)
            config.logger.warn(message)
          }
        }

        config.logger.info(formatSummary(palette, query, countByExtension(files, query)))
      },
    },
  }
}

export default queryCacheBusting

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
