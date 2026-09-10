/** One slot per UTF-16 code unit, so mapping a character to a column is a single lookup. */
const CODE_UNIT_COUNT = 0x10000;
/** Default transition-table budget: 64 MiB. */
const DEFAULT_DENSE_BUDGET_BYTES = 64 * 1024 * 1024;
/** Automatons up to this many states address their table with Uint16Array, halving its size. */
const NARROW_TABLE_STATES = 0x10000;
/** Upper bound on the cells of a single transition table. */
const MAX_TABLE_CELLS = 0xffffffff;
/** Output index cap: 4Mi ids (16 MiB). Larger dictionaries walk suffix links instead. */
const MAX_OUTPUT_ENTRIES = 4 * 1024 * 1024;
/** Shorter texts are scanned directly; the prefilter's own pass would not pay for itself. */
const PREFILTER_MIN_TEXT_LENGTH = 256;
/** Past this many distinct first characters the prefilter rarely rejects anything. */
const PREFILTER_MAX_ROOTS = 32;
/** Dictionary bounds under which repeated indexOf beats running the automaton. */
const INDEXOF_MAX_PATTERNS = 4;
const INDEXOF_MAX_PATTERN_LENGTH = 64;
/** One state reporting this many patterns makes findAll pre-size its result array. */
const PREALLOCATE_MIN_OUTPUTS = 8;

/** Offsets use UTF-16 code units, as in String.slice. End is exclusive. */
export interface Match {
  readonly patternIndex: number;
  readonly start: number;
  readonly end: number;
}

export interface Options {
  /** Maximum bytes for the dense transition table. Default: 64 MiB. 0 forces sparse. */
  maxDenseBytes?: number;
}

/** Return false to stop scanning. */
export type MatchCallback = (patternIndex: number, start: number, end: number) => void | boolean;

/** The pattern trie, before failure links turn it into an automaton. State 0 is the root. */
interface Trie {
  /** Per state: code unit to child state. */
  readonly edges: Map<number, number>[];
  /** Per state: ids of the patterns ending exactly there, in input order. */
  readonly outputs: number[][];
  /** Code unit to table column, or 0 for code units absent from every pattern. */
  readonly alphabet: Uint32Array;
  /** Distinct code units used, so columns run 1..symbolCount. */
  readonly symbolCount: number;
}

/** What the breadth-first pass over the trie derives. All arrays are indexed by state. */
interface Failures {
  /** Longest proper suffix of this state's prefix that is itself a trie node. */
  readonly failure: Uint32Array;
  /** Nearest state along the failure chain owning outputs, or 0 when there is none. */
  readonly outputLink: Uint32Array;
  /** Patterns reported at this state, including those inherited through outputLink. */
  readonly outputCount: Uint32Array;
  /** Every state except the root, shallowest first. */
  readonly bfsOrder: Uint32Array;
}

/** Pattern ids regrouped so that one state's reportable patterns are contiguous. */
interface OutputIndex {
  /** All ids, state by state. */
  readonly runs: Uint32Array;
  /** Where a state's run begins. Its length is outputCount[state]. */
  readonly runStart: Uint32Array;
}

function buildTrie(dictionary: readonly string[]): Trie {
  const alphabet = new Uint32Array(CODE_UNIT_COUNT);
  const edges: Map<number, number>[] = [new Map()];
  const outputs: number[][] = [[]];
  let symbolCount = 0;
  for (let id = 0; id < dictionary.length; id++) {
    const pattern = dictionary[id]!;
    if (typeof pattern !== 'string') throw new TypeError('Patterns must be strings');
    if (pattern.length === 0) throw new RangeError('Empty patterns are not supported');
    let state = 0;
    for (let i = 0; i < pattern.length; i++) {
      const code = pattern.charCodeAt(i);
      if (alphabet[code] === 0) alphabet[code] = ++symbolCount;
      let next = edges[state]!.get(code);
      if (next === undefined) {
        next = edges.length;
        edges[state]!.set(code, next);
        edges.push(new Map());
        outputs.push([]);
      }
      state = next;
    }
    outputs[state]!.push(id);
  }
  return { edges, outputs, alphabet, symbolCount };
}

