import { describe, expect, test } from 'vitest'

import { rewriteImports } from '../src/rewrite-imports'

const rewrite = (code: string): string | null =>
  rewriteImports(code, 'v=1', 'chunk.js')?.code ?? null

describe('rewriteImports', () => {
  test('静的 import を書き換える', () => {
    expect(rewrite('import a from "./dep.js"')).toBe('import a from "./dep.js?v=1"')
  })

  test('名前付き re-export を書き換える', () => {
    expect(rewrite('export { b } from "./dep.js"')).toBe('export { b } from "./dep.js?v=1"')
  })

  test('全体 re-export を書き換える', () => {
    expect(rewrite('export * from "./dep.js"')).toBe('export * from "./dep.js?v=1"')
  })

  test('動的 import を書き換える', () => {
    expect(rewrite('const p = import("./dep.js")')).toBe('const p = import("./dep.js?v=1")')
  })

  test('関数の中の動的 import も書き換える', () => {
    expect(rewrite('function load() { return import("../a/dep.js") }')).toBe(
      'function load() { return import("../a/dep.js?v=1") }',
    )
  })

  test('絶対パスの指定子を書き換える', () => {
    expect(rewrite('import a from "/assets/dep.js"')).toBe('import a from "/assets/dep.js?v=1"')
  })

  test('複数の指定子をすべて書き換える', () => {
    const result = rewriteImports(
      'import a from "./a.js"\nimport b from "./b.js"\n',
      'v=1',
      'chunk.js',
    )

    expect(result?.count).toBe(2)
    expect(result?.code).toBe('import a from "./a.js?v=1"\nimport b from "./b.js?v=1"\n')
  })

  test('ベア指定子は書き換えない', () => {
    expect(rewrite('import a from "react"')).toBeNull()
  })

  test('外部 URL は書き換えない', () => {
    expect(rewrite('import a from "https://cdn.example.com/dep.js"')).toBeNull()
  })

  test('プロトコル相対 URL は書き換えない', () => {
    expect(rewrite('import a from "//cdn.example.com/dep.js"')).toBeNull()
  })

  test('変数を渡す動的 import は書き換えない', () => {
    expect(rewrite('const p = import(name)')).toBeNull()
  })

  test('式展開のない TemplateLiteral の動的 import を書き換える（esbuild minify 後の形）', () => {
    expect(rewrite('const p = import(`./dep.js`)')).toBe('const p = import("./dep.js?v=1")')
  })

  test('式展開のある TemplateLiteral の動的 import は書き換えない', () => {
    expect(rewrite('const p = import(`./${name}.js`)')).toBeNull()
  })

  test('source を持たない export は書き換えない', () => {
    expect(rewrite('const c = 1\nexport { c }')).toBeNull()
  })

  test('import 位置以外の文字列は書き換えない', () => {
    expect(rewrite('const s = "./dep.js"\n// see ./dep.js\n')).toBeNull()
  })

  test('書き換えが無ければ null を返す', () => {
    expect(rewriteImports('const a = 1', 'v=1', 'chunk.js')).toBeNull()
  })

  test('sourcemap を生成する', () => {
    const result = rewriteImports('import a from "./dep.js"', 'v=1', 'chunk.js')

    expect(result?.map.mappings.length).toBeGreaterThan(0)
    expect(result?.map.sources).toContain('chunk.js')
  })
})
