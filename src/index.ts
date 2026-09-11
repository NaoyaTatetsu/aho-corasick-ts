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

/**
 * Which matches the scan reports.
 *
 * - `all`: every match, overlaps included.
 * - `leftmost-first`: non-overlapping; the earliest start wins, ties go to the pattern that
 *   comes first in the dictionary.
 * - `leftmost-longest`: non-overlapping; the earliest start wins, ties go to the longest
 *   pattern.
 */
export type MatchKind = 'all' | 'leftmost-first' | 'leftmost-longest';

/** Which characters `wholeWords` treats as part of a word. */
export type WordBoundary = 'unicode' | 'ascii';

/** A fixed string, one string per pattern id, or a function of the match. */
export type Replacement = string | readonly string[] | ((patternIndex: number, start: number, end: number) => string);

export interface Options {
  /** Maximum bytes for the dense transition table. Default: 64 MiB. 0 forces sparse. */
  maxDenseBytes?: number;
  /** Overlapping or non-overlapping results. Default: `all`. */
  matchKind?: MatchKind;
  /** Fold each code unit to lower case before matching. Default: false. */
  caseInsensitive?: boolean;
  /** Report only matches whose neighbouring characters are not word characters. Default: false. */
  wholeWords?: boolean;
  /** Word characters for `wholeWords`. Default: `unicode`. */
  wordBoundary?: WordBoundary;
}

/** Return false to stop scanning. */
export type MatchCallback = (patternIndex: number, start: number, end: number) => void | boolean;

/** ASCII word characters, the shared core of both WordBoundary modes. */
const ASCII_WORD = new Uint8Array(0x80);
for (const range of ['az', 'AZ', '09']) {
  for (let code = range.charCodeAt(0); code <= range.charCodeAt(1); code++) ASCII_WORD[code] = 1;
}
ASCII_WORD[0x5f] = 1;

/** Letters, numbers and combining marks: a match must not cut into any of them. */
const UNICODE_WORD = /^[\p{L}\p{N}\p{M}_]$/u;

/**
 * Per-code-unit lower-case folding, built once per process and shared by every instance.
 * Folds that change length would break the offset arithmetic, so they are left out.
 */
let caseFold: Uint16Array | undefined;
function caseFoldTable(): Uint16Array {
  if (caseFold) return caseFold;
  const fold = new Uint16Array(CODE_UNIT_COUNT);
  for (let code = 0; code < CODE_UNIT_COUNT; code++) {
    // Surrogates carry no case and must stay intact so pairs remain addressable.
    if (code >= 0xd800 && code <= 0xdfff) {
      fold[code] = code;
      continue;
    }
    const lower = String.fromCharCode(code).toLowerCase();
    fold[code] = lower.length === 1 ? lower.charCodeAt(0) : code;
  }
  caseFold = fold;
  return fold;
}

/** The pattern trie, before failure links turn it into an automaton. State 0 is the root. */
interface Trie {
  /** Per state: table column to child state. */
  readonly edges: Map<number, number>[];
  /** Per state: ids of the patterns ending exactly there, in input order. */
  readonly outputs: number[][];
  /** Code unit to table column, or 0 for code units absent from every pattern. */
  readonly alphabet: Uint32Array;
  /** Distinct code units used, so columns run 1..symbolCount. */
  readonly symbolCount: number;
  /** Code units that can begin a match, for the prefilter. */
  readonly rootCodes: number[];
}

