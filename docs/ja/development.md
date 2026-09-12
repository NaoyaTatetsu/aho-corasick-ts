# 開発

このパッケージを開発するための情報です。English: [../en/development.md](../en/development.md)。


Node.js 22.12以降、pnpm 11.9.0、TypeScript 7.x（lockfileで7.0.2を固定）。lintとフォーマットはBiome 2.5.12です。

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

CIは`lint` → `typecheck` → `test` → `pack`をNode 22・24・26で実行します（22と24がLTS、26は現行版）。プルリクエストではさらにNode 24で1回だけカバレッジを計測し、結果をコメントとして投稿します。push のたびに増やさず、既存のコメントを更新します。

カバレッジはテストが読み込む`dist/index.js`に対して計測されるため、行番号はコンパイル後のものです。`--experimental-test-coverage`に追加の依存は不要です。閾値（`--test-coverage-lines`など）も使えますが、整数しか受け付けないため現在は設定していません。

Biomeの設定は[biome.jsonc](../../biome.jsonc)にあり、既定から外しているのは次の4点です（理由は設定ファイル内にコメントとして記載）。

- `style/noNonNullAssertion`を無効化 — `noUncheckedIndexedAccess`によりTypedArrayの読み出しには`!`が必要で、ルールの修正案`?.`は1文字ごとのループに実行時チェックを入れてしまいます。
- `suspicious/noConfusingVoidType`を無効化 — `MatchCallback`の`void | boolean`を`undefined | boolean`にすると、戻り値型を明示的に`void`と宣言したハンドラを渡せなくなり、公開APIの破壊的変更になります。
- `correctness/noUnusedPrivateClassMembers`を無効化 — Biome 2.5.12は`const { … } = this`でのみ読まれるフィールドを追えず、走査ループが巻き上げている4つのフィールドを未使用と誤検知します。同じ検査はtsconfigの`noUnusedLocals`が行っており、そちらは分割代入を正しく追えます。
- `benchmark/baseline.ts`・`benchmark/baseline.mjs`を対象外 — `pnpm benchmark --compare`が過去の実装を同一のコードで測るための凍結スナップショットです。

`pnpm pack`でnpm配布用のtgzを生成します。まだnpmには公開していません。スコープなしパッケージなので`npm publish`でそのまま公開できます。
