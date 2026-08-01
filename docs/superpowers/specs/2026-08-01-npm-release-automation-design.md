# npm パッケージ公開の自動化とバージョン管理 設計

作成日: 2026-08-01

## 1. 背景と目的

`vite-plugin-query-cache-busting` は現在 `package.json` の `version` が `0.0.0` のままで、npm に一度も公開されていない（`npm view` が 404 を返す）。CI/CD も存在せず（`.github` ディレクトリが無い）、テスト・lint・型チェックはすべて手元でしか実行されていない。

本設計では次の3つを実装する。

1. **GitHub Actions での npm パッケージ公開**（タグ push をトリガーにした自動公開）
2. **バージョン管理の仕組み**（`bumpp` を使ったローカルでのバージョン更新・タグ付け）
3. **手順書（`RELEASING.md`）**（初回セットアップ手順と通常のリリース手順）

## 2. 方針

- **リリースのトリガーは人間が握る**（自動判定・全自動化はしない）。`bumpp`（既に devDependency として導入済み、`"release": "bumpp"` スクリプトあり）をローカルで対話的に実行し、バージョンを選び、コミット・タグ作成・push を確認しながら進める
- **CI 側は「タグが push されたら公開するだけ」に責務を絞る**。バージョンをいつ・どう上げるかの判断は CI に持ち込まない
- **npm への認証は Trusted Publishing（OIDC）を使う**。GitHub Secrets に長期トークンを置かない。ただし npm 側の Trusted Publisher 登録は、パッケージが一度も存在しないと設定できないことが多いため、**初回だけ手動で `npm publish` する**という一度きりの準備手順を挟む
- **GitHub Release の作成も自動化する**。公開ワークフロー内で `gh release create --generate-notes` を実行し、コミット履歴からリリースノートを自動生成する
- **PR・push のたびに走る一般的な CI（lint/test/typecheck）も新設する**。公開ワークフローとは別ファイルにする

## 3. ワークフローの構成

```
.github/workflows/
  ci.yml       — push/PR のたびに lint・test・typecheck（公開とは無関係）
  publish.yml  — v* タグの push、または手動実行（dry-run 可）で公開
```

### 3.1 リリースの全体フロー

```
開発者がローカルで `bun run release`（= bumpp）を実行
  → 対話形式でバージョンを選択（patch/minor/major/prerelease 等）
  → package.json 更新・コミット・git tag（例: v1.2.3）作成・push を対話で確認
        ↓
GitHub 上で v1.2.3 タグを検知 → publish.yml が起動
  → チェックアウト（そのタグの commit）
  → 依存インストール（bun）
  → bun run check（lint + format:check + typecheck）
  → bun run test -- --run
  → bun run build
  → package.json の version とタグ名（v を除いた部分）が一致するか検証
    → 不一致ならここでジョブを失敗させ、npm publish に進ませない
  → npm publish --provenance --access public（OIDC、トークン不要）
  → gh release create v1.2.3 --generate-notes
```

### 3.2 `ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: bun install --frozen-lockfile
      - run: bun run check
      - run: bun run test -- --run
      - run: bun run build
```

`bun-version` は `package.json` の `packageManager` フィールド（`bun@1.3.14`）と一致させる。

### 3.3 `publish.yml`

```yaml
name: Publish

on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      dry_run:
        type: boolean
        default: true
        description: 'true の場合 npm publish と GitHub Release 作成をスキップする'

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org

      - name: Ensure npm supports Trusted Publishing
        run: npm install -g npm@latest

      - run: bun install --frozen-lockfile
      - run: bun run check
      - run: bun run test -- --run
      - run: bun run build

      - name: Verify tag matches package.json version
        if: github.event_name == 'push'
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PKG_VERSION="$(node -p "require('./package.json').version")"
          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "::error::tag v$TAG_VERSION does not match package.json version $PKG_VERSION"
            exit 1
          fi

      - name: Determine whether this is a real publish
        id: mode
        run: |
          if [ "${{ github.event_name }}" = "push" ]; then
            echo "publish=true" >> "$GITHUB_OUTPUT"
          elif [ "${{ inputs.dry_run }}" = "false" ]; then
            echo "publish=true" >> "$GITHUB_OUTPUT"
          else
            echo "publish=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Publish to npm
        if: steps.mode.outputs.publish == 'true'
        run: npm publish --provenance --access public

      - name: Create GitHub Release
        if: steps.mode.outputs.publish == 'true'
        run: gh release create "$GITHUB_REF_NAME" --generate-notes
        env:
          GH_TOKEN: ${{ github.token }}
