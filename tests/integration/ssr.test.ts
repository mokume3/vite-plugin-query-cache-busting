import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { buildFixture } from '../helpers/build'

const basicRoot = fileURLToPath(new URL('../fixtures/basic', import.meta.url))

describe('SSR ビルド（対象外の環境）', () => {
  test('SSR ビルドの出力ファイル名を書き換えない（プラグイン無しと同じ形のまま）', async () => {
    const files = await buildFixture(
      basicRoot,
      { version: 'testver' },
      { build: { ssr: 'src/main.ts' } },
    )

    // プラグイン無しなら SSR エントリはハッシュ無しの `main.js`。
    // build.rollupOptions.output を無条件でパッチすると `assets/main.js` に化ける。
    expect(files.some((file) => file.fileName === 'main.js')).toBe(true)
    expect(files.some((file) => file.fileName === 'assets/main.js')).toBe(false)

    // 動的 import チャンクも `assets/[name]-[hash].js` のまま（[hash] が外れない）。
    expect(files.some((file) => /^assets\/lazy-[\w-]+\.js$/.test(file.fileName))).toBe(true)
    expect(files.some((file) => file.fileName === 'assets/lazy.js')).toBe(false)
  })
})
