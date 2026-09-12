# APIと一致の仕様

APIの仕様です。具体例は[usage.md](usage.md)、内部構造は[internals.md](internals.md)にあります。English: [../en/api.md](../en/api.md)。


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
