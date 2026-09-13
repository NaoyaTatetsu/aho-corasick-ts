// Wrapping matches in markup, which needs spans that do not overlap.
//   node --experimental-strip-types example/highlight.ts
import { AhoCorasick } from '@naoya_tatetsu/aho-corasick-ts';

const terms = ['東京', '東京大学', '大学'];
const source = '東京大学と東京の大学';

// The default reports every match, overlaps included — five here, which cannot all be
// wrapped at once because their spans collide.
console.log('all matches      :', new AhoCorasick(terms).findAll(source).length);

// leftmost-longest prefers the longest match at the earliest position: '東京大学' wins
// over the '東京' inside it.
const longest = new AhoCorasick(terms, { matchKind: 'leftmost-longest' });
console.log(
  'leftmost-longest :',
  longest.replace(source, (_, start, end) => `<mark>${source.slice(start, end)}</mark>`),
);

// leftmost-first prefers whichever pattern comes first in the dictionary, so '東京'
// wins instead and '大学' is matched separately.
const first = new AhoCorasick(terms, { matchKind: 'leftmost-first' });
console.log(
  'leftmost-first   :',
  first.replace(source, (_, start, end) => `<mark>${source.slice(start, end)}</mark>`),
);

// A per-pattern array gives each term its own replacement. Its length must equal the
// dictionary's, which is checked rather than silently ignored.
console.log('per pattern      :', longest.replace(source, ['[都市]', '[大学]', '[学校]']));

// wholeWords drops matches whose neighbours are word characters, which is what stops
// 'cat' from firing inside 'cats'.
const whole = new AhoCorasick(['cat'], { matchKind: 'leftmost-longest', wholeWords: true });
console.log('wholeWords       :', whole.replace('a cat and cats', '<mark>cat</mark>'));
