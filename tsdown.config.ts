import { defineConfig } from 'tsdown'

export default defineConfig({
  dts: {
    tsgo: true,
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
