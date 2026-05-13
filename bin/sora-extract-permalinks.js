#!/usr/bin/env node
/**
 * sora-extract-permalinks
 *
 * CLI wrapper for the extract-permalinks step. Reads SoraVault manifest JSON
 * files and writes one *.links.txt per manifest containing every post URL.
 *
 * Usage:
 *   node bin/sora-extract-permalinks.js [--input <dir>] [--output <dir>]
 *   node bin/sora-extract-permalinks.js --files <a.json> <b.json> ...
 *
 * Defaults (when run from a configured archive):
 *   --input  = <archive>/_refresh/manifests
 *   --output = <archive>/_refresh/links
 */

import fs from 'fs';
import path from 'path';
import { extractFromManifest, extractFromDir } from '../src/lib/server/refresh/extract-permalinks.js';
import { ensureRefreshDirs, refreshPaths } from '../src/lib/server/refresh/paths.js';
import { getConfig } from '../src/lib/config.js';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function multiArg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return [];
  const out = [];
  for (let j = i + 1; j < process.argv.length; j++) {
    if (process.argv[j].startsWith('--')) break;
    out.push(process.argv[j]);
  }
  return out;
}

function defaultDirs() {
  const config = getConfig();
  if (!config) return null;
  ensureRefreshDirs(config.archivePath);
  return refreshPaths(config.archivePath);
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage:
  node bin/sora-extract-permalinks.js [--input <dir>] [--output <dir>]
  node bin/sora-extract-permalinks.js --files <a.json> <b.json> ...

Default input/output paths come from the configured archive
(<archive>/_refresh/{manifests,links}).`);
    process.exit(0);
  }

  const explicitFiles = multiArg('--files');
  let inputDir = arg('--input');
  let outputDir = arg('--output');

  if (!inputDir || !outputDir) {
    const dirs = defaultDirs();
    if (!dirs) {
      console.error('Setup is not complete and no --input/--output was provided.');
      process.exit(1);
    }
    inputDir  = inputDir  || dirs.manifests;
    outputDir = outputDir || dirs.links;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  let totalLinks = 0;
  let okFiles = 0;
  let draftFiles = 0;
  const errors = [];

  if (explicitFiles.length > 0) {
    for (const file of explicitFiles) {
      const r = extractFromManifest(file, outputDir);
      if (r.ok) {
        okFiles++;
        totalLinks += r.links;
        if (r.isDraft) draftFiles++;
        const tag = r.isDraft ? ' [drafts]' : '';
        const out = r.links ? path.basename(r.outputFile) : 'no output';
        console.log(`OK  ${path.basename(file)}${tag}  ->  ${out}  (${r.links} links)`);
      } else {
        errors.push({ file, error: r.error });
        console.warn(`WARN: ${file}: ${r.error}`);
      }
    }
  } else {
    const totals = extractFromDir(inputDir, outputDir, (r) => {
      const tag = r.isDraft ? ' [drafts]' : '';
      if (!r.ok) {
        console.warn(`WARN: ${r.basename}: ${r.error}`);
      } else {
        const out = r.links ? path.basename(r.outputFile) : 'no output';
        console.log(`OK  ${r.basename}${tag}  ->  ${out}  (${r.links} links)`);
      }
    });
    totalLinks = totals.totalLinks;
    okFiles    = totals.okFiles;
    draftFiles = totals.draftFiles;
    errors.push(...totals.errors);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Files OK : ${okFiles}`);
  console.log(`Drafts   : ${draftFiles}`);
  console.log(`Failed   : ${errors.length}`);
  console.log(`Links    : ${totalLinks} total`);
}

main();
