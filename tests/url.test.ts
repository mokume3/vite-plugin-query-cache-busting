import { describe, expect, test } from 'vitest'

import {
  appendQuery,
  appendQueryToBuiltUrl,
  buildQuery,
  countQueryParams,
  hasQueryParam,
  joinUrlSegments,
} from '../src/url'

describe('appendQuery', () => {
  test('クエリが無い URL には ? で連結する', () => {
    expect(appendQuery('/assets/a.js', 'v=1')).toBe('/assets/a.js?v=1')
  })

  test('既にクエリがある URL には & で連結する', () => {
    expect(appendQuery('/assets/a.js?x=1', 'v=1')).toBe('/assets/a.js?x=1&v=1')
  })

  test('ハッシュフラグメントの手前に挿入する', () => {
    expect(appendQuery('/assets/a.css#top', 'v=1')).toBe('/assets/a.css?v=1#top')
  })

  test('クエリとフラグメントが両方ある場合も手前に挿入する', () => {
    expect(appendQuery('/a.css?x=1#top', 'v=1')).toBe('/a.css?x=1&v=1#top')
  })

  test('http/https の外部 URL は変更しない', () => {
    expect(appendQuery('https://cdn.example.com/a.js', 'v=1')).toBe('https://cdn.example.com/a.js')
  })

  test('プロトコル相対 URL は変更しない', () => {
    expect(appendQuery('//cdn.example.com/a.js', 'v=1')).toBe('//cdn.example.com/a.js')
  })

  test('data: URI は変更しない', () => {
    expect(appendQuery('data:image/svg+xml,%3Csvg%3E', 'v=1')).toBe('data:image/svg+xml,%3Csvg%3E')
  })

  test('blob: URL は変更しない', () => {
    expect(appendQuery('blob:http://localhost/abc', 'v=1')).toBe('blob:http://localhost/abc')
  })

  test('query が空文字なら変更しない', () => {
    expect(appendQuery('/assets/a.js', '')).toBe('/assets/a.js')
  })
})

describe('appendQueryToBuiltUrl', () => {
  test('http の URL にも query を付ける（CDN の base を想定）', () => {
    expect(appendQueryToBuiltUrl('https://cdn.example.com/assets/a.js', 'v=1')).toBe(
      'https://cdn.example.com/assets/a.js?v=1',
    )
  })

  test('プロトコル相対 URL にも query を付ける', () => {
    expect(appendQueryToBuiltUrl('//cdn.example.com/assets/a.js', 'v=1')).toBe(
      '//cdn.example.com/assets/a.js?v=1',
    )
  })

  test('data: URI は変更しない', () => {
    expect(appendQueryToBuiltUrl('data:image/svg+xml,%3Csvg%3E', 'v=1')).toBe(
      'data:image/svg+xml,%3Csvg%3E',
    )
  })

  test('blob: URL は変更しない', () => {
    expect(appendQueryToBuiltUrl('blob:http://localhost/abc', 'v=1')).toBe(
      'blob:http://localhost/abc',
    )
  })

  test('既にクエリがある URL には & で連結する', () => {
    expect(appendQueryToBuiltUrl('https://cdn.example.com/a.js?x=1', 'v=1')).toBe(
      'https://cdn.example.com/a.js?x=1&v=1',
    )
  })

  test('ハッシュフラグメントの手前に挿入する', () => {
    expect(appendQueryToBuiltUrl('https://cdn.example.com/a.css#top', 'v=1')).toBe(
      'https://cdn.example.com/a.css?v=1#top',
    )
  })

  test('query が空文字なら変更しない', () => {
    expect(appendQueryToBuiltUrl('https://cdn.example.com/a.js', '')).toBe(
      'https://cdn.example.com/a.js',
    )
  })
})

describe('buildQuery', () => {
  test('key ありならキー付きのクエリを返す', () => {
    expect(buildQuery('v', '202607302209')).toBe('v=202607302209')
  })

  test('key が false なら裸のクエリを返す', () => {
    expect(buildQuery(false, '202607302209')).toBe('202607302209')
  })

  test('version を URL エンコードする', () => {
    expect(buildQuery('v', 'a b')).toBe('v=a%20b')
  })

  test("encodeURIComponent が素通しする !~*'() もエンコードする", () => {
    expect(buildQuery('v', '1.0(beta)')).toBe('v=1.0%28beta%29')
  })

  test('key 側の記号もエンコードする', () => {
    expect(buildQuery("v'", '1')).toBe('v%27=1')
  })
})

describe('hasQueryParam', () => {
  test('? 直後に一致する query があれば true', () => {
    expect(hasQueryParam('/a.js?v=1"', 5, 'v=1')).toBe(true)
  })

  test('& で連結された query も検出する', () => {
    expect(hasQueryParam('/a.js?token=xyz&v=1"', 5, 'v=1')).toBe(true)
  })

  test('HTML エスケープされた &amp; も区切りとして扱う', () => {
    expect(hasQueryParam('/a.js?token=xyz&amp;v=1"', 5, 'v=1')).toBe(true)
  })

  test('前方一致は一致とみなさない', () => {
    expect(hasQueryParam('/a.js?v=10"', 5, 'v=1')).toBe(false)
  })

  test('query 文字列自体が無ければ false', () => {
    expect(hasQueryParam('/a.js"', 5, 'v=1')).toBe(false)
  })

  test('終端文字を越えて次の参照の query を見に行かない', () => {
    expect(hasQueryParam('/a.js" + "/b.js?v=1', 5, 'v=1')).toBe(false)
  })

  test('query が空文字なら false', () => {
    expect(hasQueryParam('/a.js?v=1"', 5, '')).toBe(false)
  })
})

describe('countQueryParams', () => {
  test('? 連結と & 連結の両方を数える', () => {
    expect(countQueryParams('"/a.js?v=1" "/b.js?x=1&v=1"', 'v=1')).toBe(2)
  })

  test('HTML エスケープされた &amp; の後ろも数える', () => {
    expect(countQueryParams('"/a.js?token=xyz&amp;v=1"', 'v=1')).toBe(1)
  })

  test('前方一致は数えない', () => {
    expect(countQueryParams('"/a.js?v=10"', 'v=1')).toBe(0)
  })

  test('query が空文字なら 0', () => {
    expect(countQueryParams('"/a.js?v=1"', '')).toBe(0)
  })
})

describe('joinUrlSegments', () => {
  test('base のスラッシュが重複しない', () => {
    expect(joinUrlSegments('/', 'assets/a.js')).toBe('/assets/a.js')
  })

  test('サブパスの base を結合できる', () => {
    expect(joinUrlSegments('/app/', 'assets/a.js')).toBe('/app/assets/a.js')
  })

  test('base に末尾スラッシュが無くても結合できる', () => {
    expect(joinUrlSegments('/app', '/assets/a.js')).toBe('/app/assets/a.js')
  })

  test('base が空なら path をそのまま返す', () => {
    expect(joinUrlSegments('', 'assets/a.js')).toBe('assets/a.js')
  })
})
