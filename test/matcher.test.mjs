import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { AhoCorasick, foldCase } from '../dist/index.js';

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
      [[], 'abc'],
      [['abc'], ''],
      [['ab', 'bc'], 'a?bcab'],
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
    const random = n => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
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
  ac.forEach('aaa', () => {
    calls++;
    return false;
  });
  assert.equal(calls, 1);
  assert.equal(ac.count('aaa'), 3);
  assert.throws(
    () =>
      ac.forEach('a', () => {
        throw new Error('callback');
      }),
    /callback/,
  );
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
    assert.deepEqual(ac.findAll(`${pattern}a`), [
      { patternIndex: 0, start: 0, end: length },
      { patternIndex: 0, start: 1, end: length + 1 },
    ]);
    assert.equal(ac.count(`${pattern}a`), 2);
    assert.equal(ac.test(pattern), true);
  }
  assert.equal(new AhoCorasick(['a'], { maxDenseBytes: 8 }).stats.backend, 'dense');
  assert.equal(new AhoCorasick(['a'], { maxDenseBytes: 7 }).stats.backend, 'sparse');
});
test('callbacks may search recursively and stop inside duplicate outputs', () => {
  for (const maxDenseBytes of [0, 1024]) {
    const ac = new AhoCorasick(['a', 'a', 'ba'], { maxDenseBytes });
    const seen = [];
    ac.forEach('ba', (id, start, end) => {
      assert.equal(ac.count('ba'), 3);
      assert.equal(ac.findAll('a').length, 2);
      seen.push([id, start, end]);
      return seen.length !== 2;
    });
    assert.deepEqual(seen, [
      [2, 0, 2],
      [0, 1, 2],
    ]);
  }
});
test('optimized paths preserve ordered callbacks, offsets and all results', () => {
  for (const maxDenseBytes of [0, 64 * 1024 * 1024]) {
    for (const [patterns, text] of [
      [['a', 'ba', 'a', 'aba'], `${'0'.repeat(300)}ababa`],
      [['a', 'ba', 'a', 'aba', 'b'], `${'0'.repeat(300)}ababa`],
      [[']x', '-x', '^x', '\\x', '\0x', '\ud83dx', '\ude00'], `${'0'.repeat(300)}]x-x^x\\x\0x\ud83dx😀`],
      [['a', 'b', 'c', 'd', 'e'], '0'.repeat(1000)],
      [['a'.repeat(65), 'a', 'aa', 'aaa'], 'a'.repeat(300)],
      [Array.from({ length: 12 }, (_, i) => 'a'.repeat(i + 1)), 'a'.repeat(400)],
      [Array.from({ length: 40 }, (_, i) => String.fromCharCode(1000 + i)), '0'.repeat(300) + String.fromCharCode(1039)],
      [[], '0'.repeat(300)],
    ]) {
      const ac = new AhoCorasick(patterns, { maxDenseBytes });
      const expected = oracle(patterns, text);
      assert.deepEqual(ac.findAll(text), expected);
      const visited = [];
      ac.forEach(text, (patternIndex, start, end) => {
        visited.push({ patternIndex, start, end });
      });
      assert.deepEqual(visited, expected);
      assert.equal(ac.count(text), expected.length);
      assert.equal(ac.test(text), expected.length !== 0);
      const partial = [];
      ac.forEach(text, (patternIndex, start, end) => {
        partial.push({ patternIndex, start, end });
        assert.equal(ac.test(text), true);
        return partial.length < 2;
      });
      assert.deepEqual(partial, expected.slice(0, 2));
    }
  }
});
test('long randomized inputs cross the prefilter and small-dictionary thresholds', () => {
  let seed = 2026;
  const random = n => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const chars = ['a', 'b', '日', '\0', ']', '\ud83d', '\ude00'];
  const word = n => Array.from({ length: n }, () => chars[random(chars.length)]).join('');
  for (let trial = 0; trial < 300; trial++) {
    const patterns = Array.from({ length: trial % 10 }, () => word(1 + random(12)));
    const text = '0'.repeat(random(400)) + word(300);
    const expected = oracle(patterns, text);
    for (const maxDenseBytes of [0, 64 * 1024 * 1024]) {
      const ac = new AhoCorasick(patterns, { maxDenseBytes });
      assert.deepEqual(ac.findAll(text), expected);
      const visited = [];
      ac.forEach(text, (patternIndex, start, end) => {
        visited.push({ patternIndex, start, end });
      });
      assert.deepEqual(visited, expected);
      assert.equal(ac.count(text), expected.length);
      assert.equal(ac.test(text), expected.length > 0);
    }
  }
});
test('deep suffix chains exceed the flattened output cap and fall back to the link walk', () => {
  // Sum of per-state outputs is 3000*3001/2 > 4Mi entries, so the flattened index is skipped.
  const patterns = Array.from({ length: 3000 }, (_, i) => 'a'.repeat(i + 1));
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
  ac.forEach(text, (patternIndex, start, end) => {
    visited.push({ patternIndex, start, end });
  });
  assert.deepEqual(visited, expected);

  // Both paths must agree, dense and sparse alike.
  for (const maxDenseBytes of [0, 64 * 1024 * 1024]) {
    const small = new AhoCorasick(patterns.slice(0, 40), { maxDenseBytes });
    assert.deepEqual(small.findAll(text), oracle(patterns.slice(0, 40), text));
  }
});

