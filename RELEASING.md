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

   | 項目              | 値                                |
   | ----------------- | --------------------------------- |
   | Organization/User | `mokume3`                         |
   | Repository        | `vite-plugin-query-cache-busting` |
   | Workflow file     | `.github/workflows/publish.yml`   |
   | Environment       | （設定しない）                    |

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