/**
 * Standard Aho-Corasick construction: visiting states shallowest first lets each failure link
 * be resolved from links already known, and lets output totals accumulate along the chain.
 */
function linkFailures({ edges, outputs }: Trie): Failures {
  const size = edges.length;
  const failure = new Uint32Array(size);
  const outputLink = new Uint32Array(size);
  const outputCount = new Uint32Array(size);
  // Every state but the root is enqueued exactly once, when discovered as a child.
  const bfsOrder = new Uint32Array(size - 1);
  let head = 0;
  let tail = 0;
  for (const child of edges[0]!.values()) bfsOrder[tail++] = child;
  while (head < tail) {
    const state = bfsOrder[head++]!;
    const fallback = failure[state]!;
    outputCount[state] = outputs[state]!.length + outputCount[fallback]!;
    outputLink[state] = outputs[fallback]!.length ? fallback : outputLink[fallback]!;
    for (const [code, child] of edges[state]!) {
      let f = fallback;
      while (f !== 0 && !edges[f]!.has(code)) f = failure[f]!;
      failure[child] = edges[f]!.get(code) ?? 0;
      bfsOrder[tail++] = child;
    }
  }
  return { failure, outputLink, outputCount, bfsOrder };
}

/**
 * Flattening the suffix-link output chains into one contiguous run per state turns the
 * per-match walk into a single tight loop over one TypedArray, with no per-state output
 * array to dereference. Inherited outputs are copied, so the total is bounded first.
 */
function buildOutputIndex({ outputs }: Trie, { outputLink, outputCount, bfsOrder }: Failures): OutputIndex | undefined {
  let entries = 0;
  for (let state = 0; state < outputCount.length; state++) entries += outputCount[state]!;
  if (entries > MAX_OUTPUT_ENTRIES) return undefined;
  const runs = new Uint32Array(entries);
  const runStart = new Uint32Array(outputCount.length);
  let cursor = 0;
  // Shallowest first, so the run a state inherits from is already written.
  for (let i = 0; i < bfsOrder.length; i++) {
    const state = bfsOrder[i]!;
    if (outputCount[state] === 0) continue;
    const own = outputs[state]!;
    runStart[state] = cursor;
    for (let j = 0; j < own.length; j++) runs[cursor++] = own[j]!;
    const link = outputLink[state]!;
    if (link !== 0) {
      const from = runStart[link]!;
      runs.set(runs.subarray(from, from + outputCount[link]!), cursor);
      cursor += outputCount[link]!;
    }
  }
  return { runs, runStart };
}

/**
 * Collapses the failure links into a full DFA: one row of rowWidth cells per state, so a
 * transition is one array read with no chain to follow. Returns undefined when the table
 * would exceed the budget, leaving the scan to consult edges and failure directly.
 */
function buildDenseTable({ edges, alphabet }: Trie, { failure, bfsOrder }: Failures, rowWidth: number, budgetBytes: number): Uint16Array | Uint32Array | undefined {
  const size = edges.length;
  const cells = size * rowWidth;
  // Small automata halve transition memory and fit more rows in CPU caches.
  const Table = size <= NARROW_TABLE_STATES ? Uint16Array : Uint32Array;
  if (cells * Table.BYTES_PER_ELEMENT > budgetBytes || cells > MAX_TABLE_CELLS) return undefined;
  const table = new Table(cells);
  for (const [code, child] of edges[0]!) table[alphabet[code]!] = child;
  // A state's row starts as a copy of its fallback's row, then its own edges override.
  for (let i = 0; i < bfsOrder.length; i++) {
    const state = bfsOrder[i]!;
    const row = state * rowWidth;
    const fallback = failure[state]! * rowWidth;
    table.set(table.subarray(fallback, fallback + rowWidth), row);
    for (const [code, child] of edges[state]!) table[row + alphabet[code]!] = child;
  }
  return table;
}

