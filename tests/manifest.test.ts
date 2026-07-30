import { describe, expect, test } from 'vitest'

import { rewriteManifest } from '../src/manifest'

const parse = (source: string): Record<string, Record<string, unknown>> =>
  JSON.parse(source) as Record<string, Record<string, unknown>>

describe('rewriteManifest', () => {
  test('file に query を付与する', () => {
    const source = JSON.stringify({ 'src/main.ts': { file: 'assets/main.js', isEntry: true } })

    expect(parse(rewriteManifest(source, 'v=1'))['src/main.ts']?.file).toBe('assets/main.js?v=1')
  })

  test('css と assets の各要素に query を付与する', () => {
    const source = JSON.stringify({
      'src/main.ts': {
        file: 'assets/main.js',
        css: ['assets/main.css'],
        assets: ['assets/logo.svg'],
      },
    })
    const entry = parse(rewriteManifest(source, 'v=1'))['src/main.ts']

    expect(entry?.css).toEqual(['assets/main.css?v=1'])
    expect(entry?.assets).toEqual(['assets/logo.svg?v=1'])
  })

  test('imports と dynamicImports は書き換えない（manifest のキーであってパスではない）', () => {
    const source = JSON.stringify({
      'src/main.ts': {
        file: 'assets/main.js',
        imports: ['_shared.js'],
        dynamicImports: ['src/lazy.ts'],
      },
    })
    const entry = parse(rewriteManifest(source, 'v=1'))['src/main.ts']

    expect(entry?.imports).toEqual(['_shared.js'])
    expect(entry?.dynamicImports).toEqual(['src/lazy.ts'])
  })

  test('src とその他のフィールドは書き換えない', () => {
    const source = JSON.stringify({
      'src/main.ts': { file: 'assets/main.js', src: 'src/main.ts', isEntry: true },
    })
    const entry = parse(rewriteManifest(source, 'v=1'))['src/main.ts']

    expect(entry?.src).toBe('src/main.ts')
    expect(entry?.isEntry).toBe(true)
  })

  test('複数エントリをすべて書き換える', () => {
    const source = JSON.stringify({
      'src/a.ts': { file: 'assets/a.js' },
      'src/b.ts': { file: 'assets/b.js' },
    })
    const manifest = parse(rewriteManifest(source, 'v=1'))

    expect(manifest['src/a.ts']?.file).toBe('assets/a.js?v=1')
    expect(manifest['src/b.ts']?.file).toBe('assets/b.js?v=1')
  })

  test('2 スペースインデントの JSON を返す', () => {
    const source = JSON.stringify({ 'src/main.ts': { file: 'assets/main.js' } })

    expect(rewriteManifest(source, 'v=1')).toContain('\n  "src/main.ts"')
  })
})
