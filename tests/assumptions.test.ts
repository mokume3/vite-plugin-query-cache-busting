import { fileURLToPath } from 'node:url'

import { build, parseAst } from 'vite'
import { expect, test } from 'vitest'

const basicRoot = fileURLToPath(new URL('./fixtures/basic', import.meta.url))

test('parseAst は import 指定子を start/end 付きの Literal で返す', () => {
  const ast = parseAst('import a from "./dep.js"\nexport * from "../other.js"\n') as unknown as {
    body: { source: { type: string; value: unknown; start: number; end: number } }[]
  }

  const [importNode, exportNode] = ast.body

  expect(importNode?.source.type).toBe('Literal')
  expect(importNode?.source.value).toBe('./dep.js')
  expect(typeof importNode?.source.start).toBe('number')
  expect(typeof importNode?.source.end).toBe('number')
  expect(exportNode?.source.value).toBe('../other.js')
})

// プラグイン本体が config フックで設定するのと同じ、[hash] を含まないパターン
const hashFreeOutput = {
  entryFileNames: 'assets/[name].js',
  chunkFileNames: 'assets/[name].js',
  assetFileNames: 'assets/[name].[ext]',
}

async function captureRenderChunk(output: Record<string, string>) {
  const captured: { fileName: string; code: string }[] = []

  await build({
    root: basicRoot,
    base: '/',
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      assetsInlineLimit: 0,
      rollupOptions: { output },
    },
    plugins: [
      {
        name: 'capture-render-chunk',
        enforce: 'post',
        renderChunk(code, chunk) {
          captured.push({ fileName: chunk.fileName, code })
          return null
        },
      },
    ],
  })

  return captured
}

test('[hash] を外せば renderChunk はチャンク間 import の最終的な相対パスを受け取る', async () => {
  const captured = await captureRenderChunk(hashFreeOutput)

  expect(captured.length).toBeGreaterThan(1)

  const allCode = captured.map((chunk) => chunk.code).join('\n')

  // 動的 import が最終的な相対パスで出ている
  expect(allCode).toMatch(/import\(["']\.\/[\w.-]+\.js["']\)/)

  // 静的なチャンク間 import も最終的な相対パスで出ている
  expect(allCode).toMatch(/from\s*["']\.\/[\w.-]+\.js["']/)

  // ハッシュプレースホルダが残っていない
  expect(allCode).not.toMatch(/!~\{[0-9a-z]+\}~/)
})

test('[hash] が残っているとプレースホルダが渡ってくる（この設計が必要な理由）', async () => {
  const captured = await captureRenderChunk({
    entryFileNames: 'assets/[name]-[hash].js',
    chunkFileNames: 'assets/[name]-[hash].js',
    assetFileNames: 'assets/[name]-[hash].[ext]',
  })

  const allCode = captured.map((chunk) => chunk.code).join('\n')

  expect(allCode).toMatch(/!~\{[0-9a-z]+\}~/)
})
