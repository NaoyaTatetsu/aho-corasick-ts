import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AhoCorasick } from '../dist/index.js';
import { AhoCorasick as Baseline } from './baseline.mjs';
import Legacy from 'ahocorasick';
import Modern from 'modern-ahocorasick';
import { AhoCorasick as Monyone } from '@monyone/aho-corasick';
import { AhoCorasick as Fast } from '@monyone/aho-corasick/fast';
const adapters = [
  { name: 'before', build: p => new Baseline(p), find: (a,t) => a.findAll(t), normalize: x => x, count: (a,t) => a.count(t), test: (a,t) => a.test(t) },
  { name: 'local', build: p => new AhoCorasick(p), find: (a,t) => a.findAll(t), normalize: x => x, count: (a,t) => a.count(t), test: (a,t) => a.test(t) },
  ...[['ahocorasick', Legacy], ['modern-ahocorasick', Modern]].map(([name, C]) => ({ name, build: p => new C(p), find: (a,t) => a.search(t), normalize: (rows,p) => rows.flatMap(([end, words]) => words.map(w => ({ patternIndex: p.indexOf(w), start: end + 1 - w.length, end: end + 1 }))), ...(name === 'modern-ahocorasick' ? {test: (a,t) => a.match(t)} : {}) })),
  ...[['@monyone/aho-corasick', Monyone], ['@monyone/aho-corasick/fast', Fast]].map(([name, C]) => ({ name, build: p => new C(p), find: (a,t) => a.matchInText(t), normalize: (rows,p) => rows.map(x => ({ patternIndex: p.indexOf(x.keyword), start: x.begin, end: x.end })), test: (a,t) => a.hasKeywordInText(t) })),
];
const HEAP_LIMIT_MB = 512;
// Failure text is persisted to results.json and published, so it must carry no local paths.
// Home directories, addresses and long native stack traces are replaced by their cause.
function summarizeFailure(text) {
  const raw = String(text ?? '');
  if (/Reached heap limit|heap out of memory/.test(raw)) return `JavaScript heap out of memory at the ${HEAP_LIMIT_MB} MiB --max-old-space-size cap`;
  const scrubbed = raw
    .replace(/(?:\/(?:Users|home)|[A-Za-z]:\\Users)\/?[^\s'"\]:)]*/gi, '<path>')
    .replace(/0x[0-9a-f]+/gi, '0x<addr>')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^-+ (Native|JS) stack trace|^\d+: /.test(line));
  return [...new Set(scrubbed)].slice(0, 8).join('\n').slice(0, 600);
}
const skipped = [];
try {
  const { AhoCorasick: Native } = await import('@stll/aho-corasick');
  adapters.push({ name: '@stll/aho-corasick', build: p => new Native(p), find: (a,t) => a.findOverlappingIter(t), normalize: rows => rows.map(x => ({patternIndex: x.pattern, start: x.start, end: x.end})), test: (a,t) => a.isMatch(t) });
} catch (e) { skipped.push({ name: '@stll/aho-corasick', reason: summarizeFailure(e) }); }
let seed = 42;
const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
const alphabet = 'abcdefghijklmnopqrstuvwxyz';
const word = () => Array.from({length: 8}, () => alphabet[random(26)]).join('');
const dictionary = [...new Set(Array.from({length: 1200}, word))];
const text = Array.from({length: 12000}, (_, i) => i % 11 === 0 ? dictionary[random(dictionary.length)] : word()).join(' ');
const scenarios = [
  { name: 'ascii-many', patterns: dictionary, text },
  { name: 'ascii-no-match', patterns: dictionary, text: '0123456789 '.repeat(10000) },
  { name: 'small-dictionary', patterns: ['error', 'warning', 'fatal', 'timeout'], text: 'request completed successfully; error: timeout; '.repeat(2000) },
  { name: 'suffix-heavy', patterns: Array.from({length: 24}, (_,i) => 'a'.repeat(i+1)), text: 'a'.repeat(4000) },
  { name: 'unicode', patterns: ['東京', '京都', '検索', '高速', '😀', '東京大学'], text: '東京大学の高速検索😀、京都と東京。'.repeat(4000) },
  { name: 'large-alphabet', patterns: Array.from({length: 2000}, (_,i) => String.fromCharCode(1000+i) + '終'), text: Array.from({length: 10000}, (_,i) => String.fromCharCode(1000+i%2000) + '終').join('') },
];
const comparisonScenarios = [
  { name: 'small-dense', patterns: ['a', 'aa', 'aaa', 'aaaa'], text: 'a'.repeat(16000) },
  { name: 'small-no-match', patterns: ['error', 'warning', 'fatal', 'timeout'], text: 'request completed successfully; '.repeat(4000) },
  { name: 'late-match', patterns: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'], text: '0'.repeat(100000) + 'epsilon' },
  { name: 'root-false-positive', patterns: ['abcd', 'acbd', 'adbc', 'abdc', 'acdb'], text: 'a'.repeat(100000) },
  { name: 'short-text', patterns: dictionary, text: dictionary[0] },
  { name: 'empty-dictionary', patterns: [], text: 'abc'.repeat(30000) },
  { name: 'sparse-many', patterns: dictionary, text, sparse: true },
];
if (process.argv.includes('--compare')) scenarios.push(...comparisonScenarios);
function canonical(rows) { return rows.sort((a,b) => a.end-b.end || a.start-b.start || a.patternIndex-b.patternIndex); }
function oracle(patterns, text) {
  const rows = [];
  patterns.forEach((p, patternIndex) => { let start = text.indexOf(p); while (start !== -1) { rows.push({patternIndex, start, end: start+p.length}); start = text.indexOf(p, start+1); } });
  return canonical(rows);
}
let sink;
function measure(fn) {
  const warm = performance.now() + 60;
  do { sink = fn(); } while (performance.now() < warm);
  const samples = [];
  for (let s = 0; s < 7; s++) {
    let iterations = 0;
    const start = performance.now();
    do { sink = fn(); iterations++; } while (performance.now() - start < 35);
    samples.push((performance.now() - start) / iterations);
  }
  samples.sort((a,b) => a-b);
  return { medianMs: samples[3], minMs: samples[0], maxMs: samples[6] };
}
const results = [];
const worker = process.argv[2] === '--worker';
if (!worker) {
  for (const scenario of scenarios) for (const adapter of adapters.filter(a => process.argv.includes('--compare') ? ['local', 'before'].includes(a.name) : a.name !== 'before')) {
    const child = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_LIMIT_MB}`, fileURLToPath(import.meta.url), '--worker', scenario.name, adapter.name, ...(process.argv.includes('--compare') ? ['--compare'] : [])], {encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024});
    if (child.status !== 0) {
      skipped.push({scenario: scenario.name, name: adapter.name, reason: summarizeFailure(child.error?.message ?? child.stderr), status: child.status, signal: child.signal});
      console.log(`${scenario.name} ${adapter.name}: FAILED (recorded in results.json)`);
      if (adapter.name === 'local') throw new Error(child.stderr || 'Local benchmark failed');
      continue;
    }
    const row = JSON.parse(child.stdout.trim());
    results.push(row);
    console.log(`${row.scenario.padEnd(18)} ${row.package.padEnd(28)} build=${row.build.medianMs.toFixed(3)}ms findAll=${row.findAll.medianMs.toFixed(3)}ms`);
  }
}
for (const scenario of scenarios) {
  if (!worker || scenario.name !== process.argv[3]) continue;
  const { patterns, text } = scenario;
  const expected = oracle(patterns, text);
  for (const adapter of adapters) {
    if (adapter.name !== process.argv[4]) continue;
    const build = () => scenario.sparse ? new (adapter.name === 'before' ? Baseline : AhoCorasick)(patterns, {maxDenseBytes: 0}) : adapter.build(patterns);
    const ac = build();
    assert.deepEqual(canonical(adapter.normalize(adapter.find(ac,text),patterns)), expected, `${scenario.name}: ${adapter.name}`);
    const row = { scenario: scenario.name, package: adapter.name, patterns: patterns.length, codeUnits: text.length, matches: expected.length, build: measure(build), findAll: measure(() => adapter.find(ac,text)) };
    if (adapter.count) { assert.equal(adapter.count(ac,text), expected.length); row.count = measure(() => adapter.count(ac,text)); }
    if (adapter.test) { assert.equal(adapter.test(ac,text), expected.length > 0); row.test = measure(() => adapter.test(ac,text)); }
    if (adapter.name === 'local' || adapter.name === 'before') {
      const visit = () => { let count = 0; ac.forEach(text, () => { count++; }); return count; };
      assert.equal(visit(), expected.length);
      row.forEach = measure(visit);
    }
    if (ac.stats) row.stats = ac.stats;
    results.push(row);
    console.log(JSON.stringify(row));
  }
}
if (!worker) {
const versions = Object.fromEntries(['typescript','ahocorasick','modern-ahocorasick','@monyone/aho-corasick','@stll/aho-corasick'].map(name => [name, JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url))).version]));
const report = { generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, seed: 42, versions, methodology: '7 samples of >=35ms after >=60ms warmup; median/min/max milliseconds per call. Build and native result allocation are included in their respective operations. Normalization and correctness verification are outside timing. count has no equivalent in other tested APIs and is not an apples-to-apples findAll comparison. Synthetic fixtures only.', skipped, results };
writeFileSync(new URL(process.argv.includes('--compare') ? './optimization.json' : './results.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
} else { assert.notEqual(sink, undefined); }