/**
 * A character class of every possible first character. Searching it skips text that cannot
 * start a match. Built from escaped UTF-16 code units, so no metacharacter, Unicode
 * normalization or stateful flag can alter the meaning.
 */
function buildPrefilter(rootCodes: readonly number[]): RegExp | undefined {
  if (rootCodes.length === 0 || rootCodes.length > PREFILTER_MAX_ROOTS) return undefined;
  const escaped = rootCodes.map(code => '\\u' + code.toString(16).padStart(4, '0'));
  return new RegExp('[' + escaped.join('') + ']');
}

/**
 * Immutable, case-sensitive multi-pattern matcher. Duplicate patterns retain their IDs.
 *
 * Scanning reads two structures, both indexed by state:
 * - transitions, either the dense `table` or, for dictionaries over the byte budget,
 *   `edges` plus `failure`;
 * - outputs, either the flattened `outputRuns`/`outputRunStart` or, for dictionaries over
 *   MAX_OUTPUT_ENTRIES, `outputs` plus `outputLink`.
 *
 * `outputCount[state]` serves both: it is the length of the state's run, and its zero check
 * is the scan's fast exit for the common state that reports nothing.
 */
export class AhoCorasick {
  readonly patterns: readonly string[];
  readonly stats: Readonly<{ states: number; alphabetSize: number; backend: 'dense' | 'sparse'; transitionBytes: number; outputBytes: number }>;
  private readonly alphabet: Uint32Array;
  private readonly rowWidth: number;
  private readonly table: Uint16Array | Uint32Array | undefined;
  private readonly edges: Map<number, number>[] | undefined;
  private readonly failure: Uint32Array;
  private readonly outputLink: Uint32Array;
  private readonly outputs: number[][];
  private readonly outputCount: Uint32Array;
  private readonly outputRuns: Uint32Array | undefined;
  private readonly outputRunStart: Uint32Array | undefined;
  private readonly scanWithIndexOf: boolean;
  private readonly prefilter: RegExp | undefined;
  private readonly preallocateResults: boolean;

  constructor(patterns: Iterable<string>, options: Options = {}) {
    const budgetBytes = options.maxDenseBytes ?? DEFAULT_DENSE_BUDGET_BYTES;
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0) throw new RangeError('maxDenseBytes must be a non-negative safe integer');
    const dictionary = Array.from(patterns);
    this.patterns = Object.freeze(dictionary);

    const trie = buildTrie(dictionary);
    const failures = linkFailures(trie);
    const rowWidth = trie.symbolCount + 1;
    const outputIndex = buildOutputIndex(trie, failures);
    const table = buildDenseTable(trie, failures, rowWidth, budgetBytes);

