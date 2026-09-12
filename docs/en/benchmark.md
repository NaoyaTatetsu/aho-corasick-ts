# Benchmarks

How the measurements are taken, and what they show. For how the matcher is built, see [internals.md](internals.md). 日本語: [../ja/benchmark.md](../ja/benchmark.md).

## Method

`pnpm benchmark` runs six synthetic inputs from a fixed seed, timing construction, full search and existence separately, with the count-only API in its own column. It compares against `ahocorasick`, `modern-ahocorasick`, `@monyone/aho-corasick` (both the standard and fast builds) and the Rust binding `@stll/aho-corasick`.

Every combination runs in its own process, and every result is checked against an independent `String.indexOf` oracle for ids and positions. Each measurement warms up for at least 60 ms, then records the median, minimum and maximum of seven samples of at least 35 ms. Normalization is outside the timing, but each API's own result construction is inside it — `ahocorasick` in particular groups results by end position, so it allocates differently from an API that materialises every match.

A comparison library that crashes, disagrees or times out is recorded under `skipped`. Child processes get a 512 MiB JS heap cap and 30 seconds; native memory is outside that cap. A failure in this library fails the whole benchmark.

Results, environment and dependency versions are saved to [benchmark/results.json](../../benchmark/results.json). Compare construction time as well as search speed. These are synthetic inputs on one machine, not a claim to be the fastest on npm — real data, CPU, runtime, pattern count and match density all move the ranking.

## Results

Measured: 2026-09-10T16:23:57.965Z
Node v22.12.0; darwin arm64; Apple M2 Max

Median of the full search, in ms per call. Result shapes and allocation differ between APIs. Synthetic inputs only.

| Scenario | Local `findAll` | Local `forEach` | Best other JS/TS | Rust binding |
| --- | ---: | ---: | ---: | ---: |
| ascii-many | 0.432 | 0.416 | 2.362 (@monyone/aho-corasick/fast) | 0.467 |
| ascii-no-match | 0.043 | 0.044 | 1.211 (@monyone/aho-corasick/fast) | 0.180 |
| small-dictionary | 0.317 | 0.282 | 1.064 (@monyone/aho-corasick/fast) | 0.220 |
| suffix-heavy | 2.498 | 0.591 | 0.040 (ahocorasick) | 5.857 |
| unicode | 0.709 | 0.397 | 2.370 (@monyone/aho-corasick/fast) | 2.592 |
| large-alphabet | 0.226 | 0.187 | 0.662 (@monyone/aho-corasick/fast) | 0.673 |

This implementation wins every scenario against the JS/TS implementations, but it is not the fastest everywhere.

- On `suffix-heavy`, `ahocorasick` looks an order of magnitude faster because it returns the matches sharing an end position as one row. That input matches 95,724 times across 4,000 characters, and this implementation builds one object per match. `forEach`, which builds no result objects, takes 0.591 ms. On match-dense input, use `forEach` or `count`.
- On `small-dictionary`, the Rust binding `@stll/aho-corasick` is faster — 0.220 ms against 0.317 ms. This implementation is ahead on the other five.
- The count-only API produces no full results, so it is not in this table.

`modern-ahocorasick` aborted on the unicode and large-alphabet cases after hitting the 512 MiB heap cap imposed on child processes. That cap is this benchmark's own, so the failure is not treated as a performance win. It is recorded under `skipped` in [results.json](../../benchmark/results.json).

## What flattening the output links bought

The effect of flattening the suffix-link output walk into one contiguous run per state (CSR form). These are the ratios between two runs measured with `pnpm benchmark --compare`.

| Scenario | `findAll` | `forEach` |
| --- | ---: | ---: |
| ascii-many | 1.08x / 1.10x | 1.06x / 1.06x |
| unicode | 1.16x / 1.11x | 1.10x / 1.09x |
| large-alphabet | 1.12x / 1.16x | 1.10x / 1.07x |
| sparse-many | 1.08x / 1.09x | 1.06x / 1.10x |
| suffix-heavy | 0.65x / 1.06x | 1.31x / 1.34x |

On match-heavy input, `findAll` is dominated by result allocation and GC, so it varies a lot between runs — `suffix-heavy` swings from 0.65x to 1.06x, with overlapping sample ranges. The reproducible half of this table is `forEach`, which measures the walk itself. Inputs with no matches (ascii-no-match, late-match) and inputs on the `indexOf` path (small-dictionary, small-dense) are not affected by the flattening, and their differences are measurement noise. Construction time was unchanged. The implementation being compared against is frozen in [baseline.ts](../../benchmark/baseline.ts).

`pnpm benchmark` re-measures. Results move with CPU load and GC. Construction, existence, count, transition table size and each sample's range are recorded in [results.json](../../benchmark/results.json).

Primary sources for the comparisons: [ahocorasick](https://github.com/BrunoRB/ahocorasick), [@monyone/aho-corasick](https://github.com/monyone/aho-corasick), [modern-ahocorasick](https://www.npmjs.com/package/modern-ahocorasick), [@stll/aho-corasick](https://www.npmjs.com/package/@stll/aho-corasick).