/** What the breadth-first pass over the trie derives. All arrays are indexed by state. */
interface Failures {
  /** Longest proper suffix of this state's prefix that is itself a trie node. */
  readonly failure: Uint32Array;
  /** Nearest state along the failure chain owning outputs, or 0 when there is none. */
  readonly outputLink: Uint32Array;
  /** Patterns reported at this state, including those inherited through outputLink. */
  readonly outputCount: Uint32Array;
  /** Length of the path from the root, which bounds how far back a future match can start. */
  readonly depth: Uint32Array;
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

/**
 * Edges are keyed by table column rather than by code unit, so `alphabet` is the single
 * place where a character becomes a symbol. Case folding therefore costs the scan nothing:
 * every code unit that folds onto a pattern character shares that character's column.
 */
function buildTrie(dictionary: readonly string[], fold: Uint16Array | undefined): Trie {
  const alphabet = new Uint32Array(CODE_UNIT_COUNT);
  const edges: Map<number, number>[] = [new Map()];
  const outputs: number[][] = [[]];
  const rootCodes: number[] = [];
  let symbolCount = 0;
  for (let id = 0; id < dictionary.length; id++) {
    const pattern = dictionary[id]!;
    if (typeof pattern !== 'string') throw new TypeError('Patterns must be strings');
    if (pattern.length === 0) throw new RangeError('Empty patterns are not supported');
    let state = 0;
    for (let i = 0; i < pattern.length; i++) {
      const raw = pattern.charCodeAt(i);
      const code = fold ? fold[raw]! : raw;
      if (alphabet[code] === 0) alphabet[code] = ++symbolCount;
      const column = alphabet[code]!;
      // State 0 is only ever current at i === 0, so this records first characters exactly.
      if (i === 0 && !edges[0]!.has(column)) rootCodes.push(code);
      let next = edges[state]!.get(column);
      if (next === undefined) {
        next = edges.length;
        edges[state]!.set(column, next);
        edges.push(new Map());
        outputs.push([]);
      }
      state = next;
    }
    outputs[state]!.push(id);
  }
  return { edges, outputs, alphabet, symbolCount, rootCodes };
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
  const depth = new Uint32Array(size);
  // Every state but the root is enqueued exactly once, when discovered as a child.
  const bfsOrder = new Uint32Array(size - 1);
  let head = 0;
  let tail = 0;
  for (const child of edges[0]!.values()) {
    depth[child] = 1;
    bfsOrder[tail++] = child;
  }
  while (head < tail) {
    const state = bfsOrder[head++]!;
    const fallback = failure[state]!;
    outputCount[state] = outputs[state]!.length + outputCount[fallback]!;
    outputLink[state] = outputs[fallback]!.length ? fallback : outputLink[fallback]!;
    for (const [column, child] of edges[state]!) {
      let f = fallback;
      while (f !== 0 && !edges[f]!.has(column)) f = failure[f]!;
      failure[child] = edges[f]!.get(column) ?? 0;
      depth[child] = depth[state]! + 1;
      bfsOrder[tail++] = child;
    }
  }
  return { failure, outputLink, outputCount, depth, bfsOrder };
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
function buildDenseTable({ edges }: Trie, { failure, bfsOrder }: Failures, rowWidth: number, budgetBytes: number): Uint16Array | Uint32Array | undefined {
  const size = edges.length;
  const cells = size * rowWidth;
  // Small automata halve transition memory and fit more rows in CPU caches.
  const Table = size <= NARROW_TABLE_STATES ? Uint16Array : Uint32Array;
  if (cells * Table.BYTES_PER_ELEMENT > budgetBytes || cells > MAX_TABLE_CELLS) return undefined;
  const table = new Table(cells);
  for (const [column, child] of edges[0]!) table[column] = child;
  // A state's row starts as a copy of its fallback's row, then its own edges override.
  for (let i = 0; i < bfsOrder.length; i++) {
    const state = bfsOrder[i]!;
    const row = state * rowWidth;
    const fallback = failure[state]! * rowWidth;
    table.set(table.subarray(fallback, fallback + rowWidth), row);
    for (const [column, child] of edges[state]!) table[row + column] = child;
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
 * Immutable multi-pattern matcher. Duplicate patterns retain their IDs.
 *
 * Scanning reads two structures, both indexed by state:
 * - transitions, either the dense `table` or, for dictionaries over the byte budget,
 *   `edges` plus `failure`;
 * - outputs, either the flattened `outputRuns`/`outputRunStart` or, for dictionaries over
 *   MAX_OUTPUT_ENTRIES, `outputs` plus `outputLink`.
 *
 * `outputCount[state]` serves both: it is the length of the state's run, and its zero check
 * is the scan's fast exit for the common state that reports nothing.
 *
 * `matchKind`, `caseInsensitive` and `wholeWords` are layered so that leaving them at their
 * defaults costs the scan nothing: folding is pushed into `alphabet`, word boundaries are
 * checked only where a match is reported, and leftmost selection is a separate scan.
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
  private readonly matchKind: MatchKind;
  private readonly preferLongest: boolean;
  private readonly wholeWords: boolean;
  private readonly wordBoundary: WordBoundary;
  /** How far past a candidate's start any match at that start could still end. */
  private readonly maxPatternLength: number;
  /** Path length per state, the tighter bound on where a future match can begin. */
  private readonly depth: Uint32Array;
  /**
   * Per id: the longest pattern that outranks it under leftmost-first, so a candidate can be
   * settled as soon as no better-ranked pattern still fits. Only that kind precomputes it;
   * without it the global longest pattern stands in, which settles later but never wrongly.
   */
  private readonly maxLengthAbove: Uint32Array | undefined;

  constructor(patterns: Iterable<string>, options: Options = {}) {
    const budgetBytes = options.maxDenseBytes ?? DEFAULT_DENSE_BUDGET_BYTES;
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0) throw new RangeError('maxDenseBytes must be a non-negative safe integer');
    const matchKind = options.matchKind ?? 'all';
    if (matchKind !== 'all' && matchKind !== 'leftmost-first' && matchKind !== 'leftmost-longest') throw new RangeError('matchKind must be all, leftmost-first or leftmost-longest');
    const wordBoundary = options.wordBoundary ?? 'unicode';
    if (wordBoundary !== 'unicode' && wordBoundary !== 'ascii') throw new RangeError('wordBoundary must be unicode or ascii');
    const caseInsensitive = options.caseInsensitive === true;
    const dictionary = Array.from(patterns);
    this.patterns = Object.freeze(dictionary);

    const fold = caseInsensitive ? caseFoldTable() : undefined;
    const trie = buildTrie(dictionary, fold);
    let prefilterCodes: readonly number[] = trie.rootCodes;
    if (fold) {
      // Text may spell a pattern in any case, so every code unit folding onto a pattern
      // character must reach that character's column, and must pass the prefilter.
      const isRoot = new Uint8Array(CODE_UNIT_COUNT);
      for (const code of trie.rootCodes) isRoot[code] = 1;
      const expanded: number[] = [];
      for (let code = 0; code < CODE_UNIT_COUNT; code++) {
        const folded = fold[code]!;
        if (folded !== code && trie.alphabet[folded] !== 0) trie.alphabet[code] = trie.alphabet[folded]!;
        if (isRoot[folded] === 1) expanded.push(code);
      }
      prefilterCodes = expanded;
    }
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
    // Folded matching has no indexOf equivalent, so that shortcut is only for literal search.
    this.scanWithIndexOf = !caseInsensitive && dictionary.length <= INDEXOF_MAX_PATTERNS && dictionary.every(pattern => pattern.length <= INDEXOF_MAX_PATTERN_LENGTH);
    this.prefilter = buildPrefilter(prefilterCodes);
    this.preallocateResults = failures.outputCount.some(count => count >= PREALLOCATE_MIN_OUTPUTS);
    this.matchKind = matchKind;
    this.preferLongest = matchKind === 'leftmost-longest';
    this.wholeWords = options.wholeWords === true;
    this.wordBoundary = wordBoundary;
    this.maxPatternLength = dictionary.reduce((longest, pattern) => Math.max(longest, pattern.length), 0);
    this.depth = failures.depth;
    if (matchKind === 'leftmost-first') {
      const maxLengthAbove = new Uint32Array(dictionary.length);
      for (let id = 1; id < dictionary.length; id++) {
        maxLengthAbove[id] = Math.max(maxLengthAbove[id - 1]!, dictionary[id - 1]!.length);
      }
      this.maxLengthAbove = maxLengthAbove;
    }
    this.stats = Object.freeze({
      states: trie.edges.length,
      alphabetSize: trie.symbolCount,
      backend: table ? 'dense' : 'sparse',
      transitionBytes: table?.byteLength ?? 0,
      outputBytes: (outputIndex?.runs.byteLength ?? 0) + (outputIndex?.runStart.byteLength ?? 0),
    });
  }

  /** Counts reported matches without allocating results. */
  count(text: string): number {
    // Selecting matches or rejecting them at word boundaries invalidates the per-state totals.
    if (this.matchKind !== 'all' || this.wholeWords) {
      let selected = 0;
      this.forEach(text, () => { selected++; });
      return selected;
    }
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
        const column = alphabet[text.charCodeAt(i)]!;
        let next = edges[state]!.get(column);
        while (next === undefined && state !== 0) {
          state = failure[state]!;
          next = edges[state]!.get(column);
        }
        state = next ?? 0;
        total += outputCount[state]!;
      }
    }
    return total;
  }

