# @naoya-tatetsu/aho-corasick

TypeScript 7で実装した、実行時依存ゼロのAho–Corasick文字列検索ライブラリです。複数パターンを一度構築し、異なるテキストに繰り返し適用できます。

```ts
import { AhoCorasick } from '@naoya-tatetsu/aho-corasick';

const matcher = new AhoCorasick(['he', 'she', 'hers']);
matcher.findAll('ushers');
// [
//   { patternIndex: 1, start: 1, end: 4 },
//   { patternIndex: 0, start: 2, end: 4 },
//   { patternIndex: 2, start: 2, end: 6 },
// ]
matcher.count('ushers'); // 3。結果オブジェクトを生成しない
matcher.test('ushers');  // true。最初の一致で終了
matcher.forEach('ushers', (patternIndex, start, end) => {
  console.log(patternIndex, start, end);
  // falseを返すと検索を終了
});
```

## 開発

Node.js 22.12以降、pnpm 11.9.0、TypeScript 7.x（lockfileで7.0.2を固定）。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm bench
pnpm pack
```

`pnpm pack`でnpm配布用のtgzを生成します。まだnpmには公開していません。scopedパッケージのため`publishConfig.access`に`public`を設定済みで、`npm publish`で公開できます（`@naoya-tatetsu`スコープが公開アカウントと一致している必要があります）。ESMと型定義を出力し、Node.js 22.12以降の`require(ESM)`でも読み込めます（古いNode向けCJSビルドは含みません）。本体はNode固有APIを使わず、ブラウザのESMとしても利用可能です。ブラウザでの性能検証は未実施です。

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
