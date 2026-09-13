// Filtering banned words, which is what most dictionaries of this shape are for.
//   node --experimental-strip-types example/ng-words.ts
import { AhoCorasick } from '@naoya_tatetsu/aho-corasick-ts';

const banned = ['詐欺', '無料', '無料ギフト'];

// matchKind: 'all' reports overlaps, which is wrong for masking — '無料' and '無料ギフト'
// would both fire on the same text. leftmost-longest takes the longest match at the
// earliest position and resumes after it, so the spans never overlap.
const filter = new AhoCorasick(banned, { matchKind: 'leftmost-longest' });

const message = '無料ギフトの案内です。詐欺に注意してください。';
console.log(
  'detected:',
  filter.findAll(message).map(m => banned[m.patternIndex]),
);

// replace rewrites those same non-overlapping matches. A function receives the match,
// so the mask can keep the original length.
console.log(
  'masked  :',
  filter.replace(message, (_, start, end) => '＊'.repeat(end - start)),
);

// test is the cheapest question: does this text contain anything at all?
console.log('clean?  :', !filter.test('本日のお知らせです。'));

// An allow list is two matchers and a filter. '応募' is banned, but '応募者' is fine,
// so a banned match contained inside an allowed one is dropped.
const deny = new AhoCorasick(['応募'], { matchKind: 'leftmost-longest' });
const allow = new AhoCorasick(['応募者'], { matchKind: 'leftmost-longest' });

function violations(input: string) {
  const allowed = allow.findAll(input);
  return deny.findAll(input).filter(d => !allowed.some(a => a.start <= d.start && d.end <= a.end));
}

for (const input of ['応募はこちら', '応募者の一覧']) {
  console.log(`allow list: ${JSON.stringify(input)} -> ${violations(input).length} violation(s)`);
}
