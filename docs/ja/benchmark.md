# ベンチマーク

計測の方法と結果です。実装の解説は[internals.md](internals.md)にあります。English: [../en/benchmark.md](../en/benchmark.md)。

## 計測方法

`pnpm benchmark`は固定seedの6種類の合成入力を使い、構築・全件検索・存在判定を分けて計測します。件数専用APIは別欄です。比較対象は`ahocorasick`、`modern-ahocorasick`、`@monyone/aho-corasick`（通常版とfast版）、Rustバインディングの`@stll/aho-corasick`です。

各組み合わせを別プロセスで実行し、独立した`String.indexOf`による正解と全件のID・位置を比較します。ウォームアップ60ms以上、7サンプル×35ms以上の中央値・最小値・最大値を記録します。正規化処理は測定外ですが、各API固有の結果生成は含みます。特に`ahocorasick`系は同じ終了位置の結果をまとめるため、全件を個別オブジェクトにするAPIとは割り当て量が異なります。

比較ライブラリの異常終了・不一致・タイムアウトは`skipped`に記録します。各子プロセスのJSヒープ上限は512 MiB、時間上限は30秒です。ネイティブメモリはこの上限の対象外です。本体の失敗はベンチマーク全体を失敗させます。

測定結果の要約はこの下の表にあります。比較したJS/TS実装には6条件すべてで勝っていますが、`small-dictionary`ではRustバインディングの`@stll/aho-corasick`が速く、一致が密な`suffix-heavy`では終了位置単位で結果をまとめる`ahocorasick`のほうが`findAll`の数値が小さくなります。

結果と環境、依存パッケージのバージョンは[benchmark/results.json](../../benchmark/results.json)に保存します。検索速度だけでなく構築時間も比較してください。合成入力・単一環境での結果であり、npm全体での最速を保証するものではありません。実データ、CPU、ランタイム、パターン数、一致密度によって順位は変わります。

## 結果

Measured: 2026-09-10T16:23:57.965Z
Node v22.12.0; darwin arm64; Apple M2 Max

全件検索の中央値（ms/call）。各APIの結果形式・割り当て量は異なります。合成入力のみの結果です。

| Scenario | Local `findAll` | Local `forEach` | Best other JS/TS | Rust binding |
| --- | ---: | ---: | ---: | ---: |
| ascii-many | 0.432 | 0.416 | 2.362 (@monyone/aho-corasick/fast) | 0.467 |
| ascii-no-match | 0.043 | 0.044 | 1.211 (@monyone/aho-corasick/fast) | 0.180 |
| small-dictionary | 0.317 | 0.282 | 1.064 (@monyone/aho-corasick/fast) | 0.220 |
| suffix-heavy | 2.498 | 0.591 | 0.040 (ahocorasick) | 5.857 |
| unicode | 0.709 | 0.397 | 2.370 (@monyone/aho-corasick/fast) | 2.592 |
| large-alphabet | 0.226 | 0.187 | 0.662 (@monyone/aho-corasick/fast) | 0.673 |

比較したJS/TS実装には全条件で勝っていますが、全条件で最速ではありません。

- `suffix-heavy`では`ahocorasick`が桁違いに速く見えますが、同じ終了位置の一致を1行にまとめて返すためです。この入力は4,000文字に対して95,724件が一致し、本実装は1件ごとにオブジェクトを生成します。結果オブジェクトを作らない`forEach`では0.591msです。一致が密な入力では`forEach`か`count`を使ってください。
- `small-dictionary`ではRustバインディングの`@stll/aho-corasick`が速いです（0.220ms対0.317ms）。それ以外の5条件では本実装が上回ります。
- count専用APIは全件結果を生成しないため、この表には含めていません。

modern-ahocorasickのUnicodeおよびlarge-alphabetケースは、子プロセスに課した512 MiBのヒープ上限に達して異常終了しました。上限は本ベンチが設定したものなので、この失敗を性能上の勝利として扱いません。記録は[results.json](../../benchmark/results.json)のskippedにあります。

## 出力リンクの平坦化による改善

接尾辞リンクを辿る出力の走査を、状態ごとの連続領域（CSR形式）へ平坦化した効果です。`pnpm benchmark --compare`で計測した2回の実行の比です。

| Scenario | `findAll` | `forEach` |
| --- | ---: | ---: |
| ascii-many | 1.08x / 1.10x | 1.06x / 1.06x |
| unicode | 1.16x / 1.11x | 1.10x / 1.09x |
| large-alphabet | 1.12x / 1.16x | 1.10x / 1.07x |
| sparse-many | 1.08x / 1.09x | 1.06x / 1.10x |
| suffix-heavy | 0.65x / 1.06x | 1.31x / 1.34x |

一致件数の多い`findAll`は結果オブジェクトの割り当てとGCが支配的で、実行ごとのばらつきが大きく、`suffix-heavy`では0.65xから1.06xまで振れます（サンプルの範囲も重なります）。上表のうち再現性が高いのは走査そのものを測る`forEach`側です。一致が無い条件（ascii-no-match、late-match）と`indexOf`経路の条件（small-dictionary、small-dense）は平坦化の対象外で、差は測定誤差の範囲です。構築時間は同等でした。比較用の実装は[baseline.ts](../../benchmark/baseline.ts)に固定してあります。

`pnpm benchmark`で再測定できます。CPUの負荷やGCにより結果は変動します。構築・存在判定・count・遷移表サイズと各サンプルの範囲は[results.json](../../benchmark/results.json)に記録しています。

比較対象の一次資料: [ahocorasick](https://github.com/BrunoRB/ahocorasick)、[@monyone/aho-corasick](https://github.com/monyone/aho-corasick)、[modern-ahocorasick](https://www.npmjs.com/package/modern-ahocorasick)、[@stll/aho-corasick](https://www.npmjs.com/package/@stll/aho-corasick)。
