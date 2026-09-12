# Implementation and memory

How the matcher is built and what it costs. For the measurements themselves, see [benchmark.md](benchmark.md). 日本語: [../ja/internals.md](../ja/internals.md).

## The automaton

Characters are compressed into a dense alphabet, and transitions live in a full TypedArray DFA: `Uint16Array` at up to 65,536 states, `Uint32Array` beyond that. A transition is one array read, with no failure link to follow during the search.

Edges are keyed by alphabet column rather than by code unit, which makes the code-unit-to-column table the single place where a character becomes a symbol. Case folding is absorbed there, so `caseInsensitive` runs the same loops as a case-sensitive scan.

## The transition table budget

`maxDenseBytes` is the budget for the dense table, 64 MiB by default. A dictionary that would exceed it falls back to a sparse representation built from `Map`s and failure links; `0` forces that fallback.

```ts
const matcher = new AhoCorasick(['ab', 'bc'], {
  maxDenseBytes: 8 * 1024 * 1024,
});
console.log(matcher.stats);
```

The budget is not a total memory limit. The trie built during construction, the output ids, the failure links, the per-state depth used to cut short the non-overlapping lookahead, and a 256 KiB character map all sit outside it. `caseInsensitive` adds a 128 KiB folding table shared across the process. `transitionBytes` counts the DFA table alone and reads 0 for the sparse backend.

## The output index

The pattern ids a matching state reports are read from an index flattened into one contiguous run per state (CSR form), rather than by walking suffix links. The scan does one ranged read per state, with no per-state output array to dereference and no link chain to re-follow.

Inherited outputs are copied, so the index is bounded first: a dictionary whose per-state totals exceed 4Mi entries (16 MiB) skips it and falls back to the suffix-link walk. `outputBytes` reports the index's real size, or 0 when the cap was exceeded. Dictionaries with long suffix chains hit this — 3,000 patterns that are all suffixes of one string, for instance.

## Complexity

A full search is O(n + z) for a text of length n with z matches. `count` is O(n) from per-state totals computed at build time. Building the DFA costs time and memory proportional to states × alphabet size; the sparse backend's failure-link search adds passes during construction. See [api.md](api.md) for how the non-overlapping modes change this.

The measured effect of these choices, and how the figures are produced, is in [benchmark.md](benchmark.md).