```

`workflow_dispatch` は任意のブランチから手動実行できる。`dry_run`（デフォルト `true`）にしておけば、チェックアウト〜バージョン検証までを npm への実際の公開無しに検証できる。`push` イベント（実際のタグ push）の場合は常に本番公開として扱う。

**技術上の理由で `npm publish` は `bun publish` ではなく `npm` CLI で行う。** npm の Trusted Publishing（OIDC）は npm CLI の対応済みバージョンに依存する挙動であり、`bun publish` が同じ OIDC フローに対応しているという確証がない。ビルド・テストは引き続き bun で行い、公開ステップのためだけに `actions/setup-node` で Node.js と npm CLI を用意する。

**`npm install -g npm@latest` を挟む理由**: Trusted Publishing には npm CLI の比較的新しいバージョンが要る。`actions/setup-node` が Node 22 にバンドルする npm がその条件を満たすかはバンドルされた具体的なパッチバージョン次第で確証が持てないため、明示的に最新化してから使う。

## 4. Trusted Publishing の初回登録手順（一度きり）

npm の Trusted Publisher 設定は、パッケージが npm レジストリに存在しないと登録画面が出てこない。このパッケージは未公開のため、以下の手順を最初に1回だけ行う。

1. ローカルで `npm login`（2要素認証あり）
2. `bun run build`
3. `npm publish --access public` を手動実行 → npm 上にパッケージが誕生する
4. npmjs.com のパッケージ設定ページ（正確なメニュー名は npm 側の UI 変更があり得るため実際の画面で確認すること）で GitHub Actions を信頼済み発行元として登録する:
   - Organization/User: `mokume3`
   - Repository: `vite-plugin-query-cache-busting`
   - Workflow file: `.github/workflows/publish.yml`
   - Environment: 設定しない
5. 以降のリリースはすべて `publish.yml` 経由（`npm publish` にトークンは不要、`id-token: write` 権限だけで通る）

この手順は `RELEASING.md` に明記し、実装計画のタスクとして実際に実施する。

## 5. `RELEASING.md`（手順書）の構成

リポジトリ直下に新設する。

1. **前提条件** — npm アカウント・2要素認証、リポジトリへの push 権限
2. **初回セットアップ**（4章の手順、一度きり）
3. **通常のリリース手順**:
   - `bun run release` を実行
   - 対話でバージョンを選択（patch/minor/major）
   - コミット・タグ作成・push の確認プロンプトにすべて `y` で応答
   - GitHub の Actions タブで `publish.yml` の実行結果を確認する
   - npm と GitHub Releases に反映されたことを確認する
4. **`workflow_dispatch` による dry-run の使い方** — Actions タブから手動実行し、`dry_run` を `true`（デフォルト）のままにする
5. **トラブルシューティング**（6章参照）

## 6. エラー処理

- **バージョン不一致の検出を最優先にする**。タグ名（`v1.2.3`）と `package.json` の `version` が一致しない場合、`npm publish` に到達する前にジョブを失敗させる。誤ったバージョンが公開されることを防ぐ最後の砦
- **`npm publish` が失敗した場合**（ネットワーク・レジストリ側の問題など）: タグは既に push 済みで残る。同じワークフロー実行を re-run すれば良い（コミット内容は変わらないため冪等）。バージョン自体が間違っていた場合のみ、タグを削除して作り直す
- **`npm publish` は成功したが `gh release create` が失敗した場合**: パッケージは既に公開済みなので影響は軽微。`gh release create v1.2.3 --generate-notes` を手動で叩き直せば良い
- これらの復旧手順は `RELEASING.md` のトラブルシューティング節に書く

## 7. テスト方針

- `ci.yml` は feature ブランチへの push・PR で素直に検証できる
- `publish.yml` は `workflow_dispatch`（任意のブランチから手動実行可）＋ `dry_run: true` で、チェックアウト・ビルド・テスト・バージョン検証までを npm への実際の公開無しに検証する
- **正直な限界として、`npm publish`/`gh release create` 自体の実地検証は、4章の初回セットアップ（実際の初回リリース）と実質的に一致する。** 使い捨ての検証用パッケージを npm に作るような追加の仕組みは、この規模のプロジェクトには見合わないため提案しない

## 8. スコープ境界（今回やらないこと）

- コミットメッセージ規約からの自動バージョン判定（semantic-release・changesets 的な完全自動化）はしない。バージョンは人間が `bumpp` の対話プロンプトで選ぶ
- `bumpp` の設定（コミットメッセージテンプレート・タグ名テンプレート）はデフォルトのまま変更しない（`commit: true` / `tag: true` / `push: true` / `confirm: true` が既定値であることを確認済み）
- npm の `defineProdDiagnostics` 等、本プラグイン自体の機能には触れない。あくまでリリース運用の整備のみ

## 9. 却下した代替案

**GitHub Actions の `workflow_dispatch` だけでバージョン決定から公開まで完結させる案**: ローカル環境の差異を気にせずに済むが、CI 上でリポジトリへの push 権限（GitHub App token か PAT）が別途必要になり、`bumpp` が既にローカルで機能している現状に対して構成変更が大きい。ユーザーの選択（質問1の回答A）により却下

**コミットメッセージ規約からの完全自動バージョン判定**: 最も自動化されるが、規約の徹底が必要で意図しないバージョンが上がるリスクがある。ユーザーの選択（質問1の回答A）により却下

**`NPM_TOKEN`（Automation トークン）による認証**: 設定は単純だが、長期トークンの管理・ローテーションが必要。ユーザーの選択（質問2の回答A）により却下。ただし本設計は初回公開だけ手動 `npm publish`（ローカルの npm login）を要求しており、この時点では長期トークンを一切発行しない