function foldText(text) {
  let folded = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) {
      folded += text[i];
      continue;
    }
    const lower = text[i].toLowerCase();
    folded += lower.length === 1 ? lower : text[i];
  }
  return folded;
}
function isWordCodePoint(codePoint, wordBoundary) {
  if (codePoint < 0x80) return /[A-Za-z0-9_]/.test(String.fromCharCode(codePoint));
  return wordBoundary === 'unicode' && /^[\p{L}\p{N}\p{M}_]$/u.test(String.fromCodePoint(codePoint));
}
function atWordBoundary(text, start, end, wordBoundary) {
  if (start > 0) {
    let code = text.charCodeAt(start - 1);
    if (code >= 0xdc00 && code <= 0xdfff && start >= 2) {
      const high = text.charCodeAt(start - 2);
      if (high >= 0xd800 && high <= 0xdbff) code = (high - 0xd800) * 0x400 + code - 0xdc00 + 0x10000;
    }
    if (isWordCodePoint(code, wordBoundary)) return false;
  }
  if (end < text.length) {
    let code = text.charCodeAt(end);
    if (code >= 0xd800 && code <= 0xdbff && end + 1 < text.length) {
      const low = text.charCodeAt(end + 1);
      if (low >= 0xdc00 && low <= 0xdfff) code = (code - 0xd800) * 0x400 + low - 0xdc00 + 0x10000;
    }
    if (isWordCodePoint(code, wordBoundary)) return false;
  }
  return true;
}
/** Independent expectation: filter, sort by start, then take greedily. */
function selectOracle(patterns, text, { matchKind = 'all', caseInsensitive = false, wholeWords = false, wordBoundary = 'unicode' } = {}) {
  let matches = oracle(caseInsensitive ? patterns.map(foldText) : patterns, caseInsensitive ? foldText(text) : text);
  if (wholeWords) matches = matches.filter(m => atWordBoundary(text, m.start, m.end, wordBoundary));
  if (matchKind === 'all') return matches;
  const preferLongest = matchKind === 'leftmost-longest';
  const byStart = [...matches].sort((a, b) => a.start - b.start || (preferLongest ? b.end - b.start - (a.end - a.start) : 0) || a.patternIndex - b.patternIndex);
  const selected = [];
  let cursor = 0;
  for (const match of byStart) {
    if (match.start < cursor) continue;
    selected.push(match);
    cursor = match.end;
  }
  return selected;
}
function assertAgrees(patterns, text, options) {
  for (const maxDenseBytes of [0, 64 * 1024 * 1024]) {
    const ac = new AhoCorasick(patterns, { ...options, maxDenseBytes });
    const expected = selectOracle(patterns, text, options);
    const label = `${JSON.stringify(options)} ${JSON.stringify(patterns)} in ${JSON.stringify(text)}`;
    assert.deepEqual(ac.findAll(text), expected, label);
    const visited = [];
    ac.forEach(text, (patternIndex, start, end) => {
      visited.push({ patternIndex, start, end });
    });
    assert.deepEqual(visited, expected, label);
    assert.equal(ac.count(text), expected.length, label);
    assert.equal(ac.test(text), expected.length > 0, label);
    if (expected.length > 1) {
      const partial = [];
      ac.forEach(text, (patternIndex, start, end) => {
        partial.push({ patternIndex, start, end });
        return partial.length < 2;
      });
      assert.deepEqual(partial, expected.slice(0, 2), label);
    }
  }
}
const OPTION_MATRIX = [
  {},
  { matchKind: 'leftmost-first' },
  { matchKind: 'leftmost-longest' },
  { caseInsensitive: true },
  { wholeWords: true },
  { wholeWords: true, wordBoundary: 'ascii' },
  { matchKind: 'leftmost-longest', caseInsensitive: true, wholeWords: true },
  { matchKind: 'leftmost-first', caseInsensitive: true, wholeWords: true, wordBoundary: 'ascii' },
];

