import { Ansis } from 'ansis'
import { describe, expect, test } from 'vitest'

import { createPalette } from '../src/logger'
import { decideOutputFileNames } from '../src/plugin-steps'

const palette = createPalette(new Ansis(0))

describe('decideOutputFileNames', () => {
  test('viteMajor が 8 以上で worker キー未指定なら rolldownOptions をデフォルトにする', () => {
    const result = decideOutputFileNames(palette, {}, 8)

    expect(result.workerKey).toBe('rolldownOptions')
  })

  test('viteMajor が 8 未満で worker キー未指定なら rollupOptions をデフォルトにする', () => {
    expect(decideOutputFileNames(palette, {}, 6).workerKey).toBe('rollupOptions')
    expect(decideOutputFileNames(palette, {}, 7).workerKey).toBe('rollupOptions')
  })

  test('worker.rolldownOptions.output を明示していれば viteMajor に関わらず優先する', () => {
    const result = decideOutputFileNames(
      palette,
      { worker: { rolldownOptions: { output: {} } } },
      6,
    )

    expect(result.workerKey).toBe('rolldownOptions')
  })

  test('worker.rollupOptions.output を明示していれば viteMajor に関わらず優先する', () => {
    const result = decideOutputFileNames(palette, { worker: { rollupOptions: { output: {} } } }, 8)

    expect(result.workerKey).toBe('rollupOptions')
  })
})
