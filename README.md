# aho-corasick-ts

TypeScript 7で実装した、実行時依存ゼロのAho–Corasick文字列検索ライブラリです。複数のキーワードを一度登録すれば、テキスト1回の走査で全キーワードの出現位置をまとめて取得できます。キーワードが何件あっても走査コストはほぼ変わりません。

## インストール

```sh
pnpm add aho-corasick-ts
# npm install aho-corasick-ts
# yarn add aho-corasick-ts
```

Node.js 22.12以降が必要です。ESMと型定義を同梱しており、22.12以降の`require(ESM)`からも読み込めます（古いNode向けのCJSビルドは含みません）。実行時依存はゼロで、Node固有のAPIも使っていないため、ブラウザのESMとしても利用できます（ブラウザでの性能検証は未実施です）。

## 使い方

### 基本

辞書を一度構築し、異なるテキストに何度でも適用します。

```ts
import { AhoCorasick } from 'aho-corasick-ts';

const matcher = new AhoCorasick(['he', 'she', 'hers']);

matcher.findAll('ushers');
// [
//   { patternIndex: 1, start: 1, end: 4 },  // she
//   { patternIndex: 0, start: 2, end: 4 },  // he
//   { patternIndex: 2, start: 2, end: 6 },  // hers
// ]

matcher.findAll('this here');
// [{ patternIndex: 0, start: 5, end: 7 }]
```

`patternIndex`はコンストラクタに渡した配列の添字、`start`と`end`は`String.slice`と同じUTF-16コード単位の位置（`end`は排他的）です。重なった一致も取りこぼしません。上の例では`she`・`he`・`hers`が同じ位置で重なっていますが3件すべて返ります。

**構築にはコストがかかるため、インスタンスは使い回してください。** 辞書が固定ならモジュールのトップレベルで一度作るのが基本です。

```ts
// ng-words.ts
export const ngWords = new AhoCorasick(['詐欺', '当選', '無料']);
```

`Iterable<string>`を受け取るので`Set`もそのまま渡せます。

```ts
new AhoCorasick(new Set(['ab', 'bc'])).count('abc'); // 2
```

### どのAPIを使うか

必要な情報だけを取るAPIを選ぶと、無駄な処理と割り当てを避けられます。

| 知りたいこと | API |
| --- | --- |
| 含まれるかどうかだけ | `test` — 最初の一致で即座に終了 |
| 件数だけ | `count` — 結果オブジェクトを一切作らない |
| 全一致を順に処理したい | `forEach` — 結果配列を作らずコールバックで通知 |
| 全一致を配列で受け取りたい | `findAll` — 扱いやすいが一致1件ごとにオブジェクトを生成 |
| 一致箇所を置換した文字列 | `replace` — 重なりのない一致だけを置換 |

```ts
const ng = new AhoCorasick(['詐欺', '当選', '無料']);

ng.test('無料キャンペーンに当選しました');  // true
ng.test('通常のお知らせ');                   // false
ng.count('無料無料');                        // 2（重なりと重複も数える）
```

一致が密なテキストでは`findAll`の割り当てが支配的になります。全件を1回ずつ処理するだけなら`forEach`のほうが速く、メモリも使いません。

### 一致箇所を取り出す

`patternIndex`から元のキーワードを引き、`slice`で該当箇所を取り出します。

```ts
const text = '無料キャンペーンに当選しました';

for (const { patternIndex, start, end } of ng.findAll(text)) {
  console.log(ng.patterns[patternIndex], text.slice(start, end), start, end);
}
// 無料 無料 0 2
// 当選 当選 9 11
```

`patterns`は入力をコピーした読み取り専用の配列です。

### 重なりのない一致だけを取る

既定（`matchKind: 'all'`）は重なった一致もすべて返します。ハイライトや置換のように区間が重なってはいけない用途では、`matchKind`で非重複の選択規則を指定します。

- `leftmost-longest` — 開始位置が最も左の一致を取り、同じ位置なら最長のパターンを選ぶ
- `leftmost-first` — 開始位置が最も左の一致を取り、同じ位置なら辞書で先に登録したパターンを選ぶ

