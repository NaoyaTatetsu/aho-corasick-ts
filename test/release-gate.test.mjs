import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, compare, bumpKind, changelogSection } from '../.github/scripts/check-release.mjs';

const p = v => {
  const r = parse(v);
  assert.ok(r, `parse failed for ${v}`);
  return r;
};

test('rejects things that are not versions', () => {
  for (const bad of ['', '1', '1.2', 'v1.2.3', '1.2.3.4', 'latest', '1.2.x']) assert.equal(parse(bad), undefined, bad);
  for (const good of ['0.1.0', '1.0.0', '0.1.1-beta.0', '10.20.30']) assert.ok(parse(good), good);
});

test('orders versions, with a prerelease below its release', () => {
  assert.ok(compare(p('0.1.1'), p('0.1.0')) > 0);
  assert.ok(compare(p('0.2.0'), p('0.1.9')) > 0);
  assert.ok(compare(p('1.0.0'), p('0.99.99')) > 0);
  assert.ok(compare(p('0.1.1-beta.0'), p('0.1.1')) < 0, 'a prerelease precedes its release');
  assert.ok(compare(p('0.1.1-beta.1'), p('0.1.1-beta.0')) > 0);
  assert.equal(compare(p('0.1.0'), p('0.1.0')), 0);
});

test('accepts exactly one step, and names it', () => {
  const cases = [
    ['0.1.0', '0.1.1', 'patch'],
    ['0.1.0', '0.2.0', 'minor'],
    ['0.1.0', '1.0.0', 'major'],
    ['0.1.0', '0.1.1-beta.0', 'prepatch'],
    ['0.1.0', '0.2.0-rc.0', 'preminor'],
    ['0.1.0', '1.0.0-rc.0', 'premajor'],
    ['0.1.1-beta.0', '0.1.1-beta.1', 'prerelease'],
    ['0.1.1-beta.0', '0.1.1', 'release'],
  ];
  for (const [from, to, kind] of cases) assert.equal(bumpKind(p(from), p(to)), kind, `${from} -> ${to}`);
});

test('refuses the ways a bump goes wrong', () => {
  const bad = [
    ['0.1.0', '0.1.0'], // unchanged
    ['0.1.0', '0.0.9'], // backwards
    ['0.1.0', '0.11.0'], // typo for 0.1.1
    ['0.1.0', '0.3.0'], // skips 0.2.0
    ['0.1.0', '2.0.0'], // skips 1.0.0
    ['0.1.0', '1.1.0'], // major and minor at once
    ['0.1.0', '0.2.1'], // minor without resetting patch
  ];
  for (const [from, to] of bad) assert.equal(bumpKind(p(from), p(to)), undefined, `${from} -> ${to} should be refused`);
});

test('finds the changelog section, and only the right one', () => {
  const log = '# Changelog\n\n## Unreleased\n\n## 0.2.0 — 2026-10-01\n\nSecond.\n\n### Added\n\n- thing\n\n## 0.1.0 — 2026-09-13\n\nFirst release.\n';
  assert.equal(changelogSection(log, '0.2.0'), 'Second.\n\n### Added\n\n- thing');
  assert.equal(changelogSection(log, '0.1.0'), 'First release.');
  assert.equal(changelogSection(log, '0.3.0'), undefined);
  // A heading for 0.1 must not be mistaken for 0.1.0.
  assert.equal(changelogSection('## 0.1\n\nx\n', '0.1.0'), undefined);
  assert.equal(changelogSection('## [0.1.0] - 2026-09-13\n\nbracketed\n', '0.1.0'), 'bracketed');
});
