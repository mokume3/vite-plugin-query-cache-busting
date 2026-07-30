import { describe, expect, test } from 'vitest'

import {
  apiDriftIssue,
  collectConfigIssues,
  hashedFileNamePatternIssue,
  hijackedRenderBuiltUrlIssue,
  manifestMissingIssue,
  multipleOutputsIssue,
  nonEsFormatIssue,
  parseMajor,
  unverifiableFileNamePatternIssue,
  userHookReturnedObjectIssue,
} from '../src/guards'

const supported = { base: '/', isLib: false, chunkImportMap: false, viteMajor: 8 }

describe('parseMajor', () => {
  test('メジャーバージョンを取り出す', () => {
    expect(parseMajor('8.2.0')).toBe(8)
  })

  test('解釈できなければ 0 を返す', () => {
    expect(parseMajor('unknown')).toBe(0)
  })
})

describe('collectConfigIssues', () => {
  test('対応構成なら何も返さない', () => {
    expect(collectConfigIssues(supported)).toEqual({ errors: [], warnings: [] })
  })

  test('base が "./" ならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, base: './' })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.title).toMatch(/相対 base/)
    expect(errors[0]?.details.join('')).toMatch(/\.\//)
  })

  test('base が空文字ならエラー', () => {
    expect(collectConfigIssues({ ...supported, base: '' }).errors).toHaveLength(1)
  })

  test('base が "." 始まりならエラー', () => {
    expect(collectConfigIssues({ ...supported, base: '../x/' }).errors).toHaveLength(1)
  })

  test('ライブラリモードならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, isLib: true })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.title).toMatch(/build\.lib/)
  })

  test('chunkImportMap が有効ならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, chunkImportMap: true })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.title).toMatch(/chunkImportMap/)
  })

  test('Vite 7 以下ならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, viteMajor: 7 })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.title).toMatch(/Vite 8/)
  })

  test('Vite 9 以上なら警告', () => {
    const { errors, warnings } = collectConfigIssues({ ...supported, viteMajor: 9 })

    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.title).toMatch(/未検証/)
  })

  test('複数の非対応構成をまとめて返す', () => {
    expect(
      collectConfigIssues({ base: './', isLib: true, chunkImportMap: true, viteMajor: 8 }).errors,
    ).toHaveLength(3)
  })
})

describe('個別の Issue', () => {
  test('どの Issue も title と hints を持つ', () => {
    const issues = [
      hijackedRenderBuiltUrlIssue(),
      userHookReturnedObjectIssue(),
      apiDriftIssue(),
      nonEsFormatIssue('system'),
      manifestMissingIssue('.vite/manifest.json'),
      hashedFileNamePatternIssue(['entryFileNames']),
      unverifiableFileNamePatternIssue(['assetFileNames']),
      multipleOutputsIssue(),
    ]

    for (const issue of issues) {
      expect(issue.title.length).toBeGreaterThan(0)
      expect(issue.hints.length).toBeGreaterThan(0)
    }
  })

  test('nonEsFormatIssue は形式名を含む', () => {
    expect(nonEsFormatIssue('system').details.join('')).toMatch(/system/)
  })

  test('manifestMissingIssue はファイル名を含む', () => {
    expect(manifestMissingIssue('.vite/manifest.json').details.join('')).toMatch(/manifest\.json/)
  })

  test('hashedFileNamePatternIssue は該当キー名を含む', () => {
    const issue = hashedFileNamePatternIssue(['entryFileNames', 'chunkFileNames'])

    expect(issue.details.join('')).toMatch(/entryFileNames/)
    expect(issue.details.join('')).toMatch(/chunkFileNames/)
  })

  test('unverifiableFileNamePatternIssue は該当キー名を含む', () => {
    expect(unverifiableFileNamePatternIssue(['assetFileNames']).details.join('')).toMatch(
      /assetFileNames/,
    )
  })
})