一致を1件選ぶと、その終了位置から次の探索を再開します。

```ts
const kw = ['東京', '東京大学', '大学'];
const src = '東京大学と東京の大学';

new AhoCorasick(kw).findAll(src).length;   // 5（重なりを含む全件）

new AhoCorasick(kw, { matchKind: 'leftmost-longest' }).findAll(src);
// 東京大学@0, 東京@5, 大学@8

new AhoCorasick(kw, { matchKind: 'leftmost-first' }).findAll(src);
// 東京@0, 大学@2, 東京@5, 大学@8   ← 同じ位置では辞書で先の '東京' が勝つ
```

`findAll`・`forEach`・`count`は同じ規則に従います。`test`は一致の有無しか返さないため、どの`matchKind`でも結果は変わりません。非重複なので結果の順序は開始位置の昇順です。

### 置換する

`replace`は重なりのない一致を置換します。置換内容は3通りで指定できます。

```ts
const ng = new AhoCorasick(['詐欺', '無料', '無料ギフト']);

// 固定文字列
ng.replace('無料ギフトの案内、詐欺に注意', '＊');
// ＊の案内、＊に注意

// パターンごと（辞書と同じ長さの配列。長さが違えば RangeError）
ng.replace('無料ギフトの案内', ['〔詐欺〕', '〔無料〕', '〔無料ギフト〕']);
// 〔無料ギフト〕の案内

// 一致ごとに組み立てる
ng.replace('無料ギフトの案内', (patternIndex, start, end) => '＊'.repeat(end - start));
// ＊＊＊＊＊の案内
```

`matchKind: 'all'`のインスタンスは重なった一致を同時に置換できないため、`replace`だけは`leftmost-longest`として選択します。非重複の`matchKind`を指定している場合はその規則に従います。

```ts
new AhoCorasick(['ab', 'abc']).replace('abcab', '*');                                    // '**'
new AhoCorasick(['ab', 'abc'], { matchKind: 'leftmost-first' }).replace('abcab', '*');   // '*c*'
```

### パターンごとに集計する

`forEach`なら結果配列を作らずに集計できます。

```ts
const tally = new Array(ng.patterns.length).fill(0);
ng.forEach('無料無料と当選', patternIndex => { tally[patternIndex]++; });
// [0, 1, 2]  // 詐欺=0, 当選=1, 無料=2
```

### 途中で打ち切る

コールバックが厳密に`false`を返すと、その時点で走査を終了します。最初のN件だけ欲しい場合に、テキスト全体を走査せずに済みます。

```ts
import type { Match } from 'aho-corasick-ts';

const found: Match[] = [];
ng.forEach('無料で当選、詐欺に注意', (patternIndex, start, end) => {
  found.push({ patternIndex, start, end });
  if (found.length === 2) return false;   // ここで打ち切る
});
```

### 大文字小文字を無視する

`caseInsensitive`を指定すると、辞書とテキストを同じ規則で畳み込んでから照合します。**返る位置は元のテキストに対するもの**で、`patterns`も渡した文字列がそのまま残ります。

```ts
const ci = new AhoCorasick(['ERROR', 'Warning'], { caseInsensitive: true });

ci.findAll('Fatal error and WARNING');
// [{ patternIndex: 0, start: 6, end: 11 }, { patternIndex: 1, start: 16, end: 23 }]
ci.patterns;   // ['ERROR', 'Warning']（畳み込み後の文字列ではない）
```

畳み込みはUTF-16コード単位ごとに`toLowerCase()`を適用し、**結果が1コード単位になる場合だけ**採用します。ASCII・アクセント付きラテン文字・ギリシャ文字・キリル文字・全角英字などが対象です。長さの変わる変換（`'İ'.toLowerCase()`は2コード単位、`'ß'.toUpperCase()`は`'SS'`）はオフセット計算を壊すため採用しません。したがって次は一致しません。

```ts
new AhoCorasick(['ss'], { caseInsensitive: true }).test('ß');   // false
new AhoCorasick(['İ'], { caseInsensitive: true }).test('i');    // false
new AhoCorasick(['Σ'], { caseInsensitive: true }).test('ς');    // false（語末シグマは単独の小文字を持たない）
new AhoCorasick(['Σ'], { caseInsensitive: true }).test('σ');    // true
```

