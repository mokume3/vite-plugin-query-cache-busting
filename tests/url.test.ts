import { describe, expect, test } from 'vitest'

import { appendQuery, buildQuery, joinUrlSegments } from '../src/url'

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
