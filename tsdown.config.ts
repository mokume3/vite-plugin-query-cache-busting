import { defineConfig } from 'tsdown'

export default defineConfig({
  // tsconfig.json はテストも含めた型チェック用。ビルド（dts 生成）は src だけを対象にする
  tsconfig: 'tsconfig.build.json',
  dts: {
    generator: 'tsgo',
  },
  deps: {
    // 依存はすべて dependencies / peerDependencies から解決させ、node_modules のコードは一切バンドルしない。
    // devDependencies を src から誤って import した場合などにビルドを失敗させる
    onlyBundle: [],
  },
  exports: true,
  publint: 'ci-only',
  attw: {
    enabled: 'ci-only',
    // ESM 専用パッケージ（CJS ビルドを持たない）ため、CJS からの解決失敗は検査対象外にする
    profile: 'esm-only',
  },
  failOnWarn: 'ci-only',
  // dts.tsgo が意図的に使う TypeScript 7 の実験的 API についての警告で、無害
  suppressWarnings: /TypeScript 7\.0 does not yet have a stable API/,
})