畳み込みはコード単位から列番号への変換表に吸収されるため、走査は大文字小文字を区別する場合とまったく同じループを通り、1文字あたりの追加コストはありません。変換表は1プロセスで1回だけ構築します（約4ms、128 KiB）。

### 単語単位でマッチする

`wholeWords`を指定すると、前後が単語構成文字である一致を捨てます。

```ts
const w = new AhoCorasick(['cat'], { wholeWords: true });

w.findAll('cat cats _cat (cat)').map(m => m.start);   // [0, 15]
```

単語構成文字の定義は`wordBoundary`で選びます。

| 値 | 単語構成文字 |
| --- | --- |
| `unicode`（既定） | `\p{L}`・`\p{N}`・`\p{M}`・`_` |
| `ascii` | `[A-Za-z0-9_]` |

`unicode`は日本語や結合文字も単語構成文字として扱います。`ascii`はASCII以外をすべて区切りとみなすため、日本語に埋め込まれた英単語を拾えます。

```ts
new AhoCorasick(['cat'], { wholeWords: true }).test('猫cat猫');                         // false
new AhoCorasick(['cat'], { wholeWords: true, wordBoundary: 'ascii' }).test('猫cat猫');   // true

// 結合文字を途中で切る一致も除外される
new AhoCorasick(['e'], { wholeWords: true }).test('e\u0301');   // false（é の分解形）
```

前後の判定はコード単位ではなくコードポイント単位で行うため、サロゲートペアの片側だけを見て誤判定することはありません。

### 遷移表のメモリを制限する