  /** Stops at the first match without allocating results. */
  test(text: string): boolean {
    // Which matches are selected cannot change whether one exists, but rejecting them can.
    if (this.wholeWords) {
      let found = false;
      this.forEach(text, () => { found = true; return false; });
      return found;
    }
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
        const column = alphabet[text.charCodeAt(i)]!;
        let next = edges[state]!.get(column);
        while (next === undefined && state !== 0) {
          state = failure[state]!;
          next = edges[state]!.get(column);
        }
        state = next ?? 0;
        if (outputCount[state] !== 0) return true;
      }
    }
    return false;
  }

  /**
   * With `matchKind: 'all'`, end-position order, then longest pattern first, then input order
   * for duplicates. With a leftmost kind, start-position order.
   */
  findAll(text: string): Match[] {
    const { table, alphabet, rowWidth, outputCount, outputRuns, patterns } = this;
    // Only the dense automaton with a flattened output index is worth its own loop here;
    // every other configuration collects the callbacks forEach already emits in order.
    if (!table || !outputRuns || this.scanWithIndexOf || this.matchKind !== 'all' || this.wholeWords) {
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

  /** Visits the reported matches in order; callback returning false stops the scan. */
  forEach(text: string, callback: MatchCallback): void {
    if (this.matchKind !== 'all') return this.forEachLeftmost(text, callback, this.preferLongest);
    if (this.wholeWords) {
      return this.forEachOverlapping(text, (patternIndex, start, end) =>
        this.atWordBoundary(text, start, end) ? callback(patternIndex, start, end) : undefined);
    }
    return this.forEachOverlapping(text, callback);
  }

  /**
   * Replaces the non-overlapping matches. `matchKind: 'all'` has no non-overlapping reading
   * of its results, so replacement selects leftmost-longest there.
   */
  replace(text: string, replacement: Replacement): string {
    const byIndex = Array.isArray(replacement) ? (replacement as readonly string[]) : undefined;
    if (byIndex) {
      if (byIndex.length !== this.patterns.length) throw new RangeError('A replacement array needs one entry per pattern');
    } else if (typeof replacement !== 'string' && typeof replacement !== 'function') {
      throw new TypeError('Replacement must be a string, an array of strings or a function');
    }
    const parts: string[] = [];
    let copied = 0;
    const emit: MatchCallback = (patternIndex, start, end) => {
      if (start > copied) parts.push(text.slice(copied, start));
      parts.push(byIndex ? byIndex[patternIndex]!
        : typeof replacement === 'function' ? replacement(patternIndex, start, end)
        : (replacement as string));
      copied = end;
    };
    if (this.matchKind === 'all') this.forEachLeftmost(text, emit, true);
    else this.forEach(text, emit);
    if (copied < text.length) parts.push(text.slice(copied));
    return parts.join('');
  }

  /**
   * Visits all overlapping matches.
   *
   * The loops below are the product of the two transition backends and the two output
   * representations. Each is written out rather than composed, so that neither choice costs
   * a branch or an indirect call per character.
   */
  private forEachOverlapping(text: string, callback: MatchCallback): void {
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
        const column = alphabet[text.charCodeAt(i)]!;
        let next = edges[state]!.get(column);
        while (next === undefined && state !== 0) {
          state = failure[state]!;
          next = edges[state]!.get(column);
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
      const column = alphabet[text.charCodeAt(i)]!;
      let next = edges[state]!.get(column);
      while (next === undefined && state !== 0) {
        state = failure[state]!;
        next = edges[state]!.get(column);
      }
      state = next ?? 0;
      if (outputCount[state] === 0) continue;
      if (!this.reportLinkedOutputs(state, i + 1, callback)) return;
    }
  }

  /**
   * Emits non-overlapping matches by repeatedly taking the leftmost one and resuming at its
   * end. Resuming with a fresh state is what makes the selection safe: it drops exactly the
   * matches that overlap what was emitted, and rediscovers every match that merely followed.
   */
  private forEachLeftmost(text: string, callback: MatchCallback, preferLongest: boolean): void {
    if (this.maxPatternLength === 0) return;
    let from = this.scanStart(text);
    if (from < 0) return;
    while (from < text.length) {
      from = this.emitLeftmost(text, from, callback, preferLongest);
      if (from < 0) return;
    }
  }

  /**
   * Emits the leftmost match starting at or after `from` and returns its end, or -1 when
   * there is none and when the callback stopped the scan.
   *
   * Settling a candidate needs a lower bound on where the matches still to come can begin.
   * Two bounds apply: an undiscovered match ends past `i + 1` and is no longer than the
   * longest pattern, and it cannot be longer than the current path plus what is left to read.
   * Once that bound passes the candidate's start, nothing can outrank it; once it merely
   * reaches that start, only a better-ranked pattern that still fits could, which is why
   * leftmost-first settles a first-ranked pattern immediately instead of reading ahead.
   */
  private emitLeftmost(text: string, from: number, callback: MatchCallback, preferLongest: boolean): number {
    const { table, alphabet, rowWidth, outputCount, outputRuns, outputRunStart, outputs, outputLink, patterns, wholeWords, maxPatternLength, depth, maxLengthAbove } = this;
    const edges = this.edges;
    const failure = this.failure;
    let state = 0;
    let bestId = -1;
    let bestStart = 0;
    let bestEnd = 0;
    for (let i = from; i < text.length; i++) {
      const column = alphabet[text.charCodeAt(i)]!;
      if (table) {
        state = table[state * rowWidth + column]!;
      } else {
        let next = edges![state]!.get(column);
        while (next === undefined && state !== 0) {
          state = failure[state]!;
          next = edges![state]!.get(column);
        }
        state = next ?? 0;
      }
      const reported = outputCount[state]!;
      if (reported !== 0) {
        const end = i + 1;
        if (outputRuns) {
          const runFrom = outputRunStart![state]!;
          for (let k = runFrom, stop = runFrom + reported; k < stop; k++) {
            const id = outputRuns[k]!;
            const start = end - patterns[id]!.length;
            if (wholeWords && !this.atWordBoundary(text, start, end)) continue;
            if (bestId < 0 || start < bestStart || (start === bestStart && (preferLongest ? end > bestEnd : id < bestId))) {
              bestId = id;
              bestStart = start;
              bestEnd = end;
            }
          }
        } else {
          for (let output = state; output !== 0; output = outputLink[output]!) {
            const ids = outputs[output]!;
            for (let j = 0; j < ids.length; j++) {
              const id = ids[j]!;
              const start = end - patterns[id]!.length;
              if (wholeWords && !this.atWordBoundary(text, start, end)) continue;
              if (bestId < 0 || start < bestStart || (start === bestStart && (preferLongest ? end > bestEnd : id < bestId))) {
                bestId = id;
                bestStart = start;
                bestEnd = end;
              }
            }
          }
        }
      }
      if (bestId >= 0) {
        const byPath = i + 1 - depth[state]!;
        const byLength = i + 2 - maxPatternLength;
        const earliest = byPath > byLength ? byPath : byLength;
        if (earliest > bestStart) break;
        const outranking = preferLongest || maxLengthAbove === undefined ? maxPatternLength : maxLengthAbove[bestId]!;
        if (earliest === bestStart && i + 2 - bestStart > outranking) break;
      }
    }
    if (bestId < 0) return -1;
    if (callback(bestId, bestStart, bestEnd) === false) return -1;
    return bestEnd;
  }

  /** True when neither neighbour of [start, end) is a word character. */
  private atWordBoundary(text: string, start: number, end: number): boolean {
    if (start > 0) {
      let code = text.charCodeAt(start - 1);
      // A trailing low surrogate belongs to the code point that starts one unit earlier.
      if (code >= 0xdc00 && code <= 0xdfff && start >= 2) {
        const high = text.charCodeAt(start - 2);
        if (high >= 0xd800 && high <= 0xdbff) code = (high - 0xd800) * 0x400 + code - 0xdc00 + 0x10000;
      }
      if (this.isWordCodePoint(code)) return false;
    }
    if (end < text.length) {
      let code = text.charCodeAt(end);
      if (code >= 0xd800 && code <= 0xdbff && end + 1 < text.length) {
        const low = text.charCodeAt(end + 1);
        if (low >= 0xdc00 && low <= 0xdfff) code = (code - 0xd800) * 0x400 + low - 0xdc00 + 0x10000;
      }
      if (this.isWordCodePoint(code)) return false;
    }
    return true;
  }

  /** ASCII is a table lookup; the rest costs a regular expression, but only at a boundary. */
  private isWordCodePoint(codePoint: number): boolean {
    if (codePoint < 0x80) return ASCII_WORD[codePoint] === 1;
    return this.wordBoundary === 'unicode' && UNICODE_WORD.test(String.fromCodePoint(codePoint));
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
