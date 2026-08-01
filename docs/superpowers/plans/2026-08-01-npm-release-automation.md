# npm Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions で `vite-plugin-query-cache-busting` の npm 公開を自動化し、タグ push だけでリリースが完結する仕組みと手順書を作る。

**Architecture:** バージョンの判断はローカルの `bumpp`（対話式）に任せ、GitHub Actions は「タグが push されたら公開するだけ」の薄い役割に絞る。npm への認証は Trusted Publishing（OIDC）を使い、長期トークンを置かない。CI（lint/test/build の常時検証）と公開処理は別ワークフローに分ける。

**Tech Stack:** GitHub Actions / `bumpp`（既存） / npm CLI（Trusted Publishing のため `bun publish` ではなくこちらを使う） / `gh` CLI

**設計ドキュメント:** [docs/superpowers/specs/2026-08-01-npm-release-automation-design.md](../specs/2026-08-01-npm-release-automation-design.md)

## Global Constraints

これらは全タスクの要件に暗黙に含まれる。

- リリースのトリガーは人間が握る。GitHub Actions 側でバージョンを自動判定しない
- npm への認証は Trusted Publishing（OIDC）。`NPM_TOKEN` のような長期シークレットはリポジトリに置かない
- `npm publish` は `bun publish` ではなく `npm` CLI で行う（Trusted Publishing の対応状況が npm CLI 依存のため）
- `publish.yml` の `permissions` は `contents: write`（GitHub Release 作成用）と `id-token: write`（OIDC 用）の2つだけ
- タグ名と `package.json` の `version` が一致しない場合、`npm publish` に到達する前にビルドジョブを失敗させる（タグ push のときのみ検証。`workflow_dispatch` の dry-run では検証しない）
- `bun-version` はワークフロー内で `package.json` の `packageManager`（`bun@1.3.14`）と一致させる
- コミット前に `bun run format` を実行して整形する（`.oxfmtrc.json` は YAML・Markdown も対象）
- コミットメッセージは Conventional Commits（`feat:` / `docs:` / `chore:`）
- **`bun run build` はローカルでは何も追加検証をしないが、CI 環境（`CI` 環境変数が truthy）では `publint`/`attw`/`failOnWarn` が自動的に有効になる**（`tsdown.config.ts` に既に設定済み）。したがって `ci.yml`/`publish.yml` のどちらでも `bun run build` を実行するだけでパッケージング品質のチェックが乗る。ワークフロー側で追加の呼び出しは不要
- **GitHub Actions の仕様上の制約**: `workflow_dispatch` はワークフローファイルがデフォルトブランチ（`main`）に一度も存在しないと手動実行できないことがある。そのため `publish.yml` の dry-run 検証は feature ブランチ上では失敗する可能性があり、その場合は「`main` にマージした後にコントローラー（人間または統括エージェント）が改めて dry-run する」という手順に切り替える。Task 2 の手順にこの分岐を明記する
- **`npm publish` と npmjs.com での Trusted Publisher 登録は、npm アカウントの認証情報を持つ人間にしか実行できない。** サブエージェントに実行させないこと（Task 4 参照）

---

### Task 1: `ci.yml` — push/PR のたびに走る検証

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: なし（後続タスクはこのファイルの存在に依存しない。独立して検証できる）

- [ ] **Step 1: ワークフローファイルを書く**

`.github/workflows/ci.yml`:

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

- [ ] **Step 2: 整形する**

```bash
bun run format
```

Expected: `.github/workflows/ci.yml` が oxfmt の規約（2スペースインデント等）に沿って整形される。差分が出ても内容が変わっていなければ問題ない。

- [ ] **Step 3: コミット**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint/test/build workflow for push and pull_request"
```

- [ ] **Step 4: ブランチを push し、PR を開いて実際にトリガーさせる**

このタスクだけは「実際に GitHub 上で動かして確認する」ことが唯一の検証手段。`pull_request` イベントは PR を開かないと発火しないため、ここで先に PR を作る（全タスク完了後にマージする。今すぐマージしない）。

```bash
git push -u origin <このブランチ名>
gh pr create --base main --title "Add npm release automation" --body "WIP: CI/publish workflows + release runbook. See docs/superpowers/plans/2026-08-01-npm-release-automation.md"
```

- [ ] **Step 5: CI の実行結果を確認する**

```bash
gh pr checks --watch
```

Expected: `CI / test` が成功する。もし `bun run build` のステップで `attw`/`publint` が失敗したら、`tsdown.config.ts` 側の設定（このタスクの範囲外）ではなく、まずこのブランチのコード自体に問題が無いかを疑うこと。

---

### Task 2: `publish.yml` — タグ push（または手動 dry-run）での公開

**Files:**
- Create: `.github/workflows/publish.yml`

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: ワークフローファイルを書く**

`.github/workflows/publish.yml`:

```yaml
name: Publish

