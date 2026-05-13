#!/usr/bin/env node
/**
 * sora-dedupe-links
 *
 * CLI wrapper for the dedupe + /p/ filter step. Combines what was previously
 * `node 2_dedupe-urls.js` plus `grep /p/ *.txt > clean-links.txt` into a
 * single command.
 *
 * Usage:
 *   node bin/sora-dedupe-links.js [--input <dir>] [--output <file>]
 *
 * Defaults (when run from a configured archive):
 *   --input  = <archive>/_refresh/links
 *   --output = <archive>/_refresh/links/clean-links.txt
 */

import path from 'path';
import { dedupeAndFilter } from '../src/lib/server/refresh/dedupe-filter.js';
import { ensureRefreshDirs, refreshPaths } from '../src/lib/server/refresh/paths.js';
import { getConfig } from '../src/lib/config.js';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage:
  node bin/sora-dedupe-links.js [--input <dir>] [--output <file>]

Reads every *.links.txt in --input, dedupes URLs across all of them, drops
non-/p/ links (which fetch-html cannot handle anyway), and writes the result
to --output.

Default input/output come from the configured archive
(<archive>/_refresh/links/{*.links.txt,clean-links.txt}).`);
    process.exit(0);
  }

  let inputDir = arg('--input');
  let outputFile = arg('--output');

  if (!inputDir || !outputFile) {
    const config = getConfig();
    if (!config) {
      console.error('Setup is not complete and no --input/--output was provided.');
      process.exit(1);
    }
    ensureRefreshDirs(config.archivePath);
    const paths = refreshPaths(config.archivePath);
    inputDir   = inputDir   || paths.links;
    outputFile = outputFile || path.join(paths.links, 'clean-links.txt');
  }

  const stats = dedupeAndFilter(inputDir, outputFile);
  for (const e of stats.errors) console.warn(`WARN: ${e}`);
  console.log(`Source files     : ${stats.sourceFiles}`);
  console.log(`Total lines read : ${stats.totalLines}`);
  console.log(`Blank/comment    : ${stats.blankOrComment}`);
  console.log(`Non-/p/ filtered : ${stats.nonPost}`);
  console.log(`Duplicates       : ${stats.duplicates}`);
  console.log(`Kept (unique /p/): ${stats.kept}`);
  if (stats.kept > 0) console.log(`Output           : ${outputFile}`);
}

main();
