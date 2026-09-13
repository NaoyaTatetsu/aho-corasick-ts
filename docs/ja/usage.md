# 使い方

使い方の完全なガイドです。概要とインストールは[README.md](README.md)、厳密な仕様（順序・オフセット・例外）は[api.md](api.md)にあります。English: [../en/usage.md](../en/usage.md)。


## 基本

辞書を一度構築し、異なるテキストに何度でも適用します。

```ts
import { AhoCorasick } from '@naoya_tatetsu/aho-corasick-ts';

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

## どのAPIを使うか

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

## 一致箇所を取り出す

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

## 重なりのない一致だけを取る

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

## 置換する

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

## パターンごとに集計する

`forEach`なら結果配列を作らずに集計できます。

```ts
const tally = new Array(ng.patterns.length).fill(0);
ng.forEach('無料無料と当選', patternIndex => { tally[patternIndex]++; });
// [0, 1, 2]  // 詐欺=0, 当選=1, 無料=2
```

## 途中で打ち切る

コールバックが厳密に`false`を返すと、その時点で走査を終了します。最初のN件だけ欲しい場合に、テキスト全体を走査せずに済みます。

```ts
import type { Match } from '@naoya_tatetsu/aho-corasick-ts';

const found: Match[] = [];
ng.forEach('無料で当選、詐欺に注意', (patternIndex, start, end) => {
  found.push({ patternIndex, start, end });
  if (found.length === 2) return false;   // ここで打ち切る
});
```

## 大文字小文字を無視する

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

## 表記ゆれを吸収する

`caseInsensitive`が畳み込むのは英字の大小だけです。`fold`はその一般化で、**写像を自分で渡せます**。辞書とテキストの両方に適用されます。

```ts
import { AhoCorasick } from '@naoya_tatetsu/aho-corasick-ts';

// カタカナとひらがなは並行したブロックにあるので、引き算1つで対応が取れます。
const kana = (code: number) => (code >= 0x30a1 && code <= 0x30f6 ? code - 0x60 : code);

const ng = new AhoCorasick(['あほ'], { fold: kana });
ng.test('このアホが');              // true
ng.findAll('このアホが');           // [{ patternIndex: 0, start: 2, end: 4 }]
ng.patterns;                        // ['あほ'] — 渡した文字列のまま
```

**位置は元のテキスト基準のまま**です。写像がコード単位単位なのはそのためで、長さが変わる写像を許すと、それ以降のすべての位置がずれてしまいます。UTF-16コード単位でない値を返すと`RangeError`です。

大文字小文字も畳み込みたい場合は、`caseInsensitive`が使っているのと同じ写像`foldCase`を合成します。`caseInsensitive`と`fold`の同時指定は`RangeError`です（どちらの写像を優先するかが決まらないため）。

```ts
import { AhoCorasick, foldCase } from '@naoya_tatetsu/aho-corasick-ts';

const ac = new AhoCorasick(['アホ'], { fold: code => kana(foldCase(code)) });
ac.test('あほ');   // true
```

写像は**両辺に1回ずつ**適用されます。辞書の語とテキストは、それぞれ1回適用した結果が同じコード単位になったときに一致します。冪等でない写像を渡す場合はこの点に注意してください。

`fold`はコード単位から列番号への変換表に吸収されるため、走査は畳み込み無しの場合と同じループを通ります。実測でも、1,200語の辞書で12,000語のテキストを走査したとき、生成される自動機はbackend・アルファベット数・遷移表バイト数まで同一で、所要時間の差は測定誤差の範囲でした。コストは構築時に一度だけ、65,536個のコード単位それぞれに対して写像を呼ぶ分だけ発生します。

## 単語単位でマッチする

`wholeWords`を指定すると、前後が単語構成文字である一致を捨てます。

```ts
const w = new AhoCorasick(['cat'], { wholeWords: true });

w.findAll('cat cats _cat (cat)').map(m => m.start);   // [0, 15]
```

単語構成文字の定義は`wordBoundary`で選びます。`wholeWords`と併用したときにだけ意味を持つため、単独で指定すると`RangeError`になります（黙って無視されることはありません）。

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

## 遷移表のメモリを制限する

既定では64 MiBまで遷移表を確保します。上限を下げたい場合は`maxDenseBytes`を渡します。超える辞書では省メモリな疎な表現へ自動的に切り替わります。詳細は[internals.md](internals.md)を参照してください。

```ts
const tuned = new AhoCorasick(['東京', '京都'], { maxDenseBytes: 8 * 1024 * 1024 });
tuned.stats;
// { states: 5, alphabetSize: 3, backend: 'dense', transitionBytes: 40, outputBytes: 28 }
```

## TypeScriptの型

`Match`・`MatchCallback`・`Options`・`MatchKind`・`WordBoundary`・`Replacement`と、関数`foldCase`をエクスポートしています。

```ts
import { AhoCorasick } from '@naoya_tatetsu/aho-corasick-ts';
import type { Match, MatchCallback, MatchKind, Options, Replacement, WordBoundary } from '@naoya_tatetsu/aho-corasick-ts';

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

## 向かない用途

- パターンが呼び出しごとに変わる場合。構築コストを回収できません。
- 文字クラス・繰り返し・後方参照などの柔軟な照合。正規表現を使ってください（単語境界は`wholeWords`で扱えます）。
- 構築後の辞書の追加・削除。インスタンスは不変で、作り直しが必要です。
- チャンクをまたぐストリーム検索。状態は各呼び出し内に閉じています。
