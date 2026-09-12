# aho-corasick-ts

Fast, dependency-free Aho–Corasick matching for TypeScript. Register any number of keywords once, then find every occurrence of all of them in a single pass over the text. Adding keywords barely changes the cost of a scan.

日本語のドキュメントは [docs/README.ja.md](docs/README.ja.md) にあります。

## Install

```sh
pnpm add aho-corasick-ts
# npm install aho-corasick-ts
# yarn add aho-corasick-ts
```

Node.js 22.12 or newer. Ships ESM with type declarations, and loads from `require(ESM)` on 22.12 and up; there is no CJS build for older Node. It has no runtime dependencies and uses no Node-specific API, so it also works as ESM in the browser — though browser performance has not been measured.

## Quick start

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

`patternIndex` indexes the array you passed to the constructor. `start` and `end` are UTF-16 code unit offsets, exactly like `String.prototype.slice`, with `end` exclusive. Overlaps are never dropped: above, `she`, `he` and `hers` overlap at the same place and all three come back.

**Construction is the expensive part, so reuse the instance** — build it once at module level when the dictionary is fixed.

## Picking the right call

Taking only the information you need avoids work and allocation.

| What you want | API |
| --- | --- |
| Whether the text contains anything | `test` — stops at the first match |
| How many matches | `count` — builds no result objects at all |
| To handle each match in order | `forEach` — reports through a callback, no result array |
| An array of matches | `findAll` — convenient, but allocates one object per match |
| The text with matches replaced | `replace` — replaces the non-overlapping matches |

```ts
const ng = new AhoCorasick(['fraud', 'winner', 'free']);

ng.test('free gift, and you are a winner');   // true
ng.count('free free');                        // 2
ng.replace('free gift, beware of fraud', '***');
// *** gift, beware of ***
```

## Beyond the defaults

Four options cover the cases the defaults do not. Each is off unless you ask for it, and leaving it off costs the scan nothing.

| Option | What it does |
| --- | --- |
| `matchKind` | Report non-overlapping matches instead of every overlap — `leftmost-first` or `leftmost-longest` |
| `caseInsensitive` | Fold case before matching, with offsets still relative to the original text |
| `wholeWords` | Drop matches whose neighbouring characters are word characters |
| `maxDenseBytes` | Cap the transition table; larger dictionaries fall back to a sparse representation |

```ts
const kw = new AhoCorasick(['New', 'New York', 'York'], { matchKind: 'leftmost-longest' });
kw.findAll('New York and New and York');
// New York@0, New@13, York@21 — no overlaps
```

[docs/usage.md](docs/usage.md) walks through all of them.

## Documentation

| | |
| --- | --- |
| [docs/usage.md](docs/usage.md) | The complete guide, option by option |
| [docs/api.md](docs/api.md) | Every member, the ordering guarantees, offsets, complexity and errors |
| [docs/internals.md](docs/internals.md) | How the automaton is built, what it costs, and how the benchmarks are run |
| [docs/development.md](docs/development.md) | Working on this package |
| [docs/README.ja.md](docs/README.ja.md) | All of the above, in Japanese |
| [benchmark/RESULTS.md](benchmark/RESULTS.md) | Measured figures against four other implementations |

## What this is not for

Patterns that change on every call, flexible matching that needs a regular expression, dictionaries that change after construction, or searching across stream chunks. See the end of [docs/usage.md](docs/usage.md).

MIT License.
