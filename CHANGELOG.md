# Changelog

Notable changes to this package. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- A CommonJS build alongside the ESM one, with type declarations for each. `require` now works from
  Node 18, where `require(ESM)` does not exist, and a TypeScript project on `module: node16` — which
  used to fail with TS1479 — resolves the types. Loading both halves in one process yields two
  copies of the class, which matters only where instances are compared across them.

### Changed

- The supported Node floor drops from 22.12 to 18. The old floor was the version `require(ESM)`
  needs, which is a feature rather than a requirement — as ESM the package always ran on 18.
  Verified on 18.0.0 itself, and a smoke test now runs on 18 and 20 in CI so the claim stays
  checked. `require(ESM)` reaches it from Node 20 onwards.

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
