import { describe, expect, test } from 'vitest'

import { normalizeOptions } from '../src/options'

describe('normalizeOptions', () => {
  test('未指定なら key は "v"、verify は "warn"', () => {
    expect(normalizeOptions()).toEqual({ version: undefined, key: 'v', verify: 'warn' })
  })

  test('指定した値をそのまま保持する', () => {
    expect(normalizeOptions({ version: 'abc', key: 'ver', verify: 'error' })).toEqual({
      version: 'abc',
      key: 'ver',
      verify: 'error',
    })
  })

  test('key: false を許可する', () => {
    expect(normalizeOptions({ key: false }).key).toBe(false)
  })

  test('version が空文字ならエラー', () => {
    expect(() => normalizeOptions({ version: '' })).toThrow(/version/)
  })

  test('key が空文字ならエラー', () => {
    expect(() => normalizeOptions({ key: '' })).toThrow(/key/)
  })

  test('key に "=" が含まれるとエラー', () => {
    expect(() => normalizeOptions({ key: 'a=b' })).toThrow(/key/)
  })

  test('key に空白が含まれるとエラー', () => {
    expect(() => normalizeOptions({ key: 'a b' })).toThrow(/key/)
  })

  test('verify が想定外の値ならエラー', () => {
    expect(() => normalizeOptions({ verify: 'loud' as never })).toThrow(/verify/)
  })

  test('エラーメッセージにプラグインのプレフィックスが入る', () => {
    expect(() => normalizeOptions({ key: '' })).toThrow(/\[query-cache-busting\]/)
  })
})
