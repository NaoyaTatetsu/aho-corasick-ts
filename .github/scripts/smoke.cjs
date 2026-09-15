#!/usr/bin/env node
// The CommonJS half of the smoke test. The suite runs as ESM against dist/, so without this
// the require path would ship unexercised.
const assert = require('node:assert/strict');
const { AhoCorasick, foldCase } = require('../../dist/cjs/index.js');

const matcher = new AhoCorasick(['he', 'she', 'hers']);
assert.deepEqual(matcher.findAll('ushers'), [
  { patternIndex: 1, start: 1, end: 4 },
  { patternIndex: 0, start: 2, end: 4 },
  { patternIndex: 2, start: 2, end: 6 },
]);
assert.equal(matcher.count('ushers'), 3);
assert.equal(matcher.test('nothing at all'), false);
assert.equal(new AhoCorasick(['ab', 'abc'], { matchKind: 'leftmost-longest' }).replace('abcab', '*'), '**');
assert.equal(new AhoCorasick(['cat'], { wholeWords: true }).test('cats'), false);

const kana = code => (code >= 0x30a1 && code <= 0x30f6 ? code - 0x60 : code);
assert.equal(new AhoCorasick(['あほ'], { fold: code => kana(foldCase(code)) }).test('このアホが'), true);
assert.throws(() => new AhoCorasick(['a'], { wordBoundary: 'ascii' }), RangeError);

console.log(`commonjs smoke passed on ${process.version}`);
