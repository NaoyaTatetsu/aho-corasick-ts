# Development

Japanese readers can find all of this in [../ja/development.md](../ja/development.md).

Node.js 22.12 or newer. The pnpm, TypeScript and Biome versions are pinned in `package.json`, so they are whatever Renovate last landed rather than numbers repeated here.

```sh
pnpm install --frozen-lockfile
pnpm lint        # biome check . — lint plus format check
pnpm lint:fix    # biome check --write .
pnpm typecheck
pnpm test
pnpm coverage    # the same tests, with Node's built-in coverage report
pnpm benchmark
pnpm pack
```

CI runs `lint` → `typecheck` → `test` → `pack` on Node 22, 24 and 26 (22 and 24 are LTS; 26 is current). On a pull request it also measures coverage once, on Node 24, and posts the report as a comment, editing the previous one rather than stacking a new one per push. [.github/scripts/coverage-comment.mjs](../../.github/scripts/coverage-comment.mjs) turns the test runner's fixed-width table into that comment's markdown; run it over a saved report to see what it produces.

Coverage is reported against `dist/index.js`, since that is what the tests import, so its line numbers are the compiled file's. `--experimental-test-coverage` needs no extra dependency; thresholds exist too (`--test-coverage-lines` and friends) but take whole numbers only, and are not wired in.

## Biome configuration

The configuration is [../../biome.jsonc](../../biome.jsonc). Three things deviate from the recommended preset, each with its reason in a comment beside it:

- `style/noNonNullAssertion` is off. `noUncheckedIndexedAccess` makes every TypedArray read `T | undefined`, so assertions are unavoidable, and the rule's own fix is `?.`, which would put a runtime check in the per-character loops.
- `suspicious/noConfusingVoidType` is off. Narrowing `MatchCallback`'s `void | boolean` to `undefined | boolean` rejects any handler declared with an explicit `void` return type, which would break the public API.
- `benchmark/baseline.ts` and `benchmark/baseline.mjs` are excluded. They are a frozen snapshot of an older `src/index.ts`, kept so `pnpm benchmark --compare` measures the same code it always did.

## Things that are easy to break

- **README examples.** They document exact outputs and offsets, so a behaviour change silently falsifies them. Run them against the build.
- **Benchmark figures.** `pnpm benchmark` rewrites `benchmark/results.json`, which then disagrees with the numbers `docs/*/benchmark.md` publish. Update both, or restore the file.
- **`benchmark/baseline.*`.** Editing the implementation there invalidates every `--compare` measurement.
- **Fresh dependencies.** pnpm refuses to install anything published in the last 24 hours, so `pnpm install --frozen-lockfile` fails in CI before a single test runs. Renovate holds updates for three days to stay clear of this.

## Publishing

`pnpm pack` produces the npm tarball without sending anything anywhere. `prepack` builds, and
`prepublishOnly` runs lint, typecheck and tests, so a broken tree cannot reach the registry.

Releases go out from [.github/workflows/release.yml](../../.github/workflows/release.yml), which
reacts to a published GitHub Release. It authenticates through npm's trusted publishing: the job
asks GitHub for an OIDC token and npm exchanges it for a short-lived credential, so no long-lived
npm token is stored in this repository. Provenance is attached automatically. The job refuses to
publish when the release tag disagrees with the version in `package.json`.

To cut a release: set the version in `package.json`, move the `Unreleased` heading in
[CHANGELOG.md](../../CHANGELOG.md) down to it with the date, then publish a GitHub Release tagged
`v<version>`. Pushing the tag on its own publishes nothing — the workflow reacts to the release,
not to the tag. A release marked as a pre-release publishes under the `next` dist-tag, so a beta
never becomes what `npm install` hands out.

**The first publish cannot use this workflow.** npm's trusted publishing is configured on a
package's settings page, and npm has no equivalent of PyPI's pending publisher, so the package has
to exist before trust can be attached to it. Version 0.1.0 therefore goes out with a local
`npm publish`; after that, add this repository and `release.yml` as a trusted publisher on
npmjs.com, and every later release runs from CI.
