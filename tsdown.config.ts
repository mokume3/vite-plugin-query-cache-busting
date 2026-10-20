import { defineConfig } from 'tsdown'

export default defineConfig({
  // tsconfig.json はテストも含めた型チェック用。ビルド（dts 生成）は src だけを対象にする
  tsconfig: 'tsconfig.build.json',
  dts: {
    generator: 'tsgo',
  },
  exports: true,
  publint: 'ci-only',
  attw: {
    enabled: 'ci-only',
    // ESM 専用パッケージ（CJS ビルドを持たない）ため、require() から解決できないのは意図どおり
    ignoreRules: ['cjs-resolves-to-esm'],
  },
  failOnWarn: 'ci-only',
  // dts.tsgo が意図的に使う TypeScript 7 の実験的 API についての警告で、無害
  suppressWarnings: /TypeScript 7\.0 does not yet have a stable API/,
})
