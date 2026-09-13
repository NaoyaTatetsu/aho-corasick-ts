# Usage

The complete guide. [README.md](../../README.md) covers installation and the first few minutes; everything else is here. For the exact contract — ordering, offsets, errors — see [api.md](api.md). Japanese readers can find all of this in [../ja/usage.md](../ja/usage.md).

## Building a dictionary

Build once, apply to as many texts as you like. **Construction is the expensive part, so reuse the instance.** When the dictionary is fixed, build it at module level.

```ts
// ng-words.ts
import { AhoCorasick } from '@naoya_tatetsu/aho-corasick-ts';

export const ngWords = new AhoCorasick(['fraud', 'winner', 'free']);
```

The constructor takes any `Iterable<string>`, so a `Set` works directly:

```ts
new AhoCorasick(new Set(['ab', 'bc'])).count('abc'); // 2
```

An empty dictionary is allowed. An empty pattern throws `RangeError`, and a non-string pattern throws `TypeError`.

## Choosing an API

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
ng.test('an ordinary notice');                // false
ng.count('free free');                        // 2
```

On match-dense text, `findAll`'s allocation dominates. If you only need to handle each match once, `forEach` is faster and uses no result memory.

## Reading a match

`patternIndex` indexes the array you passed to the constructor, and `start`/`end` are UTF-16 code unit offsets, exactly like `String.prototype.slice`, with `end` exclusive.

```ts
const text = 'free gift, and you are a winner';

for (const { patternIndex, start, end } of ng.findAll(text)) {
  console.log(ng.patterns[patternIndex], text.slice(start, end), start, end);
}
// free free 0 4
// winner winner 25 31
```

`patterns` is a frozen copy of what you passed in, so mutating the original array afterwards changes nothing.

## Non-overlapping matches

By default (`matchKind: 'all'`) every match is reported, overlaps included. For highlighting or replacement, where the spans must not overlap, pick a selection rule:

- `leftmost-longest` — the earliest start wins; ties go to the longest pattern
- `leftmost-first` — the earliest start wins; ties go to whichever pattern comes first in the dictionary

Once a match is selected, the scan resumes at its end.

```ts
const kw = ['New', 'New York', 'York'];
const src = 'New York and New and York';

new AhoCorasick(kw).findAll(src).length;   // 5, overlaps included

new AhoCorasick(kw, { matchKind: 'leftmost-longest' }).findAll(src);
// New York@0, New@13, York@21

new AhoCorasick(kw, { matchKind: 'leftmost-first' }).findAll(src);
// New@0, York@4, New@13, York@21   <- at the same start, 'New' wins by being listed first
```

`findAll`, `forEach` and `count` all follow the rule. `test` only reports whether a match exists, so its answer is the same under every `matchKind`. Results come back in start order, which for non-overlapping matches is also end order.

## Replacing

`replace` rewrites the non-overlapping matches. The replacement takes three forms.

```ts
const ng = new AhoCorasick(['fraud', 'free', 'free gift']);

// One string for every match
ng.replace('free gift inside, beware of fraud', '***');
// *** inside, beware of ***

// One string per pattern id; a different length throws RangeError
ng.replace('free gift inside', ['[fraud]', '[free]', '[free gift]']);
// [free gift] inside

// Built per match
ng.replace('free gift inside', (patternIndex, start, end) => '*'.repeat(end - start));
// ********* inside
```

An instance with `matchKind: 'all'` has no non-overlapping reading of its results, so `replace` selects leftmost-longest there. With a non-overlapping `matchKind`, it follows that rule instead.

```ts
new AhoCorasick(['ab', 'abc']).replace('abcab', '*');                                    // '**'
new AhoCorasick(['ab', 'abc'], { matchKind: 'leftmost-first' }).replace('abcab', '*');   // '*c*'
```

## Counting per pattern

`forEach` tallies without building a result array.

```ts
const tally = new Array(ng.patterns.length).fill(0);
ng.forEach('free free and fraud', patternIndex => { tally[patternIndex]++; });
```

## Stopping early

A callback that returns exactly `false` ends the scan there, so taking the first few matches does not cost a full pass.

```ts
import type { Match } from '@naoya_tatetsu/aho-corasick-ts';

const found: Match[] = [];
ng.forEach('free, winner, fraud', (patternIndex, start, end) => {
  found.push({ patternIndex, start, end });
  if (found.length === 2) return false;   // stop here
});
```

An exception thrown by the callback propagates to the caller. The scan keeps its state on the stack, so a callback may search the same instance recursively.

## Case-insensitive matching

`caseInsensitive` folds the dictionary and the text the same way before matching. **Offsets stay relative to the original text**, and `patterns` keeps the strings you passed in.

```ts
const ci = new AhoCorasick(['ERROR', 'Warning'], { caseInsensitive: true });

