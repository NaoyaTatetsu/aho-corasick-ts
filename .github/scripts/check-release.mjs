#!/usr/bin/env node
// Decides whether a push to main should publish, and refuses the ways a version bump goes wrong.
// Usage: node .github/scripts/check-release.mjs [--registry <url>]
// Writes publish/version/tag/notes to GITHUB_OUTPUT when it is set.
import { appendFileSync, readFileSync } from 'node:fs';

const REGISTRY = process.argv.includes('--registry') ? process.argv[process.argv.indexOf('--registry') + 1] : 'https://registry.npmjs.org';

/** major.minor.patch with an optional prerelease, which is all this package uses. */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parse(version) {
  const m = SEMVER.exec(version);
  if (!m) return undefined;
  return { major: +m[1], minor: +m[2], patch: +m[3], prerelease: m[4] };
}

/** Negative, zero or positive, ordering a prerelease before the release it leads to. */
export function compare(a, b) {
  for (const part of ['major', 'minor', 'patch']) {
    if (a[part] !== b[part]) return a[part] - b[part];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === undefined) return 1;
  if (b.prerelease === undefined) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/**
 * Which single step leads from `from` to `to`, or undefined when no single step does.
 * Catching that is the point: 0.1.0 -> 0.11.0 is a typo for 0.1.1, not a release.
 */
export function bumpKind(from, to) {
  if (to.prerelease !== undefined) {
    // A prerelease either continues the current one, or opens the next release.
    if (from.prerelease !== undefined && from.major === to.major && from.minor === to.minor && from.patch === to.patch) return 'prerelease';
    const target = { ...to, prerelease: undefined };
    return bumpKind(from, target) ? `pre${bumpKind(from, target)}` : undefined;
  }
  // Releasing the version a prerelease was leading to is a release, not a bump.
  if (from.prerelease !== undefined && from.major === to.major && from.minor === to.minor && from.patch === to.patch) return 'release';
  if (to.major === from.major + 1 && to.minor === 0 && to.patch === 0) return 'major';
  if (to.major === from.major && to.minor === from.minor + 1 && to.patch === 0) return 'minor';
  if (to.major === from.major && to.minor === from.minor && to.patch === from.patch + 1) return 'patch';
  return undefined;
}

/** The section a release's notes come from, so a version cannot ship undocumented. */
export function changelogSection(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex(line => new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`).test(line));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => line.startsWith('## '));
  return rest
    .slice(0, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function output(values) {
  console.log(JSON.stringify(values, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    for (const [key, value] of Object.entries(values)) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}<<__EOF__\n${value}\n__EOF__\n`);
    }
  }
}

export async function main() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const version = pkg.version;
  const parsed = parse(version);
  if (!parsed) fail(`package.json version ${version} is not a version this project publishes (major.minor.patch[-prerelease]).`);

  const response = await fetch(`${REGISTRY}/${pkg.name}`, { headers: { accept: 'application/json' } });
  if (response.status === 404) {
    // Trusted publishing cannot create a package, so the first release is a manual step.
    console.log(`${pkg.name} is not on the registry yet. The first publish has to be run by hand; skipping.`);
    return output({ publish: 'false', version, tag: '', notes: '' });
  }
  if (!response.ok) fail(`The registry answered ${response.status} for ${pkg.name}.`);
  const published = Object.keys((await response.json()).versions ?? {});

  if (published.includes(version)) {
    console.log(`${pkg.name}@${version} is already published; nothing to do.`);
    return output({ publish: 'false', version, tag: '', notes: '' });
  }

  const latest = published.map(parse).filter(Boolean).sort(compare).at(-1);
  if (latest && compare(parsed, latest) <= 0) {
    fail(`package.json is at ${version}, which is not above the published ${latest.major}.${latest.minor}.${latest.patch}${latest.prerelease ? `-${latest.prerelease}` : ''}.`);
  }
  const kind = latest ? bumpKind(latest, parsed) : 'initial';
  if (!kind) {
    const from = `${latest.major}.${latest.minor}.${latest.patch}`;
    fail(
      `${version} is not one step from the published ${from}. Expected ${latest.major}.${latest.minor}.${latest.patch + 1}, ${latest.major}.${latest.minor + 1}.0 or ${latest.major + 1}.0.0, optionally as a prerelease.`,
    );
  }

  const notes = changelogSection(readFileSync('CHANGELOG.md', 'utf8'), version);
  if (!notes) fail(`CHANGELOG.md has no "## ${version}" section, so this release would ship without notes.`);

  console.log(`Publishing ${pkg.name}@${version} (${kind}).`);
  return output({ publish: 'true', version, tag: `v${version}`, notes, prerelease: String(parsed.prerelease !== undefined) });
}

if (import.meta.filename === process.argv[1]) await main();
