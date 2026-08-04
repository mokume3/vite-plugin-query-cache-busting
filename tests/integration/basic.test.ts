import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { buildFixture, expectAllReferencesBusted, filesByExtension } from '../helpers/build'

const basicRoot = fileURLToPath(new URL('../fixtures/basic', import.meta.url))
const query = 'v=testver'

describe('basic fixture', () => {
  test('出力ファイル名にハッシュが付かない', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })

    expect(files.map((file) => file.fileName).toSorted()).toEqual([
      'assets/index.css',
      'assets/index.js',
      'assets/lazy.css',
      'assets/lazy.js',
      'assets/logo.svg',
      'index.html',
    ])
  })

  test('HTML の script と link に query が付く', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })
    const html = filesByExtension(files, '.html')[0]

    expect(html).toBeDefined()
    expect(html?.content).toMatch(/<script[^>]+src="\/assets\/[\w.-]+\.js\?v=testver"/)
    expect(html?.content).toMatch(/<link[^>]+href="\/assets\/[\w.-]+\.css\?v=testver"/)
  })

  test('srcset のカンマ区切り両候補に query が付く', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })
    const html = filesByExtension(files, '.html')[0]

    expect(html?.content).toMatch(
      /srcset="\/assets\/[\w.-]+\.svg\?v=testver, \/assets\/[\w.-]+\.svg\?v=testver 2x"/,
    )
    expectAllReferencesBusted(files, query)
  })

  test('CSS の url() に query が付く', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })
    const css = filesByExtension(files, '.css')
      .map((file) => file.content)
      .join('\n')

    expect(css).toMatch(/url\(\s*["']?\/assets\/[\w.-]+\.svg\?v=testver/)
  })

  test('チャンク間の import に query が付く', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })
    const js = filesByExtension(files, '.js')
      .map((file) => file.content)
      .join('\n')

    expect(js).toMatch(/from\s*["']\.\/[\w.-]+\.js\?v=testver["']/)
    expect(js).toMatch(/import\(["']\.\/[\w.-]+\.js\?v=testver["']\)/)
  })

  test('minify 有効時もチャンク間の動的 import に query が付く（esbuild が引数を TemplateLiteral にすることがある）', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' }, { build: { minify: true } })
    const js = filesByExtension(files, '.js')
      .map((file) => file.content)
      .join('\n')

    expect(js).toMatch(/import\(["'`]\.\/[\w.-]+\.js\?v=testver["'`]\)/)
    expectAllReferencesBusted(files, query)
  })

  test('__vitePreload の依存配列に query が付く', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })
    const js = filesByExtension(files, '.js')
      .map((file) => file.content)
      .join('\n')

    expect(js).toMatch(/["']\/assets\/[\w.-]+\.css\?v=testver["']/)
  })

  // oxlint-disable-next-line vitest/expect-expect -- assertion happens inside expectAllReferencesBusted
  test('query 未付与の参照が1件も残らない', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver' })

    expectAllReferencesBusted(files, query)
  })

  test('key: false なら裸のクエリになる', async () => {
    const files = await buildFixture(basicRoot, { version: 'testver', key: false })
    const html = filesByExtension(files, '.html')[0]

    expect(html?.content).toMatch(/\.js\?testver"/)
    expectAllReferencesBusted(files, 'testver')
  })

  test('絶対 URL の base（CDN）でも script src に query が付く', async () => {
    const files = await buildFixture(
      basicRoot,
      { version: 'testver' },
      { base: 'https://cdn.example.com/' },
    )
    const html = filesByExtension(files, '.html')[0]

    expect(html?.content).toMatch(
      /<script[^>]+src="https:\/\/cdn\.example\.com\/assets\/[\w.-]+\.js\?v=testver"/,
    )
    expectAllReferencesBusted(files, query)
  })

  test('version 以外はビルド間で差分が出ない（書き換えが決定的）', async () => {
    const first = await buildFixture(basicRoot, { version: 'aaa' })
    const second = await buildFixture(basicRoot, { version: 'bbb' })

    expect(first.map((file) => file.fileName)).toEqual(second.map((file) => file.fileName))

    for (const [index, file] of first.entries()) {
      expect(file.content.replaceAll('v=aaa', 'v=QUERY')).toBe(
        second[index]?.content.replaceAll('v=bbb', 'v=QUERY'),
      )
    }
  })

  test('renderBuiltUrl が query 付き URL を返しても未付与と誤検知しない', async () => {
    const files = await buildFixture(
      basicRoot,
      { version: 'testver' },
      {
        experimental: {
          renderBuiltUrl: (filename: string) => `https://cdn.example.com/${filename}?token=xyz`,
        },
      },
    )
    const html = filesByExtension(files, '.html')[0]

    expect(html?.content).toMatch(
      /<script[^>]+src="https:\/\/cdn\.example\.com\/assets\/[\w.-]+\.js\?token=xyz&(amp;)?v=testver"/,
    )
    expectAllReferencesBusted(files, query)
  })
})