test('leftmost selection, folding and word boundaries agree with the oracle', () => {
  for (const options of OPTION_MATRIX) {
    for (const [patterns, text] of [
      [['he', 'she', 'his', 'hers'], 'ushers his she'],
      [['a', 'aa', 'aaa', 'a'], 'aaaaa'],
      [['ab', 'abc', 'b', 'bcd'], 'abcd'],
      [['abc', 'ab', 'bcd', 'b'], 'abcd'],
      [['a', 'bc', 'xyz'], 'abc'],
      [['a', 'bcd'], 'abcd'],
      [['Tokyo', 'KYOTO', 'Ｏｓａｋａ'], 'tokyo TOKYO kyoto ｏＳＡＫＡ'],
      [['ß', 'İ', 'Σ', 'ς'], 'ßİσΣς'],
      [['東京', '京都', '😀', '\ude00', '\0'], '東京京都😀\0😀'],
      [['cat', 'cats', 'at'], 'cat cats scatter _cat cat_ 猫cat猫'],
      [['x'], '😀x😀'],
      [[], 'abc'],
      [['abc'], ''],
      [['ab', 'bc'], 'a?bcab'],
      [['a', 'ba', 'a', 'aba'], `${'0'.repeat(300)}ababa`],
      [['A', 'ba', 'a', 'ABA'], `${'0'.repeat(300)}aBAba`],
    ])
      assertAgrees(patterns, text, options);
  }
});
test('seeded randomized differential tests across the option matrix', () => {
  let seed = 7;
  const random = n => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const chars = ['a', 'A', 'b', 'B', ' ', '_', '-', '日', 'Σ', 'σ', '\ud83d', '\ude00', '\0', '1'];
  const word = n => Array.from({ length: n }, () => chars[random(chars.length)]).join('');
  for (const options of OPTION_MATRIX) {
    for (let trial = 0; trial < 400; trial++) {
      const patterns = Array.from({ length: random(12) }, () => word(1 + random(6)));
      assertAgrees(patterns, word(random(60)), options);
    }
  }
});
test('leftmost selection resumes past a match the prefilter would otherwise skip', () => {
  // The pending candidate is only final once the scan passes start + maxPatternLength, so a
  // shorter earlier match must not swallow the longer pattern that follows it.
  const ac = new AhoCorasick(['a', 'bcdef'], { matchKind: 'leftmost-longest' });
  assert.deepEqual(ac.findAll(`${'0'.repeat(300)}abcdef`), [
    { patternIndex: 0, start: 300, end: 301 },
    { patternIndex: 1, start: 301, end: 306 },
  ]);
  const long = new AhoCorasick(['x'.repeat(40), 'y'], { matchKind: 'leftmost-first' });
  assert.deepEqual(long.findAll(`y${'x'.repeat(40)}`), [
    { patternIndex: 1, start: 0, end: 1 },
    { patternIndex: 0, start: 1, end: 41 },
  ]);
});
test('leftmost kinds break ties by dictionary order and by length', () => {
  assert.deepEqual(new AhoCorasick(['ab', 'abc'], { matchKind: 'leftmost-first' }).findAll('abc'), [{ patternIndex: 0, start: 0, end: 2 }]);
  assert.deepEqual(new AhoCorasick(['abc', 'ab'], { matchKind: 'leftmost-first' }).findAll('abc'), [{ patternIndex: 0, start: 0, end: 3 }]);
  assert.deepEqual(new AhoCorasick(['ab', 'abc'], { matchKind: 'leftmost-longest' }).findAll('abc'), [{ patternIndex: 1, start: 0, end: 3 }]);
  // Duplicate patterns keep the lowest id under both kinds.
  for (const matchKind of ['leftmost-first', 'leftmost-longest']) {
    assert.deepEqual(new AhoCorasick(['a', 'a'], { matchKind }).findAll('aa'), [
      { patternIndex: 0, start: 0, end: 1 },
      { patternIndex: 0, start: 1, end: 2 },
    ]);
  }
});
test('case folding keeps original patterns, offsets and unfoldable characters', () => {
  const ac = new AhoCorasick(['Straße', 'ＡＢ'], { caseInsensitive: true });
  assert.deepEqual(ac.patterns, ['Straße', 'ＡＢ']);
  assert.deepEqual(ac.findAll('STRAßE ａｂ'), [
    { patternIndex: 0, start: 0, end: 6 },
    { patternIndex: 1, start: 7, end: 9 },
  ]);
  // Length-changing folds stay literal: uppercase ß is SS, which must not match.
  assert.equal(new AhoCorasick(['ss'], { caseInsensitive: true }).test('ß'), false);
  assert.equal(new AhoCorasick(['İ'], { caseInsensitive: true }).test('i'), false);
  // Final sigma has no single-unit lowercase of its own, so it stays distinct from sigma.
  assert.equal(new AhoCorasick(['Σ'], { caseInsensitive: true }).test('ς'), false);
  assert.equal(new AhoCorasick(['Σ'], { caseInsensitive: true }).test('σ'), true);
  // Folding must not merge a surrogate half into an unrelated column.
  assert.equal(new AhoCorasick(['😀'], { caseInsensitive: true }).count('😀😀'), 2);
});
test('word boundaries respect code points, marks and the ascii mode', () => {
  const unicode = new AhoCorasick(['cat'], { wholeWords: true });
  assert.deepEqual(
    unicode.findAll('cat cats _cat 猫cat猫 (cat)').map(m => m.start),
    [0, 21],
  );
  const ascii = new AhoCorasick(['cat'], { wholeWords: true, wordBoundary: 'ascii' });
  assert.deepEqual(
    ascii.findAll('猫cat猫 cat').map(m => m.start),
    [1, 6],
  );
  // An astral neighbour is one code point, and 😀 is not a word character.
  assert.equal(new AhoCorasick(['x'], { wholeWords: true }).test('😀x😀'), true);
  // A combining mark would be cut in half, so the match is rejected.
  assert.equal(new AhoCorasick(['e'], { wholeWords: true }).test('é'), false);
  assert.equal(new AhoCorasick(['e'], { wholeWords: true, wordBoundary: 'ascii' }).test('é'), true);
});
test('replace covers strings, per-pattern arrays, functions and validation', () => {
  const ac = new AhoCorasick(['he', 'she', 'his']);
  assert.equal(ac.replace('ushers his', '*'), 'u*rs *');
  assert.equal(ac.replace('ushers his', ['HE', 'SHE', 'HIS']), 'uSHErs HIS');
  assert.equal(
    ac.replace('ushers his', (id, start, end) => `[${id}:${start}-${end}]`),
    'u[1:1-4]rs [2:7-10]',
  );
  assert.equal(ac.replace('nothing here', '*'), 'nothing *re');
  assert.equal(new AhoCorasick([]).replace('abc', '*'), 'abc');
  // matchKind: 'all' has no non-overlapping reading, so replacement takes leftmost-longest.
  assert.equal(new AhoCorasick(['ab', 'abc']).replace('abcab', '*'), '**');
  assert.equal(new AhoCorasick(['ab', 'abc'], { matchKind: 'leftmost-first' }).replace('abcab', '*'), '*c*');
  assert.equal(new AhoCorasick(['cat'], { wholeWords: true }).replace('cat cats', '*'), '* cats');
  assert.equal(new AhoCorasick(['CAT'], { caseInsensitive: true }).replace('a cat', '*'), 'a *');
  assert.throws(() => ac.replace('abc', ['only-one']), RangeError);
  assert.throws(() => ac.replace('abc', 42), TypeError);
  assert.throws(
    () =>
      ac.replace('he', () => {
        throw new Error('replacer');
      }),
    /replacer/,
  );
});
test('new options reject unknown values and stay reentrant', () => {
  assert.throws(() => new AhoCorasick([], { matchKind: 'leftmost' }), RangeError);
  assert.throws(() => new AhoCorasick([], { wordBoundary: 'utf8' }), RangeError);
  // wordBoundary decides nothing on its own, so accepting it quietly would hide the mistake.
  assert.throws(() => new AhoCorasick([], { wordBoundary: 'ascii' }), RangeError);
  assert.throws(() => new AhoCorasick([], { wordBoundary: 'ascii', wholeWords: false }), RangeError);
  assert.doesNotThrow(() => new AhoCorasick([], { wordBoundary: 'ascii', wholeWords: true }));
  assert.doesNotThrow(() => new AhoCorasick([], { wholeWords: true }));
  const ac = new AhoCorasick(['a', 'ab'], { matchKind: 'leftmost-longest' });
  const seen = [];
  ac.forEach('ab a', (id, start, end) => {
    assert.equal(ac.count('ab a'), 2);
    assert.equal(ac.replace('ab a', '*'), '* *');
    seen.push([id, start, end]);
  });
  assert.deepEqual(seen, [
    [1, 0, 2],
    [0, 3, 4],
  ]);
});
test('leftmost candidates settle on the path bound, not on the longest pattern', () => {
  // Suffix chains make every position a match for the shortest pattern, so a bound that only
  // knew the longest pattern would read 200 characters ahead before settling each one.
  const patterns = Array.from({ length: 200 }, (_, i) => 'a'.repeat(i + 1));
  const text = 'a'.repeat(2000);
  const first = new AhoCorasick(patterns, { matchKind: 'leftmost-first' });
  assert.equal(first.count(text), 2000);
  assert.deepEqual(first.findAll('aaa'), selectOracle(patterns, 'aaa', { matchKind: 'leftmost-first' }));
  const longest = new AhoCorasick(patterns, { matchKind: 'leftmost-longest' });
  assert.equal(longest.count(text), 10);
  assert.deepEqual(longest.findAll(text)[0], { patternIndex: 199, start: 0, end: 200 });
  // A gap between matches must not be re-scanned once the automaton is back at the root.
  const gapped = new AhoCorasick(['a', 'x'.repeat(200)], { matchKind: 'leftmost-first' });
  assert.equal(gapped.count(`a${'z'.repeat(100)}`.repeat(50)), 50);
  // Ranking still wins over reading ahead: a later, better-ranked pattern must be preferred.
  assert.deepEqual(new AhoCorasick(['abc', 'ab'], { matchKind: 'leftmost-first' }).findAll('abcabc'), [
    { patternIndex: 0, start: 0, end: 3 },
    { patternIndex: 0, start: 3, end: 6 },
  ]);
});
test('sparse transitions and the suffix-link output walk combine', () => {
  // 3000 suffixes push the flattened output index past its cap, and a zero byte budget
  // forces the sparse backend. Every other test reaches one of those or the other.
  const patterns = Array.from({ length: 3000 }, (_, i) => 'a'.repeat(i + 1));
  // The 'b' is in no pattern, so the scan has to walk the failure links to recover.
  const text = `${'a'.repeat(40)}b${'a'.repeat(20)}`;
  const ac = new AhoCorasick(patterns, { maxDenseBytes: 0 });
  assert.equal(ac.stats.backend, 'sparse');
  assert.equal(ac.stats.outputBytes, 0);

  const expected = oracle(patterns, text);
  assert.deepEqual(ac.findAll(text), expected);
  assert.equal(ac.count(text), expected.length);
  assert.equal(ac.test(text), true);
  const visited = [];
  ac.forEach(text, (patternIndex, start, end) => {
    visited.push({ patternIndex, start, end });
  });
  assert.deepEqual(visited, expected);
  const partial = [];
  ac.forEach(text, (patternIndex, start, end) => {
    partial.push({ patternIndex, start, end });
    return partial.length < 2;
  });
  assert.deepEqual(partial, expected.slice(0, 2));

  // Leftmost selection walks the same links, from its own loop rather than forEach's.
  for (const options of [{ matchKind: 'leftmost-first' }, { matchKind: 'leftmost-longest' }, { matchKind: 'leftmost-longest', wholeWords: true }]) {
    const lm = new AhoCorasick(patterns, { ...options, maxDenseBytes: 0 });
    assert.deepEqual(lm.findAll(text), selectOracle(patterns, text, options), JSON.stringify(options));
  }
});

