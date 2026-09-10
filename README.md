# @naoya-tatetsu/aho-corasick

TypeScript 7で実装した、実行時依存ゼロのAho–Corasick文字列検索ライブラリです。複数のキーワードを一度登録すれば、テキスト1回の走査で全キーワードの出現位置をまとめて取得できます。キーワードが何件あっても走査コストはほぼ変わりません。

## インストール

```sh
pnpm add @naoya-tatetsu/aho-corasick
# npm install @naoya-tatetsu/aho-corasick
# yarn add @naoya-tatetsu/aho-corasick
```

Node.js 22.12以降が必要です。ESMと型定義を同梱しており、22.12以降の`require(ESM)`からも読み込めます（古いNode向けのCJSビルドは含みません）。実行時依存はゼロで、Node固有のAPIも使っていないため、ブラウザのESMとしても利用できます（ブラウザでの性能検証は未実施です）。

## 使い方

### 基本

辞書を一度構築し、異なるテキストに何度でも適用します。

```ts
import { AhoCorasick } from '@naoya-tatetsu/aho-corasick';

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

### 重なりを解消する

`findAll`は重なった一致をすべて返すので、ハイライトや置換に使うには重なりのない集合へ絞る必要があります。**結果は終了位置の昇順で届くため、素直に前から貪欲に選ぶと短いキーワードが優先されてしまいます。**

```ts
const kw = new AhoCorasick(['東京', '東京大学', '大学']);
const src = '東京大学と東京の大学';

// 素直な貪欲法は「東京」を先に取ってしまう
// -> 東京, 大学, 東京, 大学
```

左から最長を優先する（leftmost-longest）には、開始位置の昇順・長さの降順に並べ替えてから選びます。

```ts
function leftmostLongest(ac: AhoCorasick, text: string) {
  const all = ac.findAll(text);
  all.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const picked = [];
  let lastEnd = 0;
  for (const m of all) {
    if (m.start >= lastEnd) {
      picked.push(m);
      lastEnd = m.end;
    }
  }
  return picked;
}

leftmostLongest(kw, src);
// 東京大学@0, 東京@5, 大学@8
```

これを使えばマスクやハイライトが素直に書けます。

```ts
function replaceMatches(ac: AhoCorasick, text: string, wrap: (hit: string) => string) {
  let out = '';
  let cursor = 0;
  for (const m of leftmostLongest(ac, text)) {
    out += text.slice(cursor, m.start) + wrap(text.slice(m.start, m.end));
    cursor = m.end;
  }
  return out + text.slice(cursor);
}

replaceMatches(kw, src, hit => `<mark>${hit}</mark>`);
// <mark>東京大学</mark>と<mark>東京</mark>の<mark>大学</mark>

const ng2 = new AhoCorasick(['詐欺', '無料', '無料ギフト']);
replaceMatches(ng2, '無料ギフトの案内、詐欺に注意', hit => '＊'.repeat(hit.length));
// ＊＊＊＊＊の案内、＊＊に注意
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
import type { Match } from '@naoya-tatetsu/aho-corasick';

const found: Match[] = [];
ng.forEach('無料で当選、詐欺に注意', (patternIndex, start, end) => {
  found.push({ patternIndex, start, end });
  if (found.length === 2) return false;   // ここで打ち切る
});
```

### 大文字小文字を無視する

大文字小文字は区別します。無視したい場合は、辞書とテキストの両方を同じ方法で正規化してください。

```ts
const ci = new AhoCorasick(['error', 'warning'].map(p => p.toLowerCase()));
ci.test('Fatal ERROR occurred'.toLowerCase());  // true
```

ただし返る位置は正規化後の文字列に対するものです。ASCIIや日本語では`toLowerCase()`が長さを変えないので元のテキストにもそのまま使えますが、一部のUnicode文字は長さが変わるため（`'İ'.toLowerCase().length === 2`）オフセットがずれます。元テキストの位置が必要でUnicode全般を扱うなら、正規化後の文字列を保持して`slice`してください。

### 遷移表のメモリを制限する

既定では64 MiBまで遷移表を確保します。上限を下げたい場合は`maxDenseBytes`を渡します。超える辞書では省メモリな疎な表現へ自動的に切り替わります。詳細は[実装とメモリ](#実装とメモリ)を参照してください。

```ts
const tuned = new AhoCorasick(['東京', '京都'], { maxDenseBytes: 8 * 1024 * 1024 });
tuned.stats;
// { states: 5, alphabetSize: 3, backend: 'dense', transitionBytes: 40, outputBytes: 28 }
```

### TypeScriptの型

`Match`・`MatchCallback`・`Options`をエクスポートしています。

```ts
import { AhoCorasick } from '@naoya-tatetsu/aho-corasick';
import type { Match, MatchCallback, Options } from '@naoya-tatetsu/aho-corasick';

const options: Options = { maxDenseBytes: 8 * 1024 * 1024 };
const matcher = new AhoCorasick(['he', 'she'], options);
const matches: Match[] = matcher.findAll('ushers');

