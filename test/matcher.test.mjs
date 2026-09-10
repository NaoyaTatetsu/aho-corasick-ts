import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { AhoCorasick } from '../dist/index.js';

function oracle(patterns, text) {
  const matches = [];
  for (let end = 1; end <= text.length; end++) {
    for (let id = 0; id < patterns.length; id++) {
      const start = end - patterns[id].length;
      if (start >= 0 && text.slice(start, end) === patterns[id]) matches.push({ patternIndex: id, start, end });
    }
  }
  return matches.sort((a, b) => a.end - b.end || a.start - b.start || a.patternIndex - b.patternIndex);
}
for (const maxDenseBytes of [0, 64 * 1024 * 1024]) {
  const backend = maxDenseBytes ? 'dense' : 'sparse';
  test(`${backend}: suffixes, overlaps, duplicates, Unicode and unknown characters`, () => {
    for (const [patterns, text] of [
      [['he', 'she', 'his', 'hers'], 'ushers his she'],
      [['a', 'aa', 'aaa', 'a'], 'aaaaa'],
      [['東京', '京都', '😀', '\ude00', '\0'], '東京京都😀\0😀'],
      [['__proto__', 'constructor', 'toString'], '__proto__constructor toString'],
      [[], 'abc'], [['abc'], ''], [['ab', 'bc'], 'a?bcab'],
    ]) {
      const ac = new AhoCorasick(patterns, { maxDenseBytes });
      const expected = oracle(patterns, text);
      assert.deepEqual(ac.findAll(text), expected);
      assert.equal(ac.count(text), expected.length);
      assert.equal(ac.test(text), expected.length > 0);
      assert.equal(ac.stats.backend, backend);
    }
  });
  test(`${backend}: seeded randomized differential tests`, () => {
    let seed = 42;
    const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    const chars = ['a', 'b', 'c', '日', '\ud83d', '\ude00', '\0'];
    const word = n => Array.from({ length: n }, () => chars[random(chars.length)]).join('');
    for (let trial = 0; trial < 1000; trial++) {
      const patterns = Array.from({ length: random(20) }, () => word(1 + random(8)));
      const text = word(random(100));
      const ac = new AhoCorasick(patterns, { maxDenseBytes });
      const expected = oracle(patterns, text);
      assert.deepEqual(ac.findAll(text), expected);
      assert.equal(ac.count(text), expected.length);
      assert.equal(ac.test(text), expected.length > 0);
    }
  });
}
test('validation, dictionary snapshot and callback cancellation', () => {
  assert.throws(() => new AhoCorasick(['']), RangeError);
  assert.throws(() => new AhoCorasick([42]), TypeError);
  for (const maxDenseBytes of [-1, NaN, Infinity, 1.5]) assert.throws(() => new AhoCorasick([], { maxDenseBytes }), RangeError);
  const patterns = ['a'];
  const ac = new AhoCorasick(patterns);
  patterns[0] = 'b';
  assert.equal(ac.count('aaa'), 3);
  assert.throws(() => ac.patterns.push('b'), TypeError);
  let calls = 0;
  ac.forEach('aaa', () => { calls++; return false; });
  assert.equal(calls, 1);
  assert.equal(ac.count('aaa'), 3);
  assert.throws(() => ac.forEach('a', () => { throw new Error('callback'); }), /callback/);
});
test('large alphabet forces sparse storage under memory budget', () => {
  const patterns = Array.from({ length: 2000 }, (_, i) => String.fromCharCode(1000 + i));
  const ac = new AhoCorasick(patterns, { maxDenseBytes: 1024 });
  assert.equal(ac.stats.backend, 'sparse');
  assert.equal(ac.count(patterns.join('')), 2000);
});
test('suffix-heavy dictionary does not copy inherited outputs', () => {
  const ac = new AhoCorasick(Array.from({ length: 500 }, (_, i) => 'a'.repeat(i + 1)));
  assert.equal(ac.count('a'.repeat(1000)), 375250);
});
test('Node CommonJS consumer can require the ESM entry', () => {
  const { AhoCorasick: Matcher } = createRequire(import.meta.url)('../dist/index.js');
  assert.equal(new Matcher(['a']).count('aaa'), 3);
});
test('16-bit and 32-bit state IDs and exact dense budgets', () => {
  for (const length of [65535, 65536]) {
    const pattern = 'a'.repeat(length);
    const ac = new AhoCorasick([pattern]);
    const bytes = (length + 1) * 2 * (length === 65535 ? 2 : 4);
    assert.equal(ac.stats.transitionBytes, bytes);
    assert.deepEqual(ac.findAll(pattern + 'a'), [
      {patternIndex: 0, start: 0, end: length},
      {patternIndex: 0, start: 1, end: length + 1},
    ]);
    assert.equal(ac.count(pattern + 'a'), 2);
    assert.equal(ac.test(pattern), true);
  }
  assert.equal(new AhoCorasick(['a'], {maxDenseBytes: 8}).stats.backend, 'dense');
  assert.equal(new AhoCorasick(['a'], {maxDenseBytes: 7}).stats.backend, 'sparse');
});
test('callbacks may search recursively and stop inside duplicate outputs', () => {
  for (const maxDenseBytes of [0, 1024]) {
    const ac = new AhoCorasick(['a', 'a', 'ba'], {maxDenseBytes});
    const seen = [];
    ac.forEach('ba', (id, start, end) => {
      assert.equal(ac.count('ba'), 3);
      assert.equal(ac.findAll('a').length, 2);
      seen.push([id, start, end]);
      return seen.length !== 2;
    });
    assert.deepEqual(seen, [[2, 0, 2], [0, 1, 2]]);
  }
});
test('optimized paths preserve ordered callbacks, offsets and all results', () => {
  for (const maxDenseBytes of [0, 64 * 1024 * 1024]) {
    for (const [patterns, text] of [
      [['a', 'ba', 'a', 'aba'], '0'.repeat(300) + 'ababa'],
      [['a', 'ba', 'a', 'aba', 'b'], '0'.repeat(300) + 'ababa'],
      [[']x', '-x', '^x', '\\x', '\0x', '\ud83dx', '\ude00'], '0'.repeat(300) + ']x-x^x\\x\0x\ud83dx😀'],
      [['a', 'b', 'c', 'd', 'e'], '0'.repeat(1000)],
      [['a'.repeat(65), 'a', 'aa', 'aaa'], 'a'.repeat(300)],
      [Array.from({length: 12}, (_,i) => 'a'.repeat(i + 1)), 'a'.repeat(400)],
      [Array.from({length: 40}, (_,i) => String.fromCharCode(1000+i)), '0'.repeat(300) + String.fromCharCode(1039)],
      [[], '0'.repeat(300)],
    ]) {
      const ac = new AhoCorasick(patterns, {maxDenseBytes});
      const expected = oracle(patterns, text);
      assert.deepEqual(ac.findAll(text), expected);
      const visited = [];
      ac.forEach(text, (patternIndex, start, end) => { visited.push({patternIndex, start, end}); });
      assert.deepEqual(visited, expected);
      assert.equal(ac.count(text), expected.length);
      assert.equal(ac.test(text), expected.length !== 0);
      const partial = [];
      ac.forEach(text, (patternIndex, start, end) => {
        partial.push({patternIndex, start, end});
        assert.equal(ac.test(text), true);
        return partial.length < 2;
      });
      assert.deepEqual(partial, expected.slice(0, 2));
    }
  }
});
test('long randomized inputs cross the prefilter and small-dictionary thresholds', () => {
  let seed = 2026;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const chars = ['a', 'b', '日', '\0', ']', '\ud83d', '\ude00'];
  const word = n => Array.from({length: n}, () => chars[random(chars.length)]).join('');
  for (let trial = 0; trial < 300; trial++) {
    const patterns = Array.from({length: trial % 10}, () => word(1 + random(12)));
    const text = '0'.repeat(random(400)) + word(300);
    const expected = oracle(patterns, text);
    for (const maxDenseBytes of [0, 64 * 1024 * 1024]) {
      const ac = new AhoCorasick(patterns, {maxDenseBytes});
      assert.deepEqual(ac.findAll(text), expected);
      const visited = [];
      ac.forEach(text, (patternIndex, start, end) => { visited.push({patternIndex, start, end}); });
      assert.deepEqual(visited, expected);
      assert.equal(ac.count(text), expected.length);
      assert.equal(ac.test(text), expected.length > 0);
    }
  }
});
test('deep suffix chains exceed the flattened output cap and fall back to the link walk', () => {
  // Sum of per-state outputs is 3000*3001/2 > 4Mi entries, so the flattened index is skipped.
  const patterns = Array.from({length: 3000}, (_, i) => 'a'.repeat(i + 1));
  const ac = new AhoCorasick(patterns);
  assert.equal(ac.stats.outputBytes, 0);
  const flattened = new AhoCorasick(patterns.slice(0, 100));
  assert.ok(flattened.stats.outputBytes > 0);

  const text = 'a'.repeat(120);
  const expected = oracle(patterns, text);
  assert.deepEqual(ac.findAll(text), expected);
  assert.equal(ac.count(text), expected.length);
  assert.equal(ac.test(text), true);
  const visited = [];
  ac.forEach(text, (patternIndex, start, end) => { visited.push({patternIndex, start, end}); });
  assert.deepEqual(visited, expected);

  // Both paths must agree, dense and sparse alike.
  for (const maxDenseBytes of [0, 64 * 1024 * 1024]) {
    const small = new AhoCorasick(patterns.slice(0, 40), {maxDenseBytes});
    assert.deepEqual(small.findAll(text), oracle(patterns.slice(0, 40), text));
  }
});
