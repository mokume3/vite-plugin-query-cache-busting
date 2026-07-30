import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { buildFixture, expectAllReferencesBusted, filesByExtension } from '../helpers/build'

const root = fileURLToPath(new URL('../fixtures/multi-entry', import.meta.url))

const multiEntryOverrides = {
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('../fixtures/multi-entry/index.html', import.meta.url)),
        about: fileURLToPath(new URL('../fixtures/multi-entry/about.html', import.meta.url)),
      },
    },
  },
}

describe('multi-entry fixture', () => {
  test('すべての HTML の script に query が付く', async () => {
    const files = await buildFixture(root, { version: 'testver' }, multiEntryOverrides)
    const htmlFiles = filesByExtension(files, '.html')

    expect(htmlFiles).toHaveLength(2)

    for (const html of htmlFiles) {
      expect(html.content).toMatch(/<script[^>]+src="\/assets\/[\w.-]+\.js\?v=testver"/)
    }
  })

  // oxlint-disable-next-line vitest/expect-expect -- assertion happens inside expectAllReferencesBusted
  test('query 未付与の参照が1件も残らない', async () => {
    const files = await buildFixture(root, { version: 'testver' }, multiEntryOverrides)

    expectAllReferencesBusted(files, 'v=testver')
  })
})
