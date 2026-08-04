import { fileURLToPath } from 'node:url'

import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { describe, expect, test } from 'vitest'

import { buildFixture, type BuiltFile } from '../helpers/build'

const basicRoot = fileURLToPath(new URL('../fixtures/basic', import.meta.url))

function findMappedLazyChunk(files: BuiltFile[]) {
  const chunk = files.find((file) => file.fileName.endsWith('/lazy.js'))
  if (chunk === undefined || chunk.map === null || chunk.map === undefined) {
    throw new Error('lazy.js の sourcemap が出力されていません')
  }
  return { ...chunk, map: chunk.map }
}

describe('sourcemap', () => {
  test('sourcemap 有効時にチャンクの map が出力される', async () => {
    const files = await buildFixture(
      basicRoot,
      { version: 'testver' },
      { build: { sourcemap: true, minify: true } },
    )
    const chunks = files.filter((file) => file.fileName.endsWith('.js'))

    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.map).toBeTruthy()
    }
  })

  test('query 挿入後のコード位置を元ソースへ正しく対応付ける', async () => {
    const files = await buildFixture(
      basicRoot,
      { version: 'testver' },
      { build: { sourcemap: true, minify: true } },
    )
    const lazyChunk = findMappedLazyChunk(files)

    const generatedColumn = lazyChunk.content.indexOf('var t')
    expect(generatedColumn).toBeGreaterThanOrEqual(0)

    const original = originalPositionFor(new TraceMap(lazyChunk.map), {
      line: 1,
      column: generatedColumn,
    })
    expect(original).toMatchObject({
      source: '../../src/lazy.ts',
      line: 4,
      column: 0,
    })
  })
})
