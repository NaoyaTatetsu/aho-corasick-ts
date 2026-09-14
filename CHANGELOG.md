# Changelog

Notable changes to this package. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed

- More keywords, chosen from what npm search actually returns rather than from guesswork.
  `ahocorasick` unhyphenated, because npm treats it as a separate term and the most downloaded
  package in this space carries it; `ngword` and `ng-word`, a niche with two results in total that
  `example/ng-words.ts` shows the package serving; and `trie`, `keyword`, `highlight`,
  `string-match` and `text-search`. Nothing describing a feature the package does not have —
  `profanity` was left out, since no word list ships with it.

## 1.0.0 — 2026-09-14

The public API is settled: from here, anything that breaks it needs a major version.

### Changed

- **Breaking.** `wordBoundary` without `wholeWords: true` is now a `RangeError`. On its own it
  decides nothing, and accepting it silently left no way to notice that the boundaries asked for
  were not being applied.

### Documentation

- `example/`, five runnable TypeScript programs covering the basics, filtering banned words,
  matching text spelled another way, highlighting, and scanning text that arrives in pieces.
  `pnpm example` runs them; `test/example.test.mjs` checks each one still prints what it claims.
- Coverage now reports on `dist/**` alone, the code that ships, rather than on everything the test
  run happens to touch.

### Added

- `fold`, which maps every UTF-16 code unit before matching so that text spelled another way still
  matches — katakana onto hiragana, fullwidth onto ASCII, and so on. `caseInsensitive` is the
  special case of it that folds letter case, and the mapping behind it is now exported as
  `foldCase` so a custom `fold` can compose it rather than reimplement it. Offsets stay relative to
  the original text, which is why the mapping is per code unit.

## 0.1.1 — 2026-09-13

### Documentation

- The README said the package loads from `require(ESM)` on Node 22.12 and up, which is true but
  incomplete: Node 22 prints an `ExperimentalWarning` when it does, and Node 24 and newer do not.
  Both READMEs now say so. Measured across Node 22, 24 and 26 against the published package.

## 0.1.0 — 2026-09-13

First release.

### Matching

- `findAll`, `forEach`, `count` and `test` over a dictionary built once from any `Iterable<string>`
- `replace`, rewriting the non-overlapping matches from a string, one string per pattern, or a function
- `matchKind` selects `leftmost-first` or `leftmost-longest` instead of reporting every overlap
- `caseInsensitive` folds each UTF-16 code unit before matching, leaving offsets relative to the
  original text; folds that would change a string's length are left alone
- `wholeWords`, with `wordBoundary` choosing between Unicode and ASCII word characters, tested per
  code point so a surrogate pair is never judged on one half
- Offsets are UTF-16 code units, as in `String.prototype.slice`, with `end` exclusive
- Ordering is defined and tested: end position for `matchKind: 'all'`, start position otherwise

### Implementation

- A TypedArray DFA with a compressed alphabet, `Uint16Array` up to 65,536 states and `Uint32Array`
  beyond, so a transition is one array read
- `maxDenseBytes` caps the transition table; dictionaries past the budget fall back to a sparse
  representation, and `stats` reports which one is in use
- Output ids are read from an index flattened into one contiguous run per state, falling back to the
  suffix-link walk for dictionaries whose totals exceed the cap
- No runtime dependencies, and no Node-specific API

### Package

- ESM with type declarations, loadable from `require(ESM)` on Node 22.12 and newer
- Source and source maps ship alongside the build, so stack traces resolve into `src/index.ts`
