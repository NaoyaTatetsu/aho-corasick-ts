## What this changes

<!--
What changed, and why it is worth making.

If it changes what the library does rather than how it is built, say so plainly.
The README documents exact offsets, ordering guarantees and error types, so a
behaviour change is a documentation change too.
-->

## Verification

<!--
CI runs lint, typecheck, tests and pack on Node 22, 24 and 26 — no need to
repeat that here. Write down what CI cannot tell you: what you ran by hand,
and what it showed.
-->

## Checklist

<!-- Delete the lines that do not apply. -->

- [ ] `README.md` matches the new behaviour, and its examples still produce the outputs they document
- [ ] `pnpm benchmark` was re-run, and `benchmark/RESULTS.md` agrees with `benchmark/results.json`
- [ ] `benchmark/baseline.ts` and `benchmark/baseline.mjs` are untouched — they are the frozen snapshot `pnpm benchmark --compare` measures against
- [ ] New dependencies are older than 24 hours, so `pnpm install --frozen-lockfile` does not trip pnpm's minimum release age
