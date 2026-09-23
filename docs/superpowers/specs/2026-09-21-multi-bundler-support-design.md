# vite-plugin-query-cache-busting: Vite 6/7(Rollup)対応 設計

作成日: 2026-09-21

## 1. 背景と目的

初期設計（`2026-07-30-query-cache-busting-design.md` 3章）では、対応バージョンを「Vite 8 のみ」と定めていた。理由は、チャンク間 import 指定子の書き換え（同ドキュメント 6.2）に Vite 8 のバンドラである Rolldown 由来の `parseAst` を使っており、Rollup ベースの Vite 6/7 では同じ前提が成り立つか未検証だったため。

Vite 6/7（Rollup）ユーザーからの要望を受け、対応バージョンを Vite 6/7/8 に拡張する。Vite 5 以下は対象外。

## 2. スコープ

対応バージョン: `vite@6.x` / `vite@7.x`（Rollup） / `vite@8.x`（Rolldown）。

機能スコープ自体（初期設計 2章）は変更しない。Vite 6/7 でも Vite 8 と同じ範囲・同じ挙動でクエリが付与されることを目標とする。

## 3. 実測で確認した事実

初期設計は「Vite 8 のみ」を前提に Rolldown の内部実装を読んで検証していた（同ドキュメント 15章）。今回は Vite 6.4.3 / 7.3.6 を実際にインストールし、最小構成でビルドして確認した。

| 確認内容 | 結果 |
|---|---|
| `experimental.renderBuiltUrl` は chunk間の動的 import（JS→JS）を通るか | **通らない**（Vite 8 と同じ）。同一の設定でアセット参照（`type: "asset"`）は通ることも確認済み |
| Vite 6/7 の `parseAst`（`vite` からの re-export） | `rollup/parseAst` が実体。`parseSync`/`parse` という export 自体が存在しない |
| `parseAst(code)` の返り値の形状 | `RollupAstNode<estree.Program>`。`type` / `start` / `end` を持つ ESTree 互換ノードで、既存の `walk()`（`src/rewrite-imports.ts`）が要求する形状と一致 |
| `oxc-parser`（npm package）単体でのオフセット整合性 | 日本語などマルチバイト文字を含むコードでも `start`/`end` は UTF-16 コード単位（JS文字列の `.slice()` と一致）で返る。内部の UTF-8 バイトオフセットとの変換はパッケージ側で行われている |
| `oxc-parser` のインストールフットプリント | ネイティブバインディングは prebuild 済みで各プラットフォーム 1〜数MB程度。対応プラットフォーム数は本リポジトリが devDependency として使っている `oxlint`/`oxfmt` と同水準 |

結論: `experimental.renderBuiltUrl` + `generateBundle` でのAST書き換えという初期設計のアーキテクチャ（6章）は、Rollup / Rolldown いずれでも同じ前提で成立する。バンドラ差分はAST解析の実装（parseSync/parseAst/oxc-parser のどれを呼ぶか）と、`worker.rolldownOptions`/`rollupOptions` のキー名にのみ現れる。

## 4. 設計変更点

### 4.1 AST解析の共通化（`oxc-parser` を直接依存に追加）

**変更前**: `src/rewrite-imports.ts` が `vite` から `parseAst`（のちに `parseSync` に変更）を named import して使用。

**変更後**: `oxc-parser` を `dependencies` に追加し、`src/rewrite-imports.ts` が `oxc-parser` の `parseSync(fileName, code)` を直接呼ぶ。Vite のバージョン・バンドラに関わらず同一のパーサー・同一の挙動になり、バージョン分岐が不要になる。

却下した代替案（バージョンで `vite` 側の関数を分岐）は 7章に記載する。

**この方針変更の背景**: 初期設計 14章は `oxc-parser` の直接依存を「Vite 8 が re-export しているため不要」として却下していた。これは「Vite 8 のみ対応」を前提にした判断であり、Vite 6/7 では Vite が oxc を同梱していない（Rollup/acorn ベース）ため前提が崩れている。加えて、今回の作業中に `vite` の re-export が `parseAst`（deprecated）→ `parseSync` へとメジャーバージョン間でリネームされる事例に実際に遭遇した。Vite側の内部API変更に追従し続けるコストと、ネイティブ依存が1つ増えるコストを比較し、後者を選んだ。

**named import を避ける理由（参考）**: 検討の過程で「`viteMajor` に応じて `vite` の `parseAst`/`parseSync` を呼び分ける」案も検討したが、`import { parseSync } from 'vite'` のような named import は、対象の Vite バージョンにその export が存在しない場合 ESM のリンク時に `SyntaxError` で落ちる。`oxc-parser` を直接依存にすることで、この問題自体も回避される。

### 4.2 `worker.rolldownOptions`/`rollupOptions` のデフォルトキー修正

