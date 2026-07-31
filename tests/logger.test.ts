import { Ansis } from 'ansis'
import { describe, expect, test } from 'vitest'

import { createPalette, formatFindings, formatIssue, formatSummary } from '../src/logger'

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

describe('formatIssue', () => {
  test('タイトル・詳細・ヒントを整形する', () => {
    const message = formatIssue(plain, 'error', {
      title: '相対 base には対応していません',
      details: ["base: './'"],
      hints: ['絶対パスを指定してください。'],
    })

    expect(message).toBe(
      [
        '[query-cache-busting] error  相対 base には対応していません',
        '',
        "  base: './'",
        '',
        '  絶対パスを指定してください。',
      ].join('\n'),
    )
  })

  test('詳細が空なら詳細ブロックを出さない', () => {
    const message = formatIssue(plain, 'warn', {
      title: 'タイトル',
      details: [],
      hints: ['ヒント'],
    })

    expect(message).toBe(['[query-cache-busting] warn  タイトル', '', '  ヒント'].join('\n'))
  })
})

describe('formatFindings', () => {
  test('位置・スニペット・キャレットを整形する', () => {
    const message = formatFindings(plain, 'warn', [
      {
        file: 'assets/index.js',
        line: 1,
        column: 15,
        reference: 'assets/a.js',
        snippet: '<script src="/assets/a.js">',
        caretOffset: 14,
      },
    ])

    expect(message).toBe(
      [
        '[query-cache-busting] warn  query が付いていない参照が 1 件あります',
        '',
        '  assets/index.js:1:15',
        '    <script src="/assets/a.js">',
        '                  ^^^^^^^^^^^',
        '',
        '  ソース中に文字列でハードコードされたパスの可能性があります。',
        "  意図的な場合は verify: 'off' で抑制できます。",
      ].join('\n'),
    )
  })
})

describe('createPalette', () => {
  test('色レベル 1 なら ANSI コードが付く', () => {
    const colored = createPalette(new Ansis(1))

    expect(colored.bad('x')).not.toBe('x')
    expect(colored.bad('x')).toContain('x')
  })
})
