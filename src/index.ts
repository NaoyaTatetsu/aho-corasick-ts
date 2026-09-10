/** Flattened output index cap: 4Mi entries (16 MiB), above which the suffix-link walk is kept. */
const MAX_OUTPUT_ENTRIES = 4 * 1024 * 1024;

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

/** Immutable, case-sensitive multi-pattern matcher. Duplicate patterns retain their IDs. */
export class AhoCorasick {
  readonly patterns: readonly string[];
  readonly stats: Readonly<{ states: number; alphabetSize: number; backend: 'dense' | 'sparse'; transitionBytes: number; outputBytes: number }>;
  private readonly alphabet: Uint32Array;
  private readonly width: number;
  private readonly table: Uint16Array | Uint32Array | undefined;
  private readonly edges: Map<number, number>[] | undefined;
  private readonly failure: Uint32Array;
  private readonly outputLink: Uint32Array;
  private readonly outputs: number[][];
  private readonly counts: Uint32Array;
  private readonly flatOutputs: Uint32Array | undefined;
  private readonly flatStart: Uint32Array | undefined;
  private readonly smallDictionary: boolean;
  private readonly startFilter: RegExp | undefined;
  private readonly manyOutputs: boolean;

  constructor(patterns: Iterable<string>, options: Options = {}) {
    const budget = options.maxDenseBytes ?? 64 * 1024 * 1024;
    if (!Number.isSafeInteger(budget) || budget < 0) throw new RangeError('maxDenseBytes must be a non-negative safe integer');
    const dictionary = Array.from(patterns);
    this.patterns = Object.freeze(dictionary);
    const alphabet = new Uint32Array(65536);
    const edges: Map<number, number>[] = [new Map()];
    const outputs: number[][] = [[]];
    let symbols = 0;
    for (let id = 0; id < dictionary.length; id++) {
      const pattern = dictionary[id]!;
      if (typeof pattern !== 'string') throw new TypeError('Patterns must be strings');
      if (pattern.length === 0) throw new RangeError('Empty patterns are not supported');
      let state = 0;
      for (let i = 0; i < pattern.length; i++) {
        const code = pattern.charCodeAt(i);
        if (alphabet[code] === 0) alphabet[code] = ++symbols;
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
    const size = edges.length;
    const failure = new Uint32Array(size);
    const links = new Uint32Array(size);
    const counts = new Uint32Array(size);
    const queue = new Uint32Array(size);
    let head = 0;
    let tail = 0;
    for (const child of edges[0]!.values()) queue[tail++] = child;
    while (head < tail) {
      const state = queue[head++]!;
      const fallback = failure[state]!;
      counts[state] = outputs[state]!.length + counts[fallback]!;
      links[state] = outputs[fallback]!.length ? fallback : links[fallback]!;
      for (const [code, child] of edges[state]!) {
        let f = fallback;
        while (f !== 0 && !edges[f]!.has(code)) f = failure[f]!;
        failure[child] = edges[f]!.get(code) ?? 0;
        queue[tail++] = child;
      }
    }
    // Flattening the suffix-link output chains into one contiguous run per state turns the
    // per-match walk into a single tight loop over one TypedArray, with no per-state output
    // array to dereference. Inherited outputs are copied, so the total is bounded first.
    let entries = 0;
    for (let state = 0; state < size; state++) entries += counts[state]!;
    let flatOutputs: Uint32Array | undefined;
    let flatStart: Uint32Array | undefined;
    if (entries <= MAX_OUTPUT_ENTRIES) {
      flatOutputs = new Uint32Array(entries);
      flatStart = new Uint32Array(size);
      let cursor = 0;
      // BFS order: every suffix link is shallower, so its run is already written.
      // counts[state] is the run length, so only the start offset needs storing.
      for (let i = 0; i < tail; i++) {
        const state = queue[i]!;
        const total = counts[state]!;
        if (total === 0) continue;
        const own = outputs[state]!;
        flatStart[state] = cursor;
        for (let j = 0; j < own.length; j++) flatOutputs[cursor++] = own[j]!;
        const link = links[state]!;
        if (link !== 0) {
          const from = flatStart[link]!;
          flatOutputs.set(flatOutputs.subarray(from, from + counts[link]!), cursor);
          cursor += counts[link]!;
        }
      }
    }
    const width = symbols + 1;
    // Small automata halve transition memory and fit more rows in CPU caches.
    const Table = size <= 65536 ? Uint16Array : Uint32Array;
    const bytes = size * width * Table.BYTES_PER_ELEMENT;
    let table: Uint16Array | Uint32Array | undefined;
    if (bytes <= budget && size * width <= 0xffffffff) {
      table = new Table(size * width);
      for (const [code, child] of edges[0]!) table[alphabet[code]!] = child;
      for (let i = 0; i < tail; i++) {
        const state = queue[i]!;
        const row = state * width;
        const fallback = failure[state]! * width;
        table.set(table.subarray(fallback, fallback + width), row);
        for (const [code, child] of edges[state]!) table[row + alphabet[code]!] = child;
      }
    }
    // Bound both dictionary size and pattern length for the indexOf strategy.
    this.smallDictionary = dictionary.length <= 4 && dictionary.every(p => p.length <= 64);
    const roots = [...edges[0]!.keys()];
    // Escaped UTF-16 code units: no metacharacters, Unicode normalization or stateful flags.
    this.startFilter = roots.length > 0 && roots.length <= 32
      ? new RegExp('[' + roots.map(code => '\\u' + code.toString(16).padStart(4, '0')).join('') + ']')
      : undefined;
    this.manyOutputs = counts.some(count => count >= 8);
    this.alphabet = alphabet;
    this.width = width;
    this.table = table;
    this.edges = table ? undefined : edges;
    this.failure = failure;
    this.outputLink = links;
    this.outputs = outputs;
    this.counts = counts;
    this.flatOutputs = flatOutputs;
    this.flatStart = flatStart;
    this.stats = Object.freeze({ states: size, alphabetSize: symbols, backend: table ? 'dense' : 'sparse', transitionBytes: table?.byteLength ?? 0, outputBytes: (flatOutputs?.byteLength ?? 0) + (flatStart?.byteLength ?? 0) });
  }

  /** Counts all overlapping matches without allocating results: O(text.length). */
  count(text: string): number {
    if (this.smallDictionary) {
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
    const { table, alphabet, width, counts } = this;
    let state = 0;
    let total = 0;
    if (table) {
      for (let i = begin; i < text.length; i++) {
        state = table[state * width + alphabet[text.charCodeAt(i)]!]!;
        total += counts[state]!;
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
        total += counts[state]!;
      }
    }
    return total;
  }

  /** Stops at the first match without allocating results. */
  test(text: string): boolean {
    if (this.smallDictionary) {
      for (const pattern of this.patterns) if (text.indexOf(pattern) !== -1) return true;
      return false;
    }
    const begin = this.scanStart(text);
    if (begin < 0) return false;
    const { table, alphabet, width, counts } = this;
    let state = 0;
    if (table) {
      for (let i = begin; i < text.length; i++) {
        state = table[state * width + alphabet[text.charCodeAt(i)]!]!;
        if (counts[state] !== 0) return true;
      }
    } else {
      const edges = this.edges!;
      for (let i = begin; i < text.length; i++) {
        const code = text.charCodeAt(i);
        let next = edges[state]!.get(code);
        while (next === undefined && state !== 0) {
          state = this.failure[state]!;
          next = edges[state]!.get(code);
        }
        state = next ?? 0;
        if (counts[state] !== 0) return true;
      }
    }
    return false;
  }

  /** End-position order, then longest pattern first, then input order for duplicates. */
  findAll(text: string): Match[] {
    const { table, alphabet, width, outputs, outputLink, patterns } = this;
    if (!table || this.smallDictionary) {
      const matches: Match[] = [];
      this.forEach(text, (patternIndex, start, end) => { matches.push({ patternIndex, start, end }); });
      return matches;
    }
    const begin = this.scanStart(text);
    if (begin < 0) return [];
    // For output-heavy automatons an extra count pass avoids growing/copying the result array.
    const matches: Match[] = this.manyOutputs ? new Array<Match>(this.count(text)) : [];
    let written = 0;
    let state = 0;
    const flat = this.flatOutputs;
    if (flat) {
      const flatStart = this.flatStart!;
      const counts = this.counts;
      for (let i = begin; i < text.length; i++) {
        state = table[state * width + alphabet[text.charCodeAt(i)]!]!;
        const total = counts[state]!;
        if (total === 0) continue;
        const end = i + 1;
        const from = flatStart[state]!;
        for (let k = from, stop = from + total; k < stop; k++) {
          const patternIndex = flat[k]!;
          matches[written++] = { patternIndex, start: end - patterns[patternIndex]!.length, end };
        }
      }
      return matches;
    }
    for (let i = begin; i < text.length; i++) {
      state = table[state * width + alphabet[text.charCodeAt(i)]!]!;
      if (this.counts[state] === 0) continue;
      for (let output = state; output !== 0; output = outputLink[output]!) {
        const ids = outputs[output]!;
        for (let j = 0; j < ids.length; j++) {
          const patternIndex = ids[j]!;
          matches[written++] = { patternIndex, start: i + 1 - patterns[patternIndex]!.length, end: i + 1 };
        }
      }
    }
    return matches;
  }

  /** Skip only the initial impossible prefix; offsets remain relative to the original text. */
  private scanStart(text: string): number {
    return text.length >= 256 && this.startFilter ? text.search(this.startFilter) : 0;
  }

  /** Merge at most four indexOf streams in the same order as the automaton. */
  private forEachSmall(text: string, callback: MatchCallback): void {
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

  /** Visits all overlapping matches; callback returning false stops the scan. */
  forEach(text: string, callback: MatchCallback): void {
    if (this.smallDictionary) return this.forEachSmall(text, callback);
    const begin = this.scanStart(text);
    if (begin < 0) return;
    const { table, alphabet, width, outputs, outputLink, patterns } = this;
    let state = 0;
    const flat = this.flatOutputs;
    // Keep the backend branch outside the dense scan's hot loop.
    if (table && flat) {
      const flatStart = this.flatStart!;
      const counts = this.counts;
      for (let i = begin; i < text.length; i++) {
        state = table[state * width + alphabet[text.charCodeAt(i)]!]!;
        const total = counts[state]!;
        if (total === 0) continue;
        const end = i + 1;
        const from = flatStart[state]!;
        for (let k = from, stop = from + total; k < stop; k++) {
          const id = flat[k]!;
          if (callback(id, end - patterns[id]!.length, end) === false) return;
        }
      }
      return;
    }
    if (table) {
      for (let i = begin; i < text.length; i++) {
        state = table[state * width + alphabet[text.charCodeAt(i)]!]!;
        if (this.counts[state] === 0) continue;
        for (let output = state; output !== 0; output = outputLink[output]!) {
          const ids = outputs[output]!;
          for (let j = 0; j < ids.length; j++) {
            const id = ids[j]!;
            if (callback(id, i + 1 - patterns[id]!.length, i + 1) === false) return;
          }
        }
      }
      return;
    }
    const edges = this.edges!;
    const failure = this.failure;
    if (flat) {
      const flatStart = this.flatStart!;
      const counts = this.counts;
      for (let i = begin; i < text.length; i++) {
        const code = text.charCodeAt(i);
        let next = edges[state]!.get(code);
        while (next === undefined && state !== 0) {
          state = failure[state]!;
          next = edges[state]!.get(code);
        }
        state = next ?? 0;
        const total = counts[state]!;
        if (total === 0) continue;
        const end = i + 1;
        const from = flatStart[state]!;
        for (let k = from, stop = from + total; k < stop; k++) {
          const id = flat[k]!;
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
      for (let output = state; output !== 0; output = outputLink[output]!) {
        const ids = outputs[output]!;
        for (let j = 0; j < ids.length; j++) {
          const id = ids[j]!;
          if (callback(id, i + 1 - patterns[id]!.length, i + 1) === false) return;
        }
      }
    }
  }
}

export default AhoCorasick;
