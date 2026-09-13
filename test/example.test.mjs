import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../example/', import.meta.url));
const examples = readdirSync(directory)
  .filter(name => name.endsWith('.ts'))
  .sort();

/** Lines each example claims to print. An API change that breaks one shows up here. */
const expected = {
  'basic.ts': ['she at 1..4 -> "she"', 'count : 3', "forEach, stopped early: [ 'she', 'he' ]"],
  'highlight.ts': ['all matches      : 5', '<mark>東京大学</mark>と<mark>東京</mark>の<mark>大学</mark>', 'a <mark>cat</mark> and cats'],
  'ng-words.ts': ["detected: [ '無料ギフト', '詐欺' ]", '＊＊＊＊＊の案内です。', '"応募者の一覧" -> 0 violation(s)'],
  'spelling-variants.ts': ['kana fold   : true', 'fullwidth   : true', 'is not a UTF-16 code unit'],
  'streaming.ts': ['pieces scanned alone: 0 matches', 'whole text          : 2 matches', 'matches whole-text scan: true'],
};

test('every example is covered by an expectation', () => {
  assert.deepEqual(examples, Object.keys(expected).sort());
});

for (const name of examples) {
  test(`example/${name} runs and prints what it claims`, () => {
    const output = execFileSync(process.execPath, ['--experimental-strip-types', directory + name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of expected[name]) assert.ok(output.includes(line), `${name} did not print ${JSON.stringify(line)}\n${output}`);
  });
}
