# 開発

このパッケージを開発するための情報です。English: [../en/development.md](../en/development.md)。


このパッケージの開発にはNode.js 22.12以降が必要です（テストランナーのカバレッジ計測と型ストリッピングが要求するためで、パッケージ自体は18で動きます）。pnpm・TypeScript・Biomeのバージョンは`package.json`に固定してあり、ここに数字を書き写すとRenovateの更新で古くなるため記載しません。

```sh
pnpm install --frozen-lockfile
pnpm lint        # biome check .（lint + フォーマット検査）
pnpm lint:fix    # biome check --write .
pnpm typecheck
pnpm test
pnpm coverage    # 同じテストをNode組み込みのカバレッジ計測付きで実行
pnpm benchmark
pnpm example     # example/ の全プログラムを実行
pnpm pack
```

CIは`lint` → `typecheck` → `test` → `pack`をNode 22・24・26で実行します（22と24がLTS、26は現行版）。プルリクエストではさらにNode 24で1回だけカバレッジを計測し、結果をコメントとして投稿します。push のたびに増やさず、既存のコメントを更新します。テストランナーの固定幅の表をコメント用のMarkdownに変換しているのは[.github/scripts/coverage-comment.mjs](../../.github/scripts/coverage-comment.mjs)で、保存したレポートを食わせれば出力を手元で確認できます。

カバレッジは実際に配布される`dist/**`だけを対象にしているため、行番号は`src/index.ts`ではなくコンパイル後のものです。除外を並べるのではなく対象を明示する形にしてあるので、新しいファイルが数値に紛れ込むことはありません。例はテストから実行されますがドキュメントであり、`.github/scripts/`はリリース用のツールで、どちらも配布物ではありません。これらを数えると、本体が100%であるにもかかわらず見出しが95%と読める状態になっていました。その結果 `check-release.mjs` が計測対象外になりますが、ロジックは`test/release-gate.test.mjs`が、レジストリ呼び出しは実レジストリに対する実行で確認しています。`--experimental-test-coverage`に追加の依存は不要です。閾値（`--test-coverage-lines`など）も使えますが、整数しか受け付けないため現在は設定していません。

Biomeの設定は[biome.jsonc](../../biome.jsonc)にあり、既定から外しているのは次の3点です（理由は設定ファイル内にコメントとして記載）。

- `style/noNonNullAssertion`を無効化 — `noUncheckedIndexedAccess`によりTypedArrayの読み出しには`!`が必要で、ルールの修正案`?.`は1文字ごとのループに実行時チェックを入れてしまいます。
- `suspicious/noConfusingVoidType`を無効化 — `MatchCallback`の`void | boolean`を`undefined | boolean`にすると、戻り値型を明示的に`void`と宣言したハンドラを渡せなくなり、公開APIの破壊的変更になります。
- `benchmark/baseline.ts`・`benchmark/baseline.mjs`を対象外 — `pnpm benchmark --compare`が過去の実装を同一のコードで測るための凍結スナップショットです。

## 公開

`pnpm pack`は何も送信せずにnpm配布用のtgzを生成します。`prepack`がビルドし、`prepublishOnly`がlint・typecheck・testを実行するため、壊れた状態のままレジストリへ到達することはありません。

リリースは[.github/workflows/release.yml](../../.github/workflows/release.yml)から行います。`main`へのpushごとに走り、そのpushがリリースかどうかをワークフロー自身が判定します。判定しているのは[.github/scripts/check-release.mjs](../../.github/scripts/check-release.mjs)で、受け入れるより拒否するほうが多い作りです。

- レジストリに既にあるバージョンはリリースではないため、通常のマージ（Renovateの自動マージを含む）は静かにそこで止まります
- 公開済みより低いバージョン、または1段階の増加になっていないバージョンは**失敗させます**。`0.1.0`から`0.11.0`は`0.1.1`の打ち間違いであってリリースではありません
- [CHANGELOG.md](../../CHANGELOG.md)に`## <version>`の節が無い場合も失敗します。記録の無いリリースが出ないようにするためです

公開の認証はnpmのtrusted publishingで、ジョブがGitHubからOIDCトークンを受け取り、npmがそれを短命な資格情報と交換します。**このリポジトリに長期のnpmトークンは保存しません。** provenanceは自動で付与されます。公開後はコミットにタグを打ち、いま検査したCHANGELOGの節を本文としてGitHub Releaseを作成します。プレリリースの場合は`next` dist-tagで公開されるため、betaが`npm install`の既定になることはありません。

リリース手順は、`pnpm version <patch|minor|major> --no-git-tag-version`を実行し、CHANGELOGの`Unreleased`見出しを日付付きでそのバージョンに繰り下げたPRを作るだけです。**マージした時点で公開されます。**

`--no-git-tag-version`は必須です。付けないとpnpm 12はバージョン変更をコミットし、ローカルにタグまで作ります。そのタグはブランチ上のコミットを指しており、`main`に載るコミットとは別物です。タグはワークフローがマージコミットに対して打ちます。

**初回公開だけはこのワークフローを使えません。** npmのtrusted publishingはパッケージの設定ページで構成するもので、PyPIのpending publisherに相当する仕組みが無いため、パッケージが存在しないと信頼関係を結べません。0.1.0はローカルの`npm publish`で公開し、その後npmjs.comでこのリポジトリと`release.yml`をtrusted publisherとして登録すれば、以降のリリースはCIから実行されます。
