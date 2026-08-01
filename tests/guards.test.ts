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
    expect(errors[0]?.message).toMatch(/Relative base/)
    expect(errors[0]?.message).toMatch(/\.\//)
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
    expect(errors[0]?.message).toMatch(/build\.lib/)
  })

  test('chunkImportMap が有効ならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, chunkImportMap: true })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/chunkImportMap/)
  })

  test('Vite 7 以下ならエラー', () => {
    const { errors } = collectConfigIssues({ ...supported, viteMajor: 7 })

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/Vite 8/)
  })

  test('Vite 9 以上なら警告', () => {
    const { errors, warnings } = collectConfigIssues({ ...supported, viteMajor: 9 })

    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toMatch(/unverified/)
  })

  test('複数の非対応構成をまとめて返す', () => {
    expect(
      collectConfigIssues({ base: './', isLib: true, chunkImportMap: true, viteMajor: 8 }).errors,
    ).toHaveLength(3)
  })
})

describe('個別の Diagnostic', () => {
  test('どの Diagnostic も message と fix を持つ', () => {
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
      expect(issue.message.length).toBeGreaterThan(0)
      expect(issue.fix).toBeDefined()
      expect(issue.fix).not.toBe('')
    }
  })

  test('nonEsFormatIssue は形式名を含む', () => {
    expect(nonEsFormatIssue('system').message).toMatch(/system/)
  })

  test('manifestMissingIssue はファイル名を含む', () => {
    expect(manifestMissingIssue('.vite/manifest.json').message).toMatch(/manifest\.json/)
  })

  test('hashedFileNamePatternIssue は渡した文字列をそのまま message に含める（前置しない）', () => {
    const issue = hashedFileNamePatternIssue([
      'build.rollupOptions.output.entryFileNames',
      'worker.rolldownOptions.output.chunkFileNames',
    ])

    expect(issue.message).toContain('build.rollupOptions.output.entryFileNames')
    expect(issue.message).toContain('worker.rolldownOptions.output.chunkFileNames')
  })

  test('unverifiableFileNamePatternIssue は渡した文字列をそのまま message に含める（前置しない）', () => {
    expect(
      unverifiableFileNamePatternIssue(['worker.rollupOptions.output.assetFileNames']).message,
    ).toContain('worker.rollupOptions.output.assetFileNames')
  })
})
