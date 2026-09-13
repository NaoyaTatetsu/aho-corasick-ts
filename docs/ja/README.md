# @naoya_tatetsu/aho-corasick-ts [![Test](https://github.com/NaoyaTatetsu/aho-corasick-ts/actions/workflows/test.yml/badge.svg)](https://github.com/NaoyaTatetsu/aho-corasick-ts/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/@naoya_tatetsu/aho-corasick-ts)](https://www.npmjs.com/package/@naoya_tatetsu/aho-corasick-ts) [![license](https://img.shields.io/badge/license-MIT-blue)](../../LICENSE)

**@naoya_tatetsu/aho-corasick-ts**は、実行時依存ゼロのTypeScript向け[Aho–Corasick](https://ja.wikipedia.org/wiki/エイホ–コラシック法)文字列検索ライブラリです。

複数のキーワードを一度登録すれば、テキスト1回の走査で全キーワードの出現位置をまとめて取得できます。キーワードが何件あっても走査コストはほぼ変わりません。

English documentation is at [README.md](../../README.md).

## インストール

```sh
pnpm add @naoya_tatetsu/aho-corasick-ts
# npm install @naoya_tatetsu/aho-corasick-ts
# yarn add @naoya_tatetsu/aho-corasick-ts
```

Node.js 22.12以降が必要です。ESMと型定義を同梱しており、22.12以降の`require(ESM)`からも読み込めます。ただしNode 22では読み込み時に`ExperimentalWarning`が出ます（Node 24以降では出ません）。古いNode向けのCJSビルドは含みません。実行時依存はゼロで、Node固有のAPIも使っていないため、ブラウザのESMとしても利用できます（ブラウザでの性能検証は未実施です）。

## はじめに

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
ng.count('無料無料');                        // 2（重なりと重複も数える）
ng.replace('無料キャンペーンに当選しました', '＊');
// ＊キャンペーンに＊しました
```

## 既定の外側

既定で足りない場合に使うオプションが4つあります。いずれも指定しなければ走査に追加コストを持ち込みません。

| Option | 動作 |
| --- | --- |
| `matchKind` | 重なりを含む全件ではなく、非重複の一致を返す（`leftmost-first`・`leftmost-longest`） |
| `caseInsensitive` | 大文字小文字を畳み込んで照合する。位置は元のテキスト基準のまま |
| `fold` | コード単位ごとの写像を適用してから照合する。カタカナ→ひらがな、全角→半角など |
| `wholeWords` | 前後が単語構成文字である一致を捨てる |
| `maxDenseBytes` | 遷移表の上限を決める。超える辞書は疎な表現へ切り替わる |

```ts
const kw = new AhoCorasick(['東京', '東京大学', '大学'], { matchKind: 'leftmost-longest' });
kw.findAll('東京大学と東京の大学');
// 東京大学@0, 東京@5, 大学@8 — 重なりなし
```

詳細は[usage.md](usage.md)にあります。

## ドキュメント

| | |
| --- | --- |
| [usage.md](usage.md) | 使い方の完全なガイド |
| [api.md](api.md) | 全メンバー、順序保証、オフセット、計算量、例外 |
| [internals.md](internals.md) | オートマトンの構造とメモリ |
| [benchmark.md](benchmark.md) | 計測方法と、他4実装との比較結果 |
| [development.md](development.md) | このパッケージの開発 |
| [../../README.md](../../README.md) | 以上の英語版 |

## 向かない用途

パターンが呼び出しごとに変わる場合、正規表現が必要な柔軟な照合、構築後に変わる辞書、チャンクをまたぐストリーム検索。詳細は[usage.md](usage.md)の末尾を参照してください。

MIT License.
