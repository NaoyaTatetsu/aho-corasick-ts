// The fundamentals: build a dictionary once, then apply it to as many texts as you like.
//   node --experimental-strip-types example/basic.ts
import { AhoCorasick } from '@naoya_tatetsu/aho-corasick-ts';

// Construction is the expensive part, so a fixed dictionary belongs at module level.
const keywords = ['he', 'she', 'hers'];
const matcher = new AhoCorasick(keywords);

// Every match is reported, overlaps included: 'she', 'he' and 'hers' all sit in 'ushers'.
console.log('findAll:', matcher.findAll('ushers'));

// patternIndex indexes the array you passed in; start and end are UTF-16 code units,
// exactly as String.prototype.slice uses them, with end exclusive.
const text = 'ushers';
for (const { patternIndex, start, end } of matcher.findAll(text)) {
  console.log(`  ${keywords[patternIndex]} at ${start}..${end} -> ${JSON.stringify(text.slice(start, end))}`);
}

// Take only what you need. Each of these avoids work the others do.
console.log('test  :', matcher.test('ushers'), '(stops at the first match)');
console.log('count :', matcher.count('ushers'), '(builds no result objects)');

// forEach reports through a callback, so no result array is built. Returning exactly
// false ends the scan, which is how you take the first few matches cheaply.
const firstTwo: string[] = [];
matcher.forEach('ushers', patternIndex => {
  firstTwo.push(keywords[patternIndex]!);
  if (firstTwo.length === 2) return false;
});
console.log('forEach, stopped early:', firstTwo);
