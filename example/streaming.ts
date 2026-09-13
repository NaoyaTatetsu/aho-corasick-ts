// Scanning text that arrives in pieces, where a keyword can straddle the seam.
//   node --experimental-strip-types example/streaming.ts
import assert from 'node:assert/strict';
import { AhoCorasick } from '@naoya_tatetsu/aho-corasick-ts';

const words = ['無料キャンペーン', '当選'];
const matcher = new AhoCorasick(words, { matchKind: 'leftmost-longest' });

// Both keywords are cut in half by the seams between these pieces.
const pieces = ['ただいま無料キャ', 'ンペーン実施中、ご当', '選おめでとうございます'];

// Scanning each piece on its own finds nothing at all.
console.log('pieces scanned alone:', pieces.flatMap(p => matcher.findAll(p)).length, 'matches');
console.log('whole text          :', matcher.findAll(pieces.join('')).length, 'matches');

// Carrying the tail of each piece into the next one fixes it. The tail has to be one
// character shorter than the longest pattern: any match that survives a seam starts
// within that window, and anything longer would have been found already.
const carryLength = Math.max(...words.map(w => w.length)) - 1;

function scanPieces(chunks: string[]) {
  const found: { word: string; start: number }[] = [];
  let carry = '';
  let consumed = 0;
  for (const chunk of chunks) {
    const window = carry + chunk;
    for (const match of matcher.findAll(window)) {
      // Translate the offset inside the window back onto the whole text.
      const start = consumed - carry.length + match.start;
      // The carried tail is scanned twice, so a match found in it can repeat.
      if (!found.some(f => f.start === start)) found.push({ word: words[match.patternIndex]!, start });
    }
    consumed += chunk.length;
    carry = window.slice(-carryLength);
  }
  return found;
}

const streamed = scanPieces(pieces);
console.log('carrying the tail   :', streamed);

// The point of the technique is that it gives the same answer as reading everything.
const whole = matcher.findAll(pieces.join('')).map(m => ({ word: words[m.patternIndex]!, start: m.start }));
assert.deepEqual(streamed, whole);
console.log('matches whole-text scan:', true);

// Worth knowing before reaching for this: a JavaScript string holds about 536 million
// characters, and scanning 100 million takes about 0.1s in 191MiB. Pieces are for text
// that is larger than that, or that has not finished arriving.
