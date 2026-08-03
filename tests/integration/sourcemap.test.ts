import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { buildFixture } from '../helpers/build'

const basicRoot = fileURLToPath(new URL('../fixtures/basic', import.meta.url))

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
      expect(chunk.map?.mappings).toBeTruthy()
    }
  })
})