const onMatch: MatchCallback = (patternIndex, start, end) => {
  if (start > 100) return false;   // 打ち切り
};
matcher.forEach('ushers', onMatch);
```

### 向かない用途

- パターンが呼び出しごとに変わる場合。構築コストを回収できません。
- 文字クラス・繰り返し・単語境界などの柔軟な照合。正規表現を使ってください。
- 構築後の辞書の追加・削除。インスタンスは不変で、作り直しが必要です。
- チャンクをまたぐストリーム検索。状態は各呼び出し内に閉じています。

## 開発

Node.js 22.12以降、pnpm 11.9.0、TypeScript 7.x（lockfileで7.0.2を固定）。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm bench
pnpm pack
```

`pnpm pack`でnpm配布用のtgzを生成します。まだnpmには公開していません。scopedパッケージのため`publishConfig.access`に`public`を設定済みで、`npm publish`で公開できます（`@naoya-tatetsu`スコープが公開アカウントと一致している必要があります）。

## APIと一致の仕様

| API | 動作 |
| --- | --- |
| `new AhoCorasick(patterns, options?)` | `Iterable<string>`から辞書を構築 |
| `findAll(text): Match[]` | 重なりを含む全件のID・開始・終了位置 |
| `forEach(text, callback): void` | 結果配列を生成せず全件を通知 |
| `count(text): number` | 重なりと重複パターンを含む一致数 |
| `test(text): boolean` | 一致の有無 |
| `patterns` | 入力をコピーした読み取り専用辞書 |
| `stats` | 状態数、文字種類数、backend、遷移表バイト数、出力索引バイト数 |

- 大文字小文字を区別し、Unicode正規化や単語境界の判定はしません。
- 位置はJavaScriptの`String.slice`と同じUTF-16コード単位です。`end`は排他的です。日本語・絵文字・孤立サロゲート・NULを扱えます。
- 順序は終了位置の昇順、同じ終了位置では長いパターンを優先し、同一パターンの重複は入力順です。
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

この予算は総メモリ制限ではありません。構築中のTrie、出力ID、失敗リンク、256 KiBの文字マップなどは別途必要です。`transitionBytes`はDFAの遷移表のみを計上し、疎な表現では0です。

一致した状態から報告するパターンIDは、接尾辞リンクを辿る代わりに状態ごとの連続領域へ平坦化した索引（CSR形式）から読み出します。走査は1状態あたり1回の範囲読み出しで済み、出力配列の間接参照とリンクの辿り直しがなくなります。継承分は複製するため、全状態の合計が4Mi件（16 MiB）を超える辞書では索引を作らず、従来の接尾辞リンク走査に戻します。`outputBytes`がこの索引の実バイト数で、上限を超えた場合は0です。長い接尾辞の連鎖を大量に含む辞書（例: 3,000件すべてが同一文字列の接尾辞）が該当します。

テキスト長をn、一致数をzとすると、全件検索はO(n + z)、`count`は事前集計した状態別件数を使うためO(n)です。平坦化した出力索引は状態ごとの一致件数の総和に比例するメモリを使います。DFA構築と遷移表は状態数×アルファベット数に比例する追加コストがあります。構築中の疎な失敗リンク探索では追加の走査が発生します。`findAll`はO(z)の結果メモリが必要です。大量一致時は`count`や`forEach`を利用してください。

## ベンチマーク

`pnpm bench`は固定seedの6種類の合成入力を使い、構築・全件検索・存在判定を分けて計測します。件数専用APIは別欄です。比較対象は`ahocorasick`、`modern-ahocorasick`、`@monyone/aho-corasick`（通常版とfast版）、Rustバインディングの`@stll/aho-corasick`です。

各組み合わせを別プロセスで実行し、独立した`String.indexOf`による正解と全件のID・位置を比較します。ウォームアップ60ms以上、7サンプル×35ms以上の中央値・最小値・最大値を記録します。正規化処理は測定外ですが、各API固有の結果生成は含みます。特に`ahocorasick`系は同じ終了位置の結果をまとめるため、全件を個別オブジェクトにするAPIとは割り当て量が異なります。

比較ライブラリの異常終了・不一致・タイムアウトは`skipped`に記録します。各子プロセスのJSヒープ上限は512 MiB、時間上限は30秒です。ネイティブメモリはこの上限の対象外です。本体の失敗はベンチマーク全体を失敗させます。

測定結果の要約は[bench/RESULTS.md](bench/RESULTS.md)にあります。比較したJS/TS実装には6条件すべてで勝っていますが、`small-dictionary`ではRustバインディングの`@stll/aho-corasick`が速く、一致が密な`suffix-heavy`では終了位置単位で結果をまとめる`ahocorasick`のほうが`findAll`の数値が小さくなります。

結果と環境、依存パッケージのバージョンは[bench/results.json](bench/results.json)に保存します。検索速度だけでなく構築時間も比較してください。合成入力・単一環境での結果であり、npm全体での最速を保証するものではありません。実データ、CPU、ランタイム、パターン数、一致密度によって順位は変わります。

MIT License.