/** Katakana and hiragana occupy parallel blocks, so one subtraction maps between them. */
const kanaFold = code => (code >= 0x30a1 && code <= 0x30f6 ? code - 0x60 : code);
const applyFold = (text, fold) => Array.from(text, c => String.fromCharCode(fold(c.charCodeAt(0)))).join('');

test('a custom fold matches text spelled differently, at the original offsets', () => {
  for (const maxDenseBytes of [0, 64 * 1024 * 1024]) {
    const ac = new AhoCorasick(['あほ', 'ばか'], { fold: kanaFold, maxDenseBytes });
    for (const text of ['このアホが', 'このあほが', 'バカとアホ', 'ばかとあほ', 'なにもない']) {
      const expected = oracle(['あほ', 'ばか'], applyFold(text, kanaFold));
      assert.deepEqual(ac.findAll(text), expected, text);
      assert.equal(ac.count(text), expected.length, text);
      assert.equal(ac.test(text), expected.length > 0, text);
      // Offsets index the original text, so the match slices out the original spelling.
      for (const m of ac.findAll(text)) assert.equal(m.end - m.start, ac.patterns[m.patternIndex].length);
    }
    assert.deepEqual(ac.patterns, ['あほ', 'ばか']);
    assert.equal(new AhoCorasick(['あほ'], { fold: kanaFold, maxDenseBytes }).findAll('このアホが')[0].start, 2);
  }
});

