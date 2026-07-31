# nostics スタイルのログ表示への移行 設計

作成日: 2026-07-31

## 1. 背景と目的

現在のログ・エラー出力は `src/guards.ts` の `Issue { title, details, hints }` と `src/verify.ts` の `Finding { file, line, column, reference, snippet, caretOffset }` という2つの独自データ構造を、`src/logger.ts` の `formatIssue`/`formatFindings` で整形している。

[nostics](https://nostics.dev)（vercel-labs 製の診断ライブラリ、v1.2.0、ランタイム依存ゼロ）が採用している表示スタイルに変更する。

```
[NUXT_B2011] Plugin `./runtime/analytics.server.ts` is server-only but was registered with mode `client`.
├▶ fix: Rename the file or register it with mode `server`.
├▶ sources: modules/analytics.ts:18:5
╰▶ see: https://nuxt.com/e/b2011
```

`nostics` を依存として実際に採用する（見た目だけを手で真似るのではない）。理由は、安定した診断コード・型付きパラメータ・`why`/`fix` という概念がそのまま今の `Issue` の構造と対応し、自前で再実装するより素直だから。

## 2. 採用する範囲・採用しない範囲

`nostics` から使うのは次の2つだけ。

- `defineDiagnostics({ codes })` — 診断カタログの定義。型付きパラメータ・安定したコード名・`why`/`fix` を持つ
- `Diagnostic` クラス — `defineDiagnostics` が返す診断インスタンスのデータ構造（`name`/`message`/`fix`/`sources`）

使わないもの:

- **レポーター**（`createConsoleReporter` など）— `console.warn`/`console.error` を直接叩くため、Vite の `config.logger`（`logLevel`/`customLogger` を尊重する仕組み）を素通りしてしまう。出力ルーティングは今までどおり自前（`throw new Error(...)` / `config.logger.warn(...)`）で行う
- **標準フォーマッタ**（`formatDiagnostic`/`ansiFormatter`）— severity（warn/error）の文字表記を持たず、色を落とすと警告と致命的エラーの区別がつかなくなる。既存の設計原則（色は補助であり、色を落としても情報量が変わらないこと）と衝突するため、同じツリー構造を踏襲した自前のフォーマッタを書く
- **`docsBase`**（コードごとの詳細ドキュメント URL）— 専用の docs サイトが無いため v1 では設定しない。将来 docs サイトができたら1行足すだけで全コードに反映できる
- **`defineProdDiagnostics`**（本番向け軽量版）・**ファイル/fetch/dev レポーター** — このプラグインはビルド時にしか動かず、配布物のバンドルサイズを気にする文脈がないため不要

`nostics` はランタイム依存ゼロ（npm 上の `dependencies` が空）なので、採用してもこのプラグイン自身の依存数以外への影響はない。

## 3. 診断コードの対応表

既存の `Issue` ファクトリ関数13個 + verify の取りこぼし検出1個を、合計14個の診断コードに対応させる。コード名は `QCB_` プレフィックス＋人間が読める名前とする（`nostics` 自身が「コード数が少ないうちは読める名前の方が分かりやすい」と推奨している）。このパッケージは未公開（`package.json` の `version` は `0.0.0`）なので、コード名を今後変える自由度がある。

| 既存の関数名 | 診断コード | severity |
|---|---|---|
| `relativeBaseIssue` | `QCB_RELATIVE_BASE` | error |
| `libModeIssue` | `QCB_LIB_MODE` | error |
| `chunkImportMapIssue` | `QCB_CHUNK_IMPORT_MAP` | error |
| `unsupportedViteMajorIssue` | `QCB_VITE_TOO_OLD` | error |
| `unverifiedViteMajorIssue` | `QCB_VITE_UNVERIFIED` | warn |
| `hijackedRenderBuiltUrlIssue` | `QCB_RENDER_BUILT_URL_HIJACKED` | error |
| `userHookReturnedObjectIssue` | `QCB_RENDER_BUILT_URL_OBJECT` | error |
| `apiDriftIssue` | `QCB_API_DRIFT` | error |
| `nonEsFormatIssue` | `QCB_NON_ES_FORMAT` | warn |
| `manifestMissingIssue`（manifest / ssr-manifest 共用） | `QCB_MANIFEST_MISSING` | error |
| `hashedFileNamePatternIssue` | `QCB_HASHED_FILENAME_PATTERN` | error |
| `unverifiableFileNamePatternIssue` | `QCB_UNVERIFIABLE_FILENAME_PATTERN` | warn |
| `multipleOutputsIssue` | `QCB_MULTIPLE_OUTPUTS` | error |
| （verify の取りこぼし検出、新規） | `QCB_MISSING_QUERY` | warn/error（`verify` オプションに従う） |

`why`/`fix` へのマッピング方針:

- 既存の `title` + `details` → `why`（問題の内容を、値を埋め込んだ1文で表す）
- 既存の `hints` → `fix`（対処方法。複数行だった配列を1つの連続した文字列にする。改行での折り返しは行わず、ターミナルのソフトラップに任せる）
- `hashedFileNamePatternIssue`/`unverifiableFileNamePatternIssue` が受け取る「設定パスのリスト」（例: `build.rollupOptions.output.entryFileNames`）は位置情報ではないので `sources` には入れず、`、`（読点）で連結して `why` に埋め込む（例: `出力ファイル名パターンに [hash] が含まれています: build.rollupOptions.output.entryFileNames、worker.rolldownOptions.output.entryFileNames`）
- `QCB_MISSING_QUERY` の `sources` だけは実際のソース位置（`${file}:${line}:${column}`）を持つ。`Finding[]` を集約して1つの診断にする（現在の「◯件あります」という集約表示を踏襲する）

## 4. 出力フォーマット

**ガードのエラー**（例: 相対 base）
```
[QCB_RELATIVE_BASE] error  相対 base には対応していません: base: "./"
╰▶ fix: 相対 base では Vite が JS 内の URL を実行時計算に切り替えるため、query を静的に付与できません。絶対パス（例: base: '/'）を指定してください。
```

**ガードの警告**（例: Vite 9 以上）
```
[QCB_VITE_UNVERIFIED] warn  Vite 9 は未検証です
╰▶ fix: このプラグインは Vite 8 でのみ検証されています。ビルド後に verify の警告が出ていないか確認してください。
```

**verify の警告/エラー**（複数の取りこぼしを1つの診断に集約）
```
[QCB_MISSING_QUERY] warn  query 未付与の参照が 2 件あります
├▶ fix: ソース中に文字列でハードコードされたパスの可能性があります。意図的な場合は verify: 'off' で抑制できます。
├▶ sources: assets/index.js:1:2043
╰▶ sources: assets/index.css:1:88
```

**成功時サマリ**（変更なし。診断ではなく単なる info ログなので対象外）
```
[query-cache-busting] ?v=202607302209 を 14 件の参照に付与 (js 8, css 3, html 3)
```

診断は `[query-cache-busting]` を付けず `[QCB_XXX]` のブラケットだけにする（`nostics` 本来の1ブラケットの見た目）。成功時サマリだけは診断ではないので今までどおり `[query-cache-busting]` を使う。ブラケットの中身が異なることで「対応が要る出力」と「単なる報告」が視覚的に区別できる。

色付けは `[CODE]`・`error`/`warn` の単語・ツリー枝（`├▶`/`╰▶`）・`fix:`/`sources:` ラベルにのみ乗せ、本文（why・fix の文章、sources の値）は無色にする。これは `nostics` の `ansiFormatter` 自身の流儀（本文は色付けしない）に合わせたもので、副作用として verify の「◯件あります」の数字を色付けする今の挙動は無くなる（`why` を無色のプレーン文字列として組み立てるため）。軽微な後退として受け入れる。

`Palette` インターフェースは変更しない。ツリー枝とラベル語は既存の `hint`（dim）、`[CODE]` は `path`（cyan）を流用する。`bad`（赤下線）は verify のキャレット表示が無くなることで使われなくなるため削除する。

## 5. ファイル構成とデータフロー

| ファイル | 変更内容 |
|---|---|
| `src/diagnostics.ts`（新規） | `defineDiagnostics({ codes })` でカタログを1つ定義。`reporters`・`docsBase` は設定しない。純粋モジュール（`nostics` 自体が無依存なので Vite/ansis に依存しない） |
| `src/guards.ts` | 各 `xxxIssue()` 関数は同じ名前・同じシグネチャのまま、返す型が `Issue` → `nostics` の `Diagnostic` に変わる（中身は `diagnostics.CODE({ ...params })` を呼ぶだけ）。`collectConfigIssues` の構造は変えない |
| `src/logger.ts` | `formatIssue`/`formatFindings` の2関数を `formatDiagnostic(palette, level, diagnostic)` という1関数に統合する。`Diagnostic` の `name`（コード）・`message`（why）・`fix`・`sources` から汎用的にツリーを組み立てる |
| `src/verify.ts` | `findMissingQuery` からスニペット・キャレット位置の計算を削除。`Finding` は `{ file, line, column, reference }` に縮小する |
| `src/plugin-steps.ts` / `src/generate-bundle.ts` | 呼び出し側は「診断を作る → `formatDiagnostic` で整形 → `throw`/`config.logger.warn` に渡す」という今と同じ3段の流れのまま、関数名を差し替えるだけ |
| `package.json` | `nostics`（`^1.2.0`）を `dependencies` に追加 |

データフロー:

```
guards.ts / generate-bundle.ts の呼び出し箇所
 └─ diagnostics.CODE({ ...params, sources? })
      → nostics が Diagnostic を構築するだけ（reporters 無し・print されない）
        ↓
logger.ts: formatDiagnostic(palette, level, diagnostic)
 └─ [CODE] level  why
    ├▶ fix: ...        （fix があれば）
    ├▶ sources: ...    （sources の要素ごとに1行）
    ╰▶ ...
        ↓
呼び出し側が今までどおりルーティング（変更なし）
 ├─ throw new Error(formatted)      … ビルドを止める
 └─ config.logger.warn(formatted)   … 警告として続行
```

## 6. エラー処理の細部

- `docsBase` を設定しないため、すべての `Diagnostic.docs` は `undefined` になり、`see:` の行は一切出ない（フォーマッタは `fix`/`sources` それぞれについて「あれば出す」という今と同じ条件分岐にする）
- `nostics` は ESM 専用だが、`exports` は `"."` → `dist/index.mjs` の単純な形なので、`moduleResolution: bundler` の現行 tsconfig でそのまま解決できる（`vite`/`magic-string`/`ansis` と同じ扱い）
- レポーターを一切登録しないため（`defineDiagnostics({ codes })` に `reporters` キーを渡さない）、`diagnostics.CODE(...)` の呼び出し自体は副作用（print）を持たない。二重表示のリスクはこの設計により構造的に排除される

## 7. テスト戦略

| ファイル | 影響 |
|---|---|
| `tests/guards.test.ts` | 各テストの期待値を `Issue` の `{title,details,hints}` から `Diagnostic` の `{name, message, fix}` に書き換える。テストケース自体（何を確認するか）は変えない |
| `tests/logger.test.ts` | `formatIssue`/`formatFindings` のテストを `formatDiagnostic` 1本に統合する。`nostics` が `Diagnostic` クラスを直接 export しているので、`new Diagnostic({ code, why, fix, sources })` でテスト用のインスタンスを直接組み立てられる。`diagnostics.ts` の実カタログに依存せず `logger.ts` を単体テストできる |
| `tests/verify.test.ts` | `snippet`/`caretOffset` を検証しているテストを削除する。`file`/`line`/`column`/`reference` の計算と `isReferenceBoundary` の境界判定ロジックのテストは変更しない |
| `tests/options.test.ts` / `url.test.ts` / `version.test.ts` / `manifest.test.ts` / `file-names.test.ts` / `rewrite-imports.test.ts` | 影響なし |
| `tests/integration/*.test.ts` | `rejects.toThrow(/相対 base/)` のような正規表現アサーションは、`why`/`fix` に同じ日本語文言を残す限りそのまま通る想定。実装後に実際に確認する |

## 8. ドキュメント更新

- README に出力サンプルを示す節（「エラー表示」）を新設し、新フォーマットの実例を1つ載せる。現在の README にはエラー出力の例が無いため、これは既存記述の書き換えではなく追加になる
- Global Constraints の「ランタイム依存は `magic-string` と `ansis` の2つだけ」を「3つ（+ `nostics`）」に更新する
- 「ログのプレフィックスは `[query-cache-busting]`」という制約を「成功時サマリは `[query-cache-busting]`、診断は `[QCB_XXX]`」に更新する

## 9. スコープ境界（今回やらないこと）

- `nostics` のレポーター機構・`docsBase`・`defineProdDiagnostics` は使わない
- 診断コードの命名は今回で確定させ、将来変えないことを前提にする（`nostics` 自身がそう推奨しているため）
- verify のスニペット＋キャレット表示は復元しない（`nostics` の `sources` は `file:line:column` の文字列のみを扱うため）

## 10. 却下した代替案

**`nostics` を採用せず見た目だけ自前で再現する案**: 依存を増やさずに済むが、型付きパラメータ・安定したコード名という `nostics` の本体価値を捨てて外見だけ真似ることになり、今の `Issue` 型を作り直す手間と大差ない。`nostics` がランタイム依存ゼロで実装も薄い（`dist/index.mjs` を確認済み）ため、採用するコストが低く却下した。

**`nostics` の `createConsoleReporter` をそのまま使う案**: `console.warn`/`console.error` を直叩きするため Vite の `config.logger`（`logLevel`/`customLogger`）を素通りする。この既存の設計原則を優先し却下した。

**`nostics` 標準の `ansiFormatter` をそのまま使う案**: severity の色分け・文字表記が無く、色を落とすと警告と致命的エラーの区別がつかない。「色は補助であり、色を落としても情報量が変わらないこと」という既存の設計原則と衝突するため却下した。
