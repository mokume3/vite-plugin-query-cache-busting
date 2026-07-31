import { describe, expect, test } from 'vitest'

import { buildFileNames, containsHashPlaceholder, decideFileNames } from '../src/file-names'

describe('containsHashPlaceholder', () => {
  test('[hash] を検出する', () => {
    expect(containsHashPlaceholder('assets/[name]-[hash].js')).toBe(true)
  })

  test('桁数指定つきの [hash:8] も検出する', () => {
    expect(containsHashPlaceholder('assets/[name]-[hash:8].js')).toBe(true)
  })

  test('ハッシュを含まないパターンは false', () => {
    expect(containsHashPlaceholder('assets/[name].js')).toBe(false)
  })
})

describe('buildFileNames', () => {
  test('assetsDir を前置したパターンを返す', () => {
    expect(buildFileNames('assets')).toEqual({
      entryFileNames: 'assets/[name].js',
      chunkFileNames: 'assets/[name].js',
      assetFileNames: 'assets/[name].[ext]',
    })
  })

  test('assetsDir が空なら前置しない', () => {
    expect(buildFileNames('')).toEqual({
      entryFileNames: '[name].js',
      chunkFileNames: '[name].js',
      assetFileNames: '[name].[ext]',
    })
  })

  test('ネストした assetsDir も扱える', () => {
    expect(buildFileNames('static/build').entryFileNames).toBe('static/build/[name].js')
  })
})

describe('decideFileNames', () => {
  test('利用者指定が無ければ3つとも埋める', () => {
    const decision = decideFileNames({}, 'assets')

    expect(decision.patch).toEqual(buildFileNames('assets'))
    expect(decision.hashed).toEqual([])
    expect(decision.unverifiable).toEqual([])
  })

  test('利用者が指定したキーは patch に含めず、他のキーだけ埋める', () => {
    const decision = decideFileNames({ entryFileNames: 'js/[name].js' }, 'assets')

    expect(decision.patch.entryFileNames).toBeUndefined()
    expect(decision.patch.chunkFileNames).toBe('assets/[name].js')
    expect(decision.hashed).toEqual([])
  })

  test('利用者指定に [hash] があれば hashed に入れる', () => {
    const decision = decideFileNames({ entryFileNames: 'js/[name]-[hash].js' }, 'assets')

    expect(decision.hashed).toEqual(['entryFileNames'])
    expect(decision.patch.entryFileNames).toBeUndefined()
  })

  test('関数で指定されたキーは unverifiable に入れる', () => {
    const decision = decideFileNames({ assetFileNames: () => 'x' }, 'assets')

    expect(decision.unverifiable).toEqual(['assetFileNames'])
    expect(decision.patch.assetFileNames).toBeUndefined()
  })

  test('複数キーの [hash] をまとめて返す', () => {
    const decision = decideFileNames(
      { entryFileNames: '[name]-[hash].js', chunkFileNames: '[name]-[hash].js' },
      'assets',
    )

    expect(decision.hashed).toEqual(['entryFileNames', 'chunkFileNames'])
  })
})