test('fold composes with foldCase, and combines with the other options', () => {
  const both = new AhoCorasick(['アホ'], { fold: code => kanaFold(foldCase(code)) });
  assert.equal(both.test('あほ'), true);
  assert.equal(both.test('アホ'), true);
  // foldCase still folds letters when composed.
  const mixed = new AhoCorasick(['abcア'], { fold: code => kanaFold(foldCase(code)) });
  assert.equal(mixed.test('ABCあ'), true);
  // Selection and word boundaries see the folded text, and report original offsets.
  const longest = new AhoCorasick(['アホ', 'アホウドリ'], { fold: kanaFold, matchKind: 'leftmost-longest' });
  assert.deepEqual(longest.findAll('あほうどり'), [{ patternIndex: 1, start: 0, end: 5 }]);
  assert.equal(new AhoCorasick(['ア'], { fold: kanaFold, wholeWords: true }).test('あ'), true);
  assert.equal(new AhoCorasick(['ア'], { fold: kanaFold, wholeWords: true }).test('あい'), false);
  assert.equal(new AhoCorasick(['アホ'], { fold: kanaFold }).replace('このあほが', '＊'), 'この＊が');
});

test('fold rejects what would break offsets or contradict caseInsensitive', () => {
  assert.throws(() => new AhoCorasick([], { fold: () => -1 }), RangeError);
  assert.throws(() => new AhoCorasick([], { fold: () => 0x10000 }), RangeError);
  assert.throws(() => new AhoCorasick([], { fold: () => 1.5 }), RangeError);
  assert.throws(() => new AhoCorasick([], { fold: () => Number.NaN }), RangeError);
  assert.throws(() => new AhoCorasick([], { caseInsensitive: true, fold: c => c }), RangeError);
  // An identity fold must behave exactly like no fold at all.
  const plain = new AhoCorasick(['ab', 'bc']);
  const identity = new AhoCorasick(['ab', 'bc'], { fold: c => c });
  assert.deepEqual(identity.findAll('abcab'), plain.findAll('abcab'));
});

