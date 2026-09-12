# API and matching semantics

The contract. For worked examples see [usage.md](usage.md); for how it is built, [internals.md](internals.md). Japanese readers can find all of this in [../ja/api.md](../ja/api.md).

## Members

| Member | Behaviour |
| --- | --- |
| `new AhoCorasick(patterns, options?)` | Builds the dictionary from an `Iterable<string>` |
| `findAll(text): Match[]` | Id, start and end of every reported match |
| `forEach(text, callback): void` | Reports every match without building a result array |
| `count(text): number` | How many matches are reported |
| `test(text): boolean` | Whether any match exists |
| `replace(text, replacement): string` | The text with its non-overlapping matches replaced |
| `patterns` | A frozen copy of the dictionary as passed in |
| `stats` | States, alphabet size, backend, transition bytes, output index bytes |

## Options

| Option | Default | Behaviour |
| --- | --- | --- |
| `maxDenseBytes` | `67108864` | Byte budget for the dense transition table. `0` forces the sparse representation |
| `matchKind` | `'all'` | `'all'` reports overlaps; `'leftmost-first'` and `'leftmost-longest'` report non-overlapping matches |
| `caseInsensitive` | `false` | Folds each code unit to lower case before matching |
| `wholeWords` | `false` | Discards matches whose neighbours are word characters |
| `wordBoundary` | `'unicode'` | What `wholeWords` treats as a word character: `'unicode'` or `'ascii'` |

Any value outside those listed throws `RangeError`. Left at their defaults, `matchKind`, `caseInsensitive` and `wholeWords` add nothing to the cost of a scan.

## Offsets and text handling

Offsets are UTF-16 code units, exactly as in `String.prototype.slice`, and `end` is exclusive. Japanese text, emoji, lone surrogates and NUL all work.

Matching is case-sensitive unless `caseInsensitive` says otherwise, and no Unicode normalization is performed. A decomposed `é` and a precomposed `é` are different strings here, as they are to `===`.

## Ordering

With `matchKind: 'all'`, matches arrive in end-position order; within one end position the longer pattern comes first, and duplicates of the same pattern come in dictionary order.

With a non-overlapping `matchKind`, matches arrive in start-position order. Which pattern wins at a given start is what `matchKind` selects, and duplicates of the same pattern report the lowest id.

## Complexity

For a text of length n with z reported matches, a full search is O(n + z). `count` is O(n), because it sums per-state totals computed at build time — unless `matchKind` selects non-overlapping matches or `wholeWords` is on, in which case it has to select matches one at a time.

Non-overlapping selection restarts the scan at each selected match's end, so its worst case is O(n × longest pattern). The scan bounds where the matches still to come can begin, using the depth of the current automaton state, and stops reading ahead as soon as nothing can outrank the candidate. In practice that keeps it close to linear in the text length.

`findAll` needs O(z) result memory. For match-dense text, prefer `count` or `forEach`.

## Errors

| Condition | Thrown |
| --- | --- |
| A pattern is the empty string | `RangeError` |
| A pattern is not a string | `TypeError` |
| `maxDenseBytes` is not a non-negative safe integer | `RangeError` |
| `matchKind` or `wordBoundary` is not one of the listed values | `RangeError` |
| A `replace` array's length differs from the dictionary's | `RangeError` |
| A `replace` argument is not a string, array or function | `TypeError` |

An empty dictionary is allowed and matches nothing.

## Callbacks

`forEach` ends the scan when the callback returns exactly `false`; any other return value, `undefined` included, continues. An exception from the callback propagates to the caller.

Scan state lives inside a single call, so a callback may search the same instance recursively without disturbing the scan that invoked it.

## Replacement

`replace` needs non-overlapping matches, so an instance with `matchKind: 'all'` selects leftmost-longest for that method alone. With a non-overlapping `matchKind`, `replace` follows the configured rule.

## Not provided

State is not carried between calls, so there is no streaming search across chunks. Instances are immutable, so there is no dynamic dictionary update. Both are deliberate: see the last section of [usage.md](usage.md).
