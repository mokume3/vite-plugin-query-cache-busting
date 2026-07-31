import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { buildFixture, expectAllReferencesBusted, filesByExtension } from '../helpers/build'

const root = fileURLToPath(new URL('../fixtures/worker', import.meta.url))

describe('worker fixture', () => {
  test('worker の出力ファイル名にもハッシュが付かない', async () => {
    const files = await buildFixture(root, { version: 'testver' })

    expect(files.map((file) => file.fileName).toSorted()).toEqual([
      'assets/index.js',
      'assets/worker.js',
      'index.html',
    ])
  })

  test('worker の URL に query が付く', async () => {
    const files = await buildFixture(root, { version: 'testver' })
    const js = filesByExtension(files, '.js')
      .map((file) => file.content)
      .join('\n')

    expect(js).toMatch(/["']\/assets\/[\w.-]+\.js\?v=testver["']/)
  })

  // oxlint-disable-next-line vitest/expect-expect -- assertion happens inside expectAllReferencesBusted
  test('query 未付与の参照が1件も残らない', async () => {
    const files = await buildFixture(root, { version: 'testver' })

    expectAllReferencesBusted(files, 'v=testver')
  })
})