`src/plugin-steps.ts` の `decideOutputFileNames` は、利用者がどちらの worker output キーも指定していない場合、常に `'rolldownOptions'` にフォールバックしていた。Vite 6/7 には `worker.rolldownOptions` というキー自体が存在しないため、Rollup 系では書き込み先が存在しない設定になり、worker のファイル名パターン検証・ハッシュ除去が機能しないバグになる。

修正: モジュールスコープで `viteMajor = parseMajor(version)`（`vite` の `version` export は全バージョンに存在するため named import で安全）を1回計算し、デフォルト値を `viteMajor >= 8 ? 'rolldownOptions' : 'rollupOptions'` に変更する。利用者がどちらかを明示していれば、そちらを優先する既存の挙動は変えない。

### 4.3 バージョンガードの拡張

`src/guards.ts`:

- `unsupportedViteMajorIssue`: `viteMajor < 8` でエラー → `viteMajor < 6` でエラーに変更
- `unverifiedViteMajorIssue`: `viteMajor > 8` で警告のまま変更なし（Vite 9 以降は引き続き未検証として警告）

`src/diagnostics.ts`:

- `QCB_VITE_TOO_OLD`: 「Vite 8 以降が必要」→「Vite 6 以降が必要」に文言変更
- `QCB_VITE_UNVERIFIED`: 「Vite 8 に対してのみ検証済み」→「Vite 6, 7, 8 に対して検証済み」に文言変更

### 4.4 `peerDependencies` の拡張

`package.json` の `peerDependencies.vite` を `^8.0.0` → `^6.0.0 || ^7.0.0 || ^8.0.0` に変更する（Vite 5 以下、Vite 9 以降は対象外のまま）。

## 5. テスト戦略

Vite 6/7 向けの挙動を継続的に検証するため、CI にマトリクステストを追加する。

- `.github/workflows/ci.yml` を2ジョブに分割する
  - `test`: `strategy.matrix.vite-version: [6, 7, 8]`。`bun install --frozen-lockfile` の後、対象バージョンが devDependency（8系）と異なる場合のみ `bun add -D vite@<version> --no-save` でそのジョブのインストール先だけ上書きし、`bun run test -- --run` を実行する。ロックファイルは変更しない
  - `check-and-build`: 既存の `bun run check` → `bun run test -- --run` → `bun run build` を、コミットされている devDependency バージョン（Vite 8系固定）で1回だけ実行する。lint/format/typecheck/build をバージョンごとに繰り返す必要はない
- `.github/workflows/publish.yml` は変更しない（公開ビルドは固定バージョンで十分）
- 既存の `tests/helpers/build.ts` は `vite` から `build`/`mergeConfig` を実行時に呼ぶだけなので、インストールされている `vite` のバージョンがそのままテスト対象になる。追加の変更は不要

## 6. ドキュメント更新

- `README.md` / `README.ja.md` の「Requirements」を「Vite 8」→「Vite 6, 7, 8」に更新
- `docs/superpowers/specs/2026-07-30-query-cache-busting-design.md` の 3章・14章に、本ドキュメントへのポインタを付けた短い注記を追加する（該当セクションの書き換えはせず、決定が更新されたことが分かるようにする）

## 7. 却下した代替案

**`vite` の `parseAst`/`parseSync` をバージョンで分岐して呼ぶ**: 追加の依存が増えないという利点はあるが、(1) Vite の内部API（re-exportの名前・実体）の変化に今後も追従し続ける必要がある、(2) Rollup版（acorn）とRolldown版（oxc）で異なるパーサーの挙動差に晒され続ける、という2つの理由で却下した。今回の作業中に実際に `parseAst`→`parseSync` のリネームに遭遇しており、この種の追従コストが実在することを踏まえた。

**バンドラごとに別エントリポイント/パッケージに分割**: 分岐点が「AST解析1箇所」「workerキー1箇所」のみと小さいため、パッケージ構成を複雑にするコストに見合わない。

**Rollup系ではchunk間参照の書き換えを諦め、既知の制限として文書化**: 実測（3章）の通り、Rollup でも `renderBuiltUrl` は chunk間JS参照をバイパスするため、これを諦めるとキャッシュバスティングの主目的が Rollup 系ユーザーには機能しないことになる。対応する意味が薄れるため却下。

## 8. 実装順序

1. `oxc-parser` を `dependencies` に追加し、`src/rewrite-imports.ts` を `oxc-parser` 直接呼び出しに変更
2. `src/plugin-steps.ts` の worker output キーのデフォルト値修正
3. `src/guards.ts` / `src/diagnostics.ts` のバージョンガード・文言更新
4. `package.json` の `peerDependencies` 拡張
5. `.github/workflows/ci.yml` のマトリクステスト追加
6. README / 初期設計ドキュメントの更新
