#!/usr/bin/env node
// Turns the test runner's fixed-width coverage table into a markdown comment.
// Usage: node .github/scripts/coverage-comment.mjs coverage.txt > comment.md
import { readFileSync } from 'node:fs';

const MARKER = '<!-- coverage-report -->';

/** The reporter prefixes each line, with '#' when its output is piped and 'ℹ' on a terminal. */
function tableRows(raw) {
  const start = raw.indexOf('start of coverage report');
  const end = raw.indexOf('end of coverage report');
  if (start === -1 || end === -1) throw new Error('No coverage report found in the input');
  return raw
    .slice(start, end)
    .split('\n')
    .map(line => line.replace(/^[#ℹ]\s?/, '').trim())
    .filter(line => line.includes('|'))
    .map(line => line.split('|').map(cell => cell.trim()));
}

/**
 * Files are listed under a directory row whose own percentages are blank, so the directory
 * carries down to the rows beneath it. 'all files' closes the table.
 */
function parse(rows) {
  const files = [];
  let directory = '';
  let total;
  for (const [name, lines, branches, functions, uncovered] of rows.slice(1)) {
    if (name === 'all files') {
      total = { lines, branches, functions };
    } else if (!lines && !branches && !functions) {
      directory = name;
    } else {
      files.push({ path: directory ? `${directory}/${name}` : name, lines, branches, functions, uncovered });
    }
  }
  if (!total) throw new Error('The coverage report has no total row');
  return { files, total };
}

const percent = value => (value ? `${value}%` : '');

function render({ files, total }) {
  const header = ['| File | Lines | Branches | Functions | Uncovered lines |', '| --- | ---: | ---: | ---: | --- |'];
  const body = files.map(f => `| \`${f.path}\` | ${percent(f.lines)} | ${percent(f.branches)} | ${percent(f.functions)} | ${f.uncovered ? `\`${f.uncovered}\`` : '—'} |`);
  const footer = `| **All files** | **${percent(total.lines)}** | **${percent(total.branches)}** | **${percent(total.functions)}** | |`;
  return [
    MARKER,
    '### Coverage',
    '',
    `**${percent(total.lines)}** lines · **${percent(total.branches)}** branches · **${percent(total.functions)}** functions`,
    '',
    ...header,
    ...body,
    footer,
    '',
    '<details><summary>How this is measured</summary>',
    '',
    'Measured on Node 24 against `dist/index.js`, the build the tests import, so the line numbers are the',
    "compiled file's rather than `src/index.ts`'s. `pnpm coverage` reproduces this locally.",
    '</details>',
  ].join('\n');
}

process.stdout.write(`${render(parse(tableRows(readFileSync(process.argv[2] ?? 0, 'utf8'))))}\n`);
