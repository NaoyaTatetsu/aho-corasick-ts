// Matching text that is spelled another way: case, kana, fullwidth.
//   node --experimental-strip-types example/spelling-variants.ts
import { AhoCorasick, foldCase } from '@naoya_tatetsu/aho-corasick-ts';

// caseInsensitive folds one thing: letter case.
const errors = new AhoCorasick(['error', 'warning'], { caseInsensitive: true });
console.log('caseInsensitive:', errors.findAll('Fatal ERROR and Warning'));
// Offsets index the original text, and patterns keep the spelling you passed in.
console.log('  patterns are untouched:', errors.patterns);

// fold generalises it: you supply the mapping. Katakana and hiragana sit in parallel
// blocks, so one subtraction moves between them.
const kana = (code: number) => (code >= 0x30a1 && code <= 0x30f6 ? code - 0x60 : code);
const kanaMatcher = new AhoCorasick(['あほ'], { fold: kana });
console.log('kana fold   :', kanaMatcher.test('このアホが'), '(katakana text, hiragana pattern)');

// Fullwidth letters sit a fixed distance from their ASCII counterparts.
const fullwidth = (code: number) => (code >= 0xff21 && code <= 0xff5a ? code - 0xfee0 : code);
console.log('fullwidth   :', new AhoCorasick(['abc'], { fold: fullwidth }).test('ｘｘａｂｃ'));

// Mappings compose. foldCase is the one caseInsensitive uses, exported so a custom fold
// can build on it rather than reimplement it.
const both = new AhoCorasick(['アホ'], { fold: code => kana(foldCase(code)) });
console.log('kana + case :', both.test('あほ'), both.test('アホ'));

// The mapping must return a code unit, because that is what keeps offsets pointing into
// the original text. A mapping that changed a string's length would move every offset
// after it, so it is refused rather than silently wrong.
try {
  new AhoCorasick(['a'], { fold: () => 0x10000 });
} catch (error) {
  console.log('rejected    :', (error as Error).message);
}
