# 開発

このパッケージを開発するための情報です。English: [../en/development.md](../en/development.md)。


Node.js 22.12以降。pnpm・TypeScript・Biomeのバージョンは`package.json`に固定してあり、ここに数字を書き写すとRenovateの更新で古くなるため記載しません。

```sh
pnpm install --frozen-lockfile
pnpm lint        # biome check .（lint + フォーマット検査）
pnpm lint:fix    # biome check --write .
pnpm typecheck
pnpm test
pnpm coverage    # 同じテストをNode組み込みのカバレッジ計測付きで実行
pnpm benchmark
pnpm pack
```

CIは`lint` → `typecheck` → `test` → `pack`をNode 22・24・26で実行します（22と24がLTS、26は現行版）。プルリクエストではさらにNode 24で1回だけカバレッジを計測し、結果をコメントとして投稿します。push のたびに増やさず、既存のコメントを更新します。テストランナーの固定幅の表をコメント用のMarkdownに変換しているのは[.github/scripts/coverage-comment.mjs](../../.github/scripts/coverage-comment.mjs)で、保存したレポートを食わせれば出力を手元で確認できます。

カバレッジはテストが読み込む`dist/index.js`に対して計測されるため、行番号はコンパイル後のものです。`--experimental-test-coverage`に追加の依存は不要です。閾値（`--test-coverage-lines`など）も使えますが、整数しか受け付けないため現在は設定していません。

Biomeの設定は[biome.jsonc](../../biome.jsonc)にあり、既定から外しているのは次の3点です（理由は設定ファイル内にコメントとして記載）。

- `style/noNonNullAssertion`を無効化 — `noUncheckedIndexedAccess`によりTypedArrayの読み出しには`!`が必要で、ルールの修正案`?.`は1文字ごとのループに実行時チェックを入れてしまいます。
- `suspicious/noConfusingVoidType`を無効化 — `MatchCallback`の`void | boolean`を`undefined | boolean`にすると、戻り値型を明示的に`void`と宣言したハンドラを渡せなくなり、公開APIの破壊的変更になります。
- `benchmark/baseline.ts`・`benchmark/baseline.mjs`を対象外 — `pnpm benchmark --compare`が過去の実装を同一のコードで測るための凍結スナップショットです。

## 公開

`pnpm pack`は何も送信せずにnpm配布用のtgzを生成します。`prepack`がビルドし、`prepublishOnly`がlint・typecheck・testを実行するため、壊れた状態のままレジストリへ到達することはありません。

リリースは[.github/workflows/release.yml](../../.github/workflows/release.yml)から行い、GitHub Releaseの公開をトリガーとします。認証はnpmのtrusted publishingで、ジョブがGitHubからOIDCトークンを受け取り、npmがそれを短命な資格情報と交換します。**このリポジトリに長期のnpmトークンは保存しません。** provenanceは自動で付与されます。リリースタグと`package.json`のバージョンが食い違う場合、ジョブは公開を拒否します。

リリース手順は、`package.json`のバージョンを設定し、[CHANGELOG.md](../../CHANGELOG.md)の`Unreleased`見出しを日付付きでそのバージョンに繰り下げ、`v<version>`のタグでGitHub Releaseを公開する、の3つです。**タグをpushしただけでは公開されません** — ワークフローはタグではなくReleaseに反応します。プレリリースとして公開した場合は`next` dist-tagで公開されるため、betaが`npm install`の既定になることはありません。

**初回公開だけはこのワークフローを使えません。** npmのtrusted publishingはパッケージの設定ページで構成するもので、PyPIのpending publisherに相当する仕組みが無いため、パッケージが存在しないと信頼関係を結べません。0.1.0はローカルの`npm publish`で公開し、その後npmjs.comでこのリポジトリと`release.yml`をtrusted publisherとして登録すれば、以降のリリースはCIから実行されます。