on:
  push:
    tags: ['v*']
  workflow_dispatch: {}

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

- [ ] **Step 2: 整形する**

```bash
bun run format
```

- [ ] **Step 3: コミット**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: add npm publish workflow with dry-run support"
```

- [ ] **Step 4: push して、feature ブランチ上で dry-run を試す**

```bash
git push
gh workflow run publish.yml --ref <このブランチ名>
```

**この Step は失敗する可能性がある。** GitHub Actions は、ワークフローファイルがデフォルトブランチ（`main`）に一度も存在しないと `workflow_dispatch` を受け付けないことがある。`gh workflow run` が「workflow does not have 'workflow_dispatch' trigger」「could not find any workflows」のようなエラーを返した場合は、このステップを失敗として扱わず、**このタスクのレポートに「feature ブランチでは dry-run できなかった。main へのマージ後に改めて検証する」と明記して次のタスクに進む。**

もしコマンドが受理された場合は、以下で結果を確認する:

```bash
gh run watch $(gh run list --workflow=publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected（dry-run が実行できた場合）: `bun run check`/`test`/`build` は実行され、「Verify tag matches package.json version」「Publish to npm」「Create GitHub Release」の3ステップは `skipped` と表示される（`workflow_dispatch` では `github.event_name` が `push` にならないため、この3ステップはすべて常にスキップされる）。

- [ ] **Step 5: PR に反映されたことを確認する**

```bash
gh pr checks --watch
```

Expected: Task 1 で開いた PR の CI チェックが引き続き成功する（`publish.yml` は `push`/`workflow_dispatch` のみがトリガーなので、この PR の `pull_request` イベントでは動かない。動かないことが正しい状態）。

---

### Task 3: `RELEASING.md` — リリース手順書

**Files:**
- Create: `RELEASING.md`（リポジトリ直下）

**Interfaces:**
- Consumes: Task 1・Task 2 で作ったワークフローファイルの存在（内容を手順として説明する）

- [ ] **Step 1: 手順書を書く**

`RELEASING.md`:

```markdown
# リリース手順

このプロジェクトのリリースは、ローカルでバージョンを決めて `bumpp` でタグを push すると、GitHub Actions が自動で npm に公開する仕組みになっています。

## 前提条件

- npm アカウントを持っていて、2要素認証（2FA）が設定されていること
- このリポジトリへの push 権限があること

## 初回セットアップ（最初の1回だけ）

npm の Trusted Publisher（GitHub Actions を信頼済みの発行元として登録する仕組み）は、パッケージが npm 上に一度も存在しないと設定画面が出てこないことが多いです。そのため、最初の公開だけ手作業で行います。

1. ローカルで npm にログインします（2FA の入力が求められます）。

   ```bash
   npm login
   ```

2. ビルドします。

   ```bash
   bun run build
   ```

3. 手動で公開します。これで npm 上にパッケージが誕生します。

   ```bash
   npm publish --access public
   ```

4. [npmjs.com](https://www.npmjs.com/) にログインし、このパッケージの設定ページから GitHub Actions を信頼済みの発行元として登録します（メニューの正確な名称は npm 側の UI 変更で変わることがあるので、実際の画面を確認してください。「Trusted Publisher」「Publishing access」に類する項目を探します）。登録する内容:

   | 項目 | 値 |
   | --- | --- |
   | Organization/User | `mokume3` |
   | Repository | `vite-plugin-query-cache-busting` |
   | Workflow file | `.github/workflows/publish.yml` |
   | Environment | （設定しない） |

5. これ以降のリリースはすべて `publish.yml` 経由で行われます。`npm publish` にトークンは不要です（`id-token: write` 権限だけで通ります）。

## 通常のリリース手順

1. ローカルで以下を実行します。

   ```bash
   bun run release
   ```

2. `bumpp` が対話形式でバージョンを聞いてきます（patch / minor / major などから選択）。

3. コミット・タグ作成・push の確認プロンプトが順に表示されるので、すべて `y`（はい）で応答します。

4. GitHub の Actions タブを開き、`Publish` ワークフローの実行結果を確認します。

   ```bash
   gh run watch $(gh run list --workflow=publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')
   ```

5. 完了したら、npm（`https://www.npmjs.com/package/vite-plugin-query-cache-busting`）と GitHub の Releases ページに反映されていることを確認します。

## dry-run で試す

実際にタグを push する前に、ビルド・テストだけを安全に試したい場合は、GitHub の Actions タブから `Publish` ワークフローを手動実行します。`workflow_dispatch` には入力が無く、常に dry-run 扱いになります（`npm publish` と GitHub Release の作成は常にスキップされます）。

```bash
gh workflow run publish.yml --ref main
```

## トラブルシューティング

### バージョン不一致でジョブが失敗した

タグ名と `package.json` の `version` が一致していません。誤ったバージョンでタグを push してしまった場合は、そのタグを削除して作り直してください。

```bash
git tag -d v1.2.3
git push origin :refs/tags/v1.2.3
```

その後、正しいバージョンで `bun run release` をやり直します。

### `npm publish` がネットワークエラー等で失敗した

タグは既に push されているので、同じ実行を再実行すれば十分です（コミット内容は変わらないため冪等です）。GitHub の Actions タブから、失敗したワークフロー実行を開き、「Re-run all jobs」を選んでください。

### `npm publish` は成功したが GitHub Release の作成が失敗した

パッケージは既に公開されているので影響は軽微です。以下を手動で実行してください。

```bash
gh release create v1.2.3 --generate-notes
```
```

- [ ] **Step 2: 整形する**

```bash
bun run format
```

- [ ] **Step 3: コミット**

```bash
git add RELEASING.md
git commit -m "docs: add the release runbook"
```

- [ ] **Step 4: push して PR に反映する**

```bash
git push
gh pr checks --watch
```

Expected: 引き続き CI が成功する。

---

### Task 4: 初回セットアップの実施（人間のみ。サブエージェントに実行させないこと）

**この Task はコードを書くタスクではない。** `npm publish` の実行と npmjs.com での Trusted Publisher 登録は、npm アカウントの認証情報（2FA を含む）を持つ人間にしかできない。**サブエージェントにこの Task を割り当てないこと。** 実行計画（subagent-driven-development / executing-plans）のコントローラーは、この Task に到達したら作業を停止し、人間に以下を依頼すること。

**Files:** なし（手作業のみ）

- [ ] **Step 1: main へのマージ**

Task 1〜3 のレビューがすべて完了したら、PR をマージする。push・PR 作成は Task 1 で既に行っているので、ここで新たに必要なのはマージの実行のみ。マージは破壊的とまではいかないが公開範囲の広い操作なので、実行前に必ずユーザーに確認すること。

- [ ] **Step 2: マージ後に dry-run を再検証する**

Task 2 の Step 4 で feature ブランチ上の dry-run が「ワークフローが見つからない」等の理由で実行できなかった場合、`main` にマージされた今なら実行できるはずなので、ここで改めて確認する。

```bash
gh workflow run publish.yml --ref main
gh run watch $(gh run list --workflow=publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: `bun run check`/`test`/`build` が成功し、公開系の2ステップ（`Publish to npm`/`Create GitHub Release`）は `skipped` になる。

- [ ] **Step 3: 人間に初回公開を依頼する**

`RELEASING.md` の「初回セットアップ」節（Task 3 で作成済み）に従って、以下を**人間自身に**実行してもらう:

1. `npm login`
2. `bun run build`
3. `npm publish --access public`
4. npmjs.com で Trusted Publisher を登録する（`mokume3` / `vite-plugin-query-cache-busting` / `.github/workflows/publish.yml`）

- [ ] **Step 4: 公開されたことを確認する（これはコントローラーが行ってよい、読み取り専用の確認）**

```bash
npm view vite-plugin-query-cache-busting version
```

Expected: `0.0.0` ではなく、人間が実際に公開したバージョン番号が返る。404 が返る場合はまだ完了していないので、Step 3 に戻って人間に確認する。

---

## 完了条件

- `.github/workflows/ci.yml` が存在し、PR で実際に緑になっている
- `.github/workflows/publish.yml` が存在し、`main` へのマージ後に `workflow_dispatch` の手動実行で成功している（公開ステップはスキップされた状態）
- `RELEASING.md` がリポジトリ直下にあり、`bun run format` を通した状態でコミットされている
- `npm view vite-plugin-query-cache-busting version` が 404 ではなく実際のバージョンを返す（Task 4 完了後）
- npmjs.com 上で Trusted Publisher が登録されている（人間が Task 4 で確認）
