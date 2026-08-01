import { Ansis } from 'ansis'
import { Diagnostic } from 'nostics'
import { describe, expect, test } from 'vitest'

import { createPalette, formatDiagnostic, formatSummary } from '../src/logger'

// 色レベルを 0 に固定して、色コードではなくメッセージの中身を検証する
const plain = createPalette(new Ansis(0))

describe('formatSummary', () => {
  test('付与件数と内訳を1行で返す', () => {
    expect(formatSummary(plain, 'v=202607302209', { js: 8, css: 3, html: 3 })).toBe(
      '[query-cache-busting] ?v=202607302209 を 14 件の参照に付与 (js 8, css 3, html 3)',
    )
  })

  test('内訳が空なら括弧を出さない', () => {
    expect(formatSummary(plain, 'v=1', {})).toBe('[query-cache-busting] ?v=1 を 0 件の参照に付与')
  })

  test('件数 0 の拡張子は内訳に出さない', () => {
    expect(formatSummary(plain, 'v=1', { js: 2, css: 0 })).toBe(
      '[query-cache-busting] ?v=1 を 2 件の参照に付与 (js 2)',
    )
  })
})

describe('formatDiagnostic', () => {
  test('fix があれば1行のツリーで表示する', () => {
    const diagnostic = new Diagnostic({
      code: 'QCB_RELATIVE_BASE',
      why: '相対 base には対応していません: base: "./"',
      fix: '絶対パスを指定してください。',
    })

    const message = formatDiagnostic(plain, 'error', diagnostic)

    expect(message).toBe(
      [
        '[QCB_RELATIVE_BASE] error  相対 base には対応していません: base: "./"',
        '╰▶ fix: 絶対パスを指定してください。',
      ].join('\n'),
    )
  })

  test('fix も sources も無ければ見出しだけを返す', () => {
    const diagnostic = new Diagnostic({ code: 'QCB_TEST', why: 'タイトル' })

    expect(formatDiagnostic(plain, 'warn', diagnostic)).toBe('[QCB_TEST] warn  タイトル')
  })

  test('fix と複数の sources をツリーで表示する', () => {
    const diagnostic = new Diagnostic({
      code: 'QCB_MISSING_QUERY',
      why: 'query 未付与の参照が 2 件あります',
      fix: "ソース中に文字列でハードコードされたパスの可能性があります。意図的な場合は verify: 'off' で抑制できます。",
      sources: ['assets/index.js:1:2043', 'assets/manifest.json:1:88'],
    })

    const message = formatDiagnostic(plain, 'warn', diagnostic)

    expect(message).toBe(
      [
        '[QCB_MISSING_QUERY] warn  query 未付与の参照が 2 件あります',
        "├▶ fix: ソース中に文字列でハードコードされたパスの可能性があります。意図的な場合は verify: 'off' で抑制できます。",
        '├▶ sources: assets/index.js:1:2043',
        '╰▶ sources: assets/manifest.json:1:88',
      ].join('\n'),
    )
  })
})

describe('createPalette', () => {
  test('色レベル 1 なら ANSI コードが付く', () => {
    const colored = createPalette(new Ansis(1))

    expect(colored.path('x')).not.toBe('x')
    expect(colored.path('x')).toContain('x')
  })
})