    this.alphabet = trie.alphabet;
    this.rowWidth = rowWidth;
    this.table = table;
    this.edges = table ? undefined : trie.edges;
    this.failure = failures.failure;
    this.outputLink = failures.outputLink;
    this.outputs = trie.outputs;
    this.outputCount = failures.outputCount;
    this.outputRuns = outputIndex?.runs;
    this.outputRunStart = outputIndex?.runStart;
    this.scanWithIndexOf = dictionary.length <= INDEXOF_MAX_PATTERNS && dictionary.every(pattern => pattern.length <= INDEXOF_MAX_PATTERN_LENGTH);
    this.prefilter = buildPrefilter([...trie.edges[0]!.keys()]);
    this.preallocateResults = failures.outputCount.some(count => count >= PREALLOCATE_MIN_OUTPUTS);
    this.stats = Object.freeze({
      states: trie.edges.length,
      alphabetSize: trie.symbolCount,
      backend: table ? 'dense' : 'sparse',
      transitionBytes: table?.byteLength ?? 0,
      outputBytes: (outputIndex?.runs.byteLength ?? 0) + (outputIndex?.runStart.byteLength ?? 0),
    });
  }

  /** Counts all overlapping matches without allocating results: O(text.length). */
  count(text: string): number {
    if (this.scanWithIndexOf) {
      let total = 0;
      for (const pattern of this.patterns) {
        let start = text.indexOf(pattern);
        while (start !== -1) {
          total++;
          start = text.indexOf(pattern, start + 1);
        }
      }
      return total;
    }
    const begin = this.scanStart(text);
    if (begin < 0) return 0;
    const { table, alphabet, rowWidth, outputCount } = this;
    let state = 0;
    let total = 0;
    // Summing the precomputed per-state totals needs no output lookup at all.
    if (table) {
      for (let i = begin; i < text.length; i++) {
        state = table[state * rowWidth + alphabet[text.charCodeAt(i)]!]!;
        total += outputCount[state]!;
      }
    } else {
      const edges = this.edges!;
      const failure = this.failure;
      for (let i = begin; i < text.length; i++) {
        const code = text.charCodeAt(i);
        let next = edges[state]!.get(code);
        while (next === undefined && state !== 0) {
          state = failure[state]!;
          next = edges[state]!.get(code);
        }
        state = next ?? 0;
        total += outputCount[state]!;
      }
    }
    return total;
  }

  /** Stops at the first match without allocating results. */
  test(text: string): boolean {
    if (this.scanWithIndexOf) {
      for (const pattern of this.patterns) if (text.indexOf(pattern) !== -1) return true;
      return false;
    }
    const begin = this.scanStart(text);
    if (begin < 0) return false;
    const { table, alphabet, rowWidth, outputCount } = this;
    let state = 0;
    if (table) {
      for (let i = begin; i < text.length; i++) {
        state = table[state * rowWidth + alphabet[text.charCodeAt(i)]!]!;
        if (outputCount[state] !== 0) return true;
      }
    } else {
      const edges = this.edges!;
      const failure = this.failure;
      for (let i = begin; i < text.length; i++) {
        const code = text.charCodeAt(i);
        let next = edges[state]!.get(code);
        while (next === undefined && state !== 0) {
          state = failure[state]!;
          next = edges[state]!.get(code);
        }
        state = next ?? 0;
        if (outputCount[state] !== 0) return true;
      }
    }
    return false;
  }

  /** End-position order, then longest pattern first, then input order for duplicates. */
  findAll(text: string): Match[] {
    const { table, alphabet, rowWidth, outputCount, outputRuns, patterns } = this;
    // Only the dense automaton with a flattened output index is worth its own loop here;
    // every other configuration collects the callbacks forEach already emits in order.
    if (!table || !outputRuns || this.scanWithIndexOf) {
      const collected: Match[] = [];
      this.forEach(text, (patternIndex, start, end) => { collected.push({ patternIndex, start, end }); });
      return collected;
    }
    const begin = this.scanStart(text);
    if (begin < 0) return [];
    // For output-heavy automatons an extra count pass avoids growing/copying the result array.
    const matches: Match[] = this.preallocateResults ? new Array<Match>(this.count(text)) : [];
    const outputRunStart = this.outputRunStart!;
    let written = 0;
    let state = 0;
    for (let i = begin; i < text.length; i++) {
      state = table[state * rowWidth + alphabet[text.charCodeAt(i)]!]!;
      const reported = outputCount[state]!;
      if (reported === 0) continue;
      const end = i + 1;
      const from = outputRunStart[state]!;
      for (let k = from, stop = from + reported; k < stop; k++) {
        const patternIndex = outputRuns[k]!;
        matches[written++] = { patternIndex, start: end - patterns[patternIndex]!.length, end };
      }
    }
    return matches;
  }

  /**
   * Visits all overlapping matches; callback returning false stops the scan.
   *
   * The loops below are the product of the two transition backends and the two output
   * representations. Each is written out rather than composed, so that neither choice costs
   * a branch or an indirect call per character.
   */
  forEach(text: string, callback: MatchCallback): void {
    if (this.scanWithIndexOf) return this.forEachViaIndexOf(text, callback);
    const begin = this.scanStart(text);
    if (begin < 0) return;
    const { table, alphabet, rowWidth, outputCount, outputRuns, patterns } = this;
    let state = 0;
    if (table && outputRuns) {
      const outputRunStart = this.outputRunStart!;
      for (let i = begin; i < text.length; i++) {
        state = table[state * rowWidth + alphabet[text.charCodeAt(i)]!]!;
        const reported = outputCount[state]!;
        if (reported === 0) continue;
        const end = i + 1;
        const from = outputRunStart[state]!;
        for (let k = from, stop = from + reported; k < stop; k++) {
          const id = outputRuns[k]!;
          if (callback(id, end - patterns[id]!.length, end) === false) return;
        }
      }
      return;
    }
    if (table) {
      for (let i = begin; i < text.length; i++) {
        state = table[state * rowWidth + alphabet[text.charCodeAt(i)]!]!;
        if (outputCount[state] === 0) continue;
        if (!this.reportLinkedOutputs(state, i + 1, callback)) return;
      }
      return;
    }
    const edges = this.edges!;
    const failure = this.failure;
    if (outputRuns) {
      const outputRunStart = this.outputRunStart!;
      for (let i = begin; i < text.length; i++) {
        const code = text.charCodeAt(i);
        let next = edges[state]!.get(code);
        while (next === undefined && state !== 0) {
          state = failure[state]!;
          next = edges[state]!.get(code);
        }
        state = next ?? 0;
        const reported = outputCount[state]!;
        if (reported === 0) continue;
        const end = i + 1;
        const from = outputRunStart[state]!;
        for (let k = from, stop = from + reported; k < stop; k++) {
          const id = outputRuns[k]!;
          if (callback(id, end - patterns[id]!.length, end) === false) return;
        }
      }
      return;
    }
    for (let i = begin; i < text.length; i++) {
      const code = text.charCodeAt(i);
      let next = edges[state]!.get(code);
      while (next === undefined && state !== 0) {
        state = failure[state]!;
        next = edges[state]!.get(code);
      }
      state = next ?? 0;
      if (outputCount[state] === 0) continue;
      if (!this.reportLinkedOutputs(state, i + 1, callback)) return;
    }
  }

  /** Skip only the initial impossible prefix; offsets remain relative to the original text. */
  private scanStart(text: string): number {
    return text.length >= PREFILTER_MIN_TEXT_LENGTH && this.prefilter ? text.search(this.prefilter) : 0;
  }

  /**
   * Reports the patterns of one state by walking its suffix links, for dictionaries whose
   * flattened index would exceed MAX_OUTPUT_ENTRIES. Returns false if the callback stopped.
   */
  private reportLinkedOutputs(state: number, end: number, callback: MatchCallback): boolean {
    const { outputs, outputLink, patterns } = this;
    for (let output = state; output !== 0; output = outputLink[output]!) {
      const ids = outputs[output]!;
      for (let j = 0; j < ids.length; j++) {
        const id = ids[j]!;
        if (callback(id, end - patterns[id]!.length, end) === false) return false;
      }
    }
    return true;
  }

  /** Merge at most four indexOf streams in the same order as the automaton. */
  private forEachViaIndexOf(text: string, callback: MatchCallback): void {
    const patterns = this.patterns;
    const positions = patterns.map(pattern => text.indexOf(pattern));
    while (true) {
      let best = -1;
      let bestEnd = Infinity;
      let bestStart = Infinity;
      for (let id = 0; id < patterns.length; id++) {
        const start = positions[id]!;
        if (start < 0) continue;
        const end = start + patterns[id]!.length;
        if (end < bestEnd || (end === bestEnd && start < bestStart)) {
          best = id;
          bestEnd = end;
          bestStart = start;
        }
      }
      if (best < 0) return;
      if (callback(best, bestStart, bestEnd) === false) return;
      positions[best] = text.indexOf(patterns[best]!, bestStart + 1);
    }
  }
}

export default AhoCorasick;
