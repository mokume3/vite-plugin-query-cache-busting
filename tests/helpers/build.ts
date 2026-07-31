import { build, mergeConfig, type InlineConfig } from 'vite'
import { expect } from 'vitest'

import queryCacheBusting from '../../src'
import type { Options } from '../../src'
import { findMissingQuery } from '../../src/verify'

export interface BuiltFile {
  fileName: string
  content: string
}

const MANIFEST_SUFFIX = 'manifest.json'

/** fixture をメモリ上でビルドして、出力ファイルの一覧を返す */
export async function buildFixture(
  root: string,
  options: Options = {},
  overrides: InlineConfig = {},
): Promise<BuiltFile[]> {
  const config = mergeConfig<InlineConfig, InlineConfig>(
    {
      root,
      base: '/',
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        assetsInlineLimit: 0,
      },
      plugins: [queryCacheBusting(options)],
    },
    overrides,
  )

  const result = await build(config)
  const bundles = (Array.isArray(result) ? result : [result]) as {
    output: ({ fileName: string } & (
      | { type: 'chunk'; code: string }
      | { type: 'asset'; source: string | Uint8Array }
    ))[]
  }[]

  const files: BuiltFile[] = []
  for (const bundle of bundles) {
    for (const output of bundle.output) {
      files.push({
        fileName: output.fileName,
        content: output.type === 'chunk' ? output.code : String(output.source),
      })
    }
  }

  return files
}

/** 出力中に query 未付与の参照が1件も無いことを検証する */
export function expectAllReferencesBusted(files: BuiltFile[], query: string): void {
  const scanned = files.filter((file) => !file.fileName.endsWith(MANIFEST_SUFFIX))
  const names = scanned.map((file) => file.fileName)

  expect(findMissingQuery(scanned, names, query)).toEqual([])
}

/** 拡張子で出力ファイルを絞り込む */
export function filesByExtension(files: BuiltFile[], extension: string): BuiltFile[] {
  return files.filter((file) => file.fileName.endsWith(extension))
}

/** promise が reject する前提でそのエラーメッセージを返す（reject しなければ落とす） */
export async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('promise が reject しませんでした')
}

export interface ManifestEntry {
  file: string
  css?: string[]
  assets?: string[]
  imports?: string[]
  dynamicImports?: string[]
}

/** 出力から manifest を読む。無ければ落とす（既定値で素通りさせない） */
export function readManifest(files: BuiltFile[]): Record<string, ManifestEntry> {
  const manifest = files.find((file) => file.fileName.endsWith(MANIFEST_SUFFIX))

  if (manifest === undefined) {
    throw new Error('manifest.json が出力されていません')
  }

  return JSON.parse(manifest.content) as Record<string, ManifestEntry>
}

const SSR_MANIFEST_FILE_NAME = '.vite/ssr-manifest.json'

/** 出力から ssr-manifest を読む。無ければ落とす（既定値で素通りさせない） */
export function readSsrManifest(files: BuiltFile[]): Record<string, unknown> {
  const manifest = files.find((file) => file.fileName === SSR_MANIFEST_FILE_NAME)

  if (manifest === undefined) {
    throw new Error('ssr-manifest.json が出力されていません')
  }

  return JSON.parse(manifest.content) as Record<string, unknown>
}

/** manifest 全エントリの imports / dynamicImports のキーを集める */
export function collectManifestImportKeys(manifest: Record<string, ManifestEntry>): string[] {
  const keys: string[] = []

  for (const entry of Object.values(manifest)) {
    keys.push(...(entry.imports ?? []), ...(entry.dynamicImports ?? []))
  }

  return keys
}