既定では64 MiBまで遷移表を確保します。上限を下げたい場合は`maxDenseBytes`を渡します。超える辞書では省メモリな疎な表現へ自動的に切り替わります。詳細は[実装とメモリ](#実装とメモリ)を参照してください。

```ts
const tuned = new AhoCorasick(['東京', '京都'], { maxDenseBytes: 8 * 1024 * 1024 });
tuned.stats;
// { states: 5, alphabetSize: 3, backend: 'dense', transitionBytes: 40, outputBytes: 28 }
```

### TypeScriptの型

`Match`・`MatchCallback`・`Options`・`MatchKind`・`WordBoundary`・`Replacement`をエクスポートしています。

```ts
import { AhoCorasick } from 'aho-corasick-ts';
import type { Match, MatchCallback, MatchKind, Options, Replacement, WordBoundary } from 'aho-corasick-ts';

const kind: MatchKind = 'leftmost-longest';
const boundary: WordBoundary = 'unicode';
const mask: Replacement = (patternIndex, start, end) => '*'.repeat(end - start);
const options: Options = { maxDenseBytes: 8 * 1024 * 1024, matchKind: kind, wordBoundary: boundary };
const matcher = new AhoCorasick(['he', 'she'], options);
const matches: Match[] = matcher.findAll('ushers');

const onMatch: MatchCallback = (patternIndex, start, end) => {
  if (start > 100) return false;   // 打ち切り
};
matcher.forEach('ushers', onMatch);
```

### 向かない用途

- パターンが呼び出しごとに変わる場合。構築コストを回収できません。
- 文字クラス・繰り返し・後方参照などの柔軟な照合。正規表現を使ってください（単語境界は`wholeWords`で扱えます）。
- 構築後の辞書の追加・削除。インスタンスは不変で、作り直しが必要です。
- チャンクをまたぐストリーム検索。状態は各呼び出し内に閉じています。

## 開発

Node.js 22.12以降、pnpm 11.9.0、TypeScript 7.x（lockfileで7.0.2を固定）。lintとフォーマットはBiome 2.5.12です。

```sh
pnpm install --frozen-lockfile
pnpm lint        # biome check .（lint + フォーマット検査）
pnpm lint:fix    # biome check --write .
pnpm typecheck
pnpm test
pnpm bench
pnpm pack
```

CIは`lint` → `typecheck` → `test` → `pack`をNode 22・24・26で実行します（22と24がLTS、26は現行版）。

Biomeの設定は[biome.jsonc](biome.jsonc)にあり、既定から外しているのは次の4点です（理由は設定ファイル内にコメントとして記載）。

- `style/noNonNullAssertion`を無効化 — `noUncheckedIndexedAccess`によりTypedArrayの読み出しには`!`が必要で、ルールの修正案`?.`は1文字ごとのループに実行時チェックを入れてしまいます。
- `suspicious/noConfusingVoidType`を無効化 — `MatchCallback`の`void | boolean`を`undefined | boolean`にすると、戻り値型を明示的に`void`と宣言したハンドラを渡せなくなり、公開APIの破壊的変更になります。
- `correctness/noUnusedPrivateClassMembers`を無効化 — Biome 2.5.12は`const { … } = this`でのみ読まれるフィールドを追えず、走査ループが巻き上げている4つのフィールドを未使用と誤検知します。同じ検査はtsconfigの`noUnusedLocals`が行っており、そちらは分割代入を正しく追えます。
- `bench/baseline.ts`・`bench/baseline.mjs`を対象外 — `pnpm bench --compare`が過去の実装を同一のコードで測るための凍結スナップショットです。

`pnpm pack`でnpm配布用のtgzを生成します。まだnpmには公開していません。スコープなしパッケージなので`npm publish`でそのまま公開できます。

## APIと一致の仕様

| API | 動作 |
| --- | --- |
| `new AhoCorasick(patterns, options?)` | `Iterable<string>`から辞書を構築 |
| `findAll(text): Match[]` | 報告対象の全一致のID・開始・終了位置 |
| `forEach(text, callback): void` | 結果配列を生成せず全件を通知 |
| `count(text): number` | 報告対象の一致数 |
| `test(text): boolean` | 一致の有無 |
| `replace(text, replacement): string` | 重なりのない一致を置換した文字列 |
| `patterns` | 入力をコピーした読み取り専用辞書 |
| `stats` | 状態数、文字種類数、backend、遷移表バイト数、出力索引バイト数 |

| Option | 既定 | 動作 |
| --- | --- | --- |
| `maxDenseBytes` | `67108864` | 密な遷移表に使う上限バイト数。`0`で疎な表現を強制 |
| `matchKind` | `'all'` | `'all'`は重なりを含む全件、`'leftmost-first'`・`'leftmost-longest'`は非重複 |
| `caseInsensitive` | `false` | コード単位ごとに小文字へ畳み込んで照合 |
| `wholeWords` | `false` | 前後が単語構成文字の一致を捨てる |
| `wordBoundary` | `'unicode'` | `wholeWords`の単語構成文字の定義（`'unicode'`・`'ascii'`） |

- 既定では大文字小文字を区別します。Unicode正規化は行いません（`caseInsensitive`と`wholeWords`は上記のとおり）。
- `matchKind`・`caseInsensitive`・`wholeWords`はすべて既定のままなら走査に追加コストを持ち込みません。既定値以外は`RangeError`です。
- 位置はJavaScriptの`String.slice`と同じUTF-16コード単位です。`end`は排他的です。日本語・絵文字・孤立サロゲート・NULを扱えます。
- `matchKind: 'all'`の順序は終了位置の昇順、同じ終了位置では長いパターンを優先し、同一パターンの重複は入力順です。非重複の`matchKind`では開始位置の昇順で、同じ開始位置の優劣は`matchKind`が決め、同一パターンの重複は最小のIDを返します。
- 非重複の選択は一致を確定するたびに終了位置から走査を再開するため、最悪計算量は`O(text.length × 最長パターン長)`です。現在の状態の深さから「次の一致が始まりうる最小位置」を求めて先読みを打ち切るので、実測ではテキスト長に対してほぼ線形です。
- `replace`は`matchKind: 'all'`のとき`leftmost-longest`として選択します。置換配列の長さが辞書と違えば`RangeError`、置換が文字列・配列・関数のいずれでもなければ`TypeError`です。
- 空の辞書は許可し、空文字パターンは`RangeError`、文字列以外のパターンは`TypeError`です。
- `forEach`はcallbackが厳密に`false`を返すと終了します。callbackの例外は呼び出し元へ伝播します。
- 検索状態は各呼び出し内にあり、callbackから再帰的に検索できます。ストリーム間の状態維持・動的な辞書更新は提供しません。

## 実装とメモリ

文字を圧縮したアルファベットとTypedArrayの完全遷移表（DFA）を使用します。65,536状態以下では`Uint16Array`、それ以上では`Uint32Array`です。検索中に失敗リンクを辿らず遷移できます。

`maxDenseBytes`は遷移表の予算で、デフォルトは64 MiBです。超える場合はMapと失敗リンクによる疎な表現へ切り替えます。`0`で疎な表現を強制できます。

```ts
const matcher = new AhoCorasick(['東京', '京都'], {
  maxDenseBytes: 8 * 1024 * 1024,
});
console.log(matcher.stats);
```

この予算は総メモリ制限ではありません。構築中のTrie、出力ID、失敗リンク、状態ごとの深さ（非重複選択の先読み打ち切りに使用）、256 KiBの文字マップなどは別途必要です。`caseInsensitive`を使うと、これに1プロセス共有の128 KiBの畳み込み表が加わります。`transitionBytes`はDFAの遷移表のみを計上し、疎な表現では0です。

一致した状態から報告するパターンIDは、接尾辞リンクを辿る代わりに状態ごとの連続領域へ平坦化した索引（CSR形式）から読み出します。走査は1状態あたり1回の範囲読み出しで済み、出力配列の間接参照とリンクの辿り直しがなくなります。継承分は複製するため、全状態の合計が4Mi件（16 MiB）を超える辞書では索引を作らず、従来の接尾辞リンク走査に戻します。`outputBytes`がこの索引の実バイト数で、上限を超えた場合は0です。長い接尾辞の連鎖を大量に含む辞書（例: 3,000件すべてが同一文字列の接尾辞）が該当します。

テキスト長をn、一致数をzとすると、全件検索はO(n + z)、`count`は事前集計した状態別件数を使うためO(n)です。`matchKind`で非重複を選ぶか`wholeWords`を使う場合、`count`はこの事前集計を使えず一致を1件ずつ選別します。平坦化した出力索引は状態ごとの一致件数の総和に比例するメモリを使います。DFA構築と遷移表は状態数×アルファベット数に比例する追加コストがあります。構築中の疎な失敗リンク探索では追加の走査が発生します。`findAll`はO(z)の結果メモリが必要です。大量一致時は`count`や`forEach`を利用してください。

## ベンチマーク

`pnpm bench`は固定seedの6種類の合成入力を使い、構築・全件検索・存在判定を分けて計測します。件数専用APIは別欄です。比較対象は`ahocorasick`、`modern-ahocorasick`、`@monyone/aho-corasick`（通常版とfast版）、Rustバインディングの`@stll/aho-corasick`です。

各組み合わせを別プロセスで実行し、独立した`String.indexOf`による正解と全件のID・位置を比較します。ウォームアップ60ms以上、7サンプル×35ms以上の中央値・最小値・最大値を記録します。正規化処理は測定外ですが、各API固有の結果生成は含みます。特に`ahocorasick`系は同じ終了位置の結果をまとめるため、全件を個別オブジェクトにするAPIとは割り当て量が異なります。

比較ライブラリの異常終了・不一致・タイムアウトは`skipped`に記録します。各子プロセスのJSヒープ上限は512 MiB、時間上限は30秒です。ネイティブメモリはこの上限の対象外です。本体の失敗はベンチマーク全体を失敗させます。

測定結果の要約は[bench/RESULTS.md](bench/RESULTS.md)にあります。比較したJS/TS実装には6条件すべてで勝っていますが、`small-dictionary`ではRustバインディングの`@stll/aho-corasick`が速く、一致が密な`suffix-heavy`では終了位置単位で結果をまとめる`ahocorasick`のほうが`findAll`の数値が小さくなります。

結果と環境、依存パッケージのバージョンは[bench/results.json](bench/results.json)に保存します。検索速度だけでなく構築時間も比較してください。合成入力・単一環境での結果であり、npm全体での最速を保証するものではありません。実データ、CPU、ランタイム、パターン数、一致密度によって順位は変わります。

MIT License.
