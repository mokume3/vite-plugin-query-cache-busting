import { fileURLToPath } from 'node:url'

import type { Plugin } from 'vite'
import { describe, expect, test } from 'vitest'

import { buildFixture, expectAllReferencesBusted } from '../helpers/build'

const basicRoot = fileURLToPath(new URL('../fixtures/basic', import.meta.url))

describe('非対応構成', () => {
  test('相対 base はビルドを落とす', async () => {
    await expect(buildFixture(basicRoot, { version: 'testver' }, { base: './' })).rejects.toThrow(
      /相対 base/,
    )
  })

  test('ライブラリモードはビルドを落とす', async () => {
    await expect(
      buildFixture(
        basicRoot,
        { version: 'testver' },
        {
          build: {
            lib: {
              entry: fileURLToPath(new URL('../fixtures/basic/src/shared.ts', import.meta.url)),
              formats: ['es'],
            },
          },
        },
      ),
    ).rejects.toThrow(/build\.lib/)
  })

  test('renderBuiltUrl を上書きするプラグインがあればビルドを落とす', async () => {
    const hijacker: Plugin = {
      name: 'hijacker',
      enforce: 'post',
      config() {
        return { experimental: { renderBuiltUrl: () => undefined } }
      },
    }

    await expect(
      buildFixture(basicRoot, { version: 'testver' }, { plugins: [hijacker] }),
    ).rejects.toThrow(/renderBuiltUrl/)
  })

  test('key に "=" を含めるとエラー', async () => {
    // buildFixture は async なので、同期 throw も rejected promise として届く
    await expect(buildFixture(basicRoot, { key: 'a=b' })).rejects.toThrow(/key/)
  })

  test('利用者が [hash] 付きのファイル名パターンを指定するとビルドを落とす', async () => {
    await expect(
      buildFixture(
        basicRoot,
        { version: 'testver' },
        {
          build: { rollupOptions: { output: { entryFileNames: 'assets/[name]-[hash].js' } } },
        },
      ),
    ).rejects.toThrow(/\[hash\]/)
  })

  test('利用者が [hash] 無しのパターンを指定した場合は尊重する', async () => {
    const files = await buildFixture(
      basicRoot,
      { version: 'testver' },
      {
        build: { rollupOptions: { output: { entryFileNames: 'js/[name].js' } } },
      },
    )

    expect(files.some((file) => file.fileName === 'js/index.js')).toBe(true)
    expectAllReferencesBusted(files, 'v=testver')
  })

  test('output が配列ならビルドを落とす', async () => {
    await expect(
      buildFixture(
        basicRoot,
        { version: 'testver' },
        {
          build: { rollupOptions: { output: [{ entryFileNames: 'assets/[name].js' }] } },
        },
      ),
    ).rejects.toThrow(/output/)
  })
})