test('a fold that is not idempotent still resolves through one application', () => {
  // 'a' -> 'b' -> 'c', applied once: a pattern written 'b' is reached by text 'a'.
  const chain = code => (code === 0x61 ? 0x62 : code === 0x62 ? 0x63 : code);
  // The fold applies exactly once to each side, so the pattern 'b' is stored as 'c' and
  // text matches whenever its own single application lands on 'c' too.
  const ac = new AhoCorasick(['b'], { fold: chain });
  assert.equal(ac.test('a'), false, "'a' folds to 'b', while the pattern folds to 'c'");
  assert.equal(ac.test('b'), true, 'text and pattern both fold to c');
  assert.equal(ac.test('c'), true, "'c' is already what the pattern folds to");
});

test('seeded randomized differential tests for custom folds', () => {
  let seed = 99;
  const random = n => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const chars = ['あ', 'ア', 'ほ', 'ホ', 'ば', 'バ', 'a', 'A', ' ', '\0'];
  const word = n => Array.from({ length: n }, () => chars[random(chars.length)]).join('');
  const folds = [kanaFold, code => kanaFold(foldCase(code))];
  for (const fold of folds) {
    for (let trial = 0; trial < 300; trial++) {
      const patterns = Array.from({ length: random(8) }, () => word(1 + random(4)));
      const text = word(random(40));
      const expected = oracle(
        patterns.map(p => applyFold(p, fold)),
        applyFold(text, fold),
      );
      for (const maxDenseBytes of [0, 64 * 1024 * 1024]) {
        assert.deepEqual(new AhoCorasick(patterns, { fold, maxDenseBytes }).findAll(text), expected);
      }
    }
  }
});
