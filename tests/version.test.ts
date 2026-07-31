import { describe, expect, test } from 'vitest'

import { formatTimestamp, resolveVersion } from '../src/version'

// ローカル時刻の 2026-07-30 22:09
const fixedDate = new Date(2026, 6, 30, 22, 9)

describe('formatTimestamp', () => {
  test('YYYYMMDDHHmm の 12 桁を返す', () => {
    expect(formatTimestamp(fixedDate)).toBe('202607302209')
  })

  test('1 桁の月日時分をゼロ埋めする', () => {
    expect(formatTimestamp(new Date(2026, 0, 5, 3, 4))).toBe('202601050304')
  })
})

describe('resolveVersion', () => {
  test('文字列をそのまま返す', async () => {
    await expect(resolveVersion('abc')).resolves.toBe('abc')
  })

  test('同期関数の戻り値を返す', async () => {
    await expect(resolveVersion(() => 'abc')).resolves.toBe('abc')
  })

  test('非同期関数の戻り値を返す', async () => {
    await expect(resolveVersion(async () => 'abc')).resolves.toBe('abc')
  })

  test('未指定ならタイムスタンプにフォールバックする', async () => {
    await expect(resolveVersion(undefined, fixedDate)).resolves.toBe('202607302209')
  })

  test('関数が undefined を返したらタイムスタンプにフォールバックする', async () => {
    await expect(resolveVersion(() => undefined, fixedDate)).resolves.toBe('202607302209')
  })

  test('関数が空文字を返したらタイムスタンプにフォールバックする', async () => {
    await expect(resolveVersion(() => '', fixedDate)).resolves.toBe('202607302209')
  })
})