ci.findAll('Fatal error and WARNING');
// [{ patternIndex: 0, start: 6, end: 11 }, { patternIndex: 1, start: 16, end: 23 }]
ci.patterns;   // ['ERROR', 'Warning'], not the folded strings
```

Folding applies `toLowerCase()` to each UTF-16 code unit and keeps the result **only when it is a single code unit**. That covers ASCII, accented Latin, Greek, Cyrillic and fullwidth letters. Length-changing conversions (`'İ'.toLowerCase()` is two code units; `'ß'.toUpperCase()` is `'SS'`) would break the offset arithmetic, so they are left alone. As a result, these do not match:

```ts
new AhoCorasick(['ss'], { caseInsensitive: true }).test('ß');   // false
new AhoCorasick(['İ'], { caseInsensitive: true }).test('i');    // false
new AhoCorasick(['Σ'], { caseInsensitive: true }).test('ς');    // false, final sigma has no single-unit lowercase of its own
new AhoCorasick(['Σ'], { caseInsensitive: true }).test('σ');    // true
```

Folding is absorbed into the code-unit-to-column table, so the scan runs exactly the same loops as a case-sensitive one and costs nothing extra per character. The table is built once per process (about 4 ms, 128 KiB).

## Matching text spelled another way

`caseInsensitive` folds one specific thing: letter case. `fold` generalises it — you supply the
mapping, and it is applied to both the dictionary and the text.

```ts
import { AhoCorasick } from '@naoya_tatetsu/aho-corasick-ts';

// Katakana and hiragana occupy parallel blocks, so one subtraction maps between them.
const kana = (code: number) => (code >= 0x30a1 && code <= 0x30f6 ? code - 0x60 : code);

const ng = new AhoCorasick(['あほ'], { fold: kana });
ng.test('このアホが');              // true
ng.findAll('このアホが');           // [{ patternIndex: 0, start: 2, end: 4 }]
ng.patterns;                        // ['あほ'] — as passed in, not folded
```

**Offsets stay relative to the original text**, which is why the mapping is per code unit: a
mapping that changed a string's length would move every offset after it. Returning anything that
is not a UTF-16 code unit throws `RangeError`.

To fold case as well, compose `foldCase` — the same mapping `caseInsensitive` uses. Setting both
`caseInsensitive` and `fold` is a `RangeError`, since the two would disagree about which mapping
wins.

```ts
import { AhoCorasick, foldCase } from '@naoya_tatetsu/aho-corasick-ts';

const ac = new AhoCorasick(['アホ'], { fold: code => kana(foldCase(code)) });
ac.test('あほ');   // true
```

The mapping applies **once to each side**. A dictionary entry and a piece of text match when their
single application lands on the same code unit, which is worth keeping in mind for a mapping that
is not idempotent.

`fold` is absorbed into the code-unit-to-column table, so the scan runs the same loops as an
unfolded one — measurably so: on a 1,200-word dictionary over 12,000 words, a folded scan and an
unfolded one produce an automaton with the same backend, alphabet size and transition table size,
and time the same to within noise. The cost is paid once, at construction, calling the mapping for
each of the 65,536 code units.

## Whole-word matching

`wholeWords` discards matches whose neighbouring characters are word characters.

```ts
const w = new AhoCorasick(['cat'], { wholeWords: true });

w.findAll('cat cats _cat (cat)').map(m => m.start);   // [0, 15]
```

`wordBoundary` picks what counts as a word character. It only means something alongside `wholeWords`, so setting it on its own is a `RangeError` rather than a setting that quietly does nothing.

| Value | Word characters |
| --- | --- |
| `unicode` (default) | `\p{L}`, `\p{N}`, `\p{M}`, `_` |
| `ascii` | `[A-Za-z0-9_]` |

`unicode` treats Japanese and combining marks as word characters. `ascii` treats everything outside ASCII as a separator, which is what finds an English word embedded in Japanese text.

```ts
new AhoCorasick(['cat'], { wholeWords: true }).test('猫cat猫');                         // false
new AhoCorasick(['cat'], { wholeWords: true, wordBoundary: 'ascii' }).test('猫cat猫');   // true

// A match that would cut a combining mark in half is rejected too
new AhoCorasick(['e'], { wholeWords: true }).test('é');   // false, decomposed é
```

Neighbours are tested per code point rather than per code unit, so half of a surrogate pair is never judged on its own.

## Limiting transition table memory

By default the transition table may take up to 64 MiB. `maxDenseBytes` lowers that; dictionaries that exceed it fall back to a sparse representation automatically. See [internals.md](internals.md) for what the budget does and does not cover.

```ts
const tuned = new AhoCorasick(['ab', 'bc'], { maxDenseBytes: 8 * 1024 * 1024 });
tuned.stats;
// { states: 5, alphabetSize: 3, backend: 'dense', transitionBytes: 40, outputBytes: 28 }
```

## TypeScript types

`Match`, `MatchCallback`, `Options`, `MatchKind`, `WordBoundary` and `Replacement` are all exported, as is the `foldCase` function.

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
  if (start > 100) return false;   // stop
};
matcher.forEach('ushers', onMatch);
```

## What this is not for

- Patterns that change on every call. There is no build cost to amortise.
- Flexible matching — character classes, repetition, backreferences. Use a regular expression. Word boundaries are covered by `wholeWords`.
- Adding to or removing from the dictionary after construction. Instances are immutable; build a new one.
- Searching across stream chunks. Scan state lives inside a single call.
