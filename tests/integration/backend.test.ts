import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import {
  buildFixture,
  collectManifestImportKeys,
  expectAllReferencesBusted,
  readManifest,
} from '../helpers/build'

const backendRoot = fileURLToPath(new URL('../fixtures/backend', import.meta.url))

const backendOverrides = {
  build: {
    manifest: true,
    rollupOptions: {
      input: fileURLToPath(new URL('../fixtures/backend/src/main.ts', import.meta.url)),
    },
  },
}

describe('backend fixture（HTML 無し・manifest あり）', () => {
  test('manifest の file に query が付く', async () => {
    const files = await buildFixture(backendRoot, { version: 'testver' }, backendOverrides)
    const entries = Object.values(readManifest(files))

    expect(entries.length).toBeGreaterThan(0)

    for (const entry of entries) {
      expect(entry.file).toMatch(/\.js\?v=testver$/)
    }
  })

  test('manifest の imports はキーのままで書き換えない', async () => {
    const files = await buildFixture(backendRoot, { version: 'testver' }, backendOverrides)
    const importKeys = collectManifestImportKeys(readManifest(files))

    expect(importKeys.length).toBeGreaterThan(0)

    for (const importKey of importKeys) {
      expect(importKey).not.toContain('?v=')
    }
  })

  // oxlint-disable-next-line vitest/expect-expect -- assertion happens inside expectAllReferencesBusted
  test('query 未付与の参照が1件も残らない', async () => {
    const files = await buildFixture(backendRoot, { version: 'testver' }, backendOverrides)

    expectAllReferencesBusted(files, 'v=testver')
  })
})
