#!/usr/bin/env node
// Marks dist/cjs as CommonJS. Without it Node reads the package's own "type": "module"
// and refuses the .js files inside as ES modules.
import { writeFileSync } from 'node:fs';

writeFileSync(new URL('../../dist/cjs/package.json', import.meta.url), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
console.log('marked dist/cjs as commonjs');
