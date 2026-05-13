#!/usr/bin/env node
/**
 * sora-extract-html
 *
 * CLI wrapper for the HTML -> JSON extract step. For each *.html in the input
 * directory, parses the embedded RSC payload and writes a matching
 * <basename>.extracted.json with the full Sora post/comment/profile data.
 *
 * Replace policy mirrors fetch-html: extracted.json files newer than
 * --max-age days are skipped; older files are re-extracted with the original
 * archived only on success. Failures (no RSC payload, no posts, parse error)
 * leave the original untouched.
 *
 * Usage:
 *   node bin/sora-extract-html.js [--input <dir>] [--output <dir>] [--archive <dir>]
 *                                 [--max-age <days>]
 *
 * Defaults (when run from a configured archive):
 *   --input   = <archive>/_refresh/html
 *   --output  = <archive>/_refresh/extracted
 *   --archive = <archive>/_refresh/archive
 *   --max-age = 7
 */

import path from 'path';
import { extractHtmlBatch } from '../src/lib/server/refresh/extract-html.js';
import { ensureRefreshDirs, refreshPaths } from '../src/lib/server/refresh/paths.js';
import { getConfig } from '../src/lib/config.js';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage:
  node bin/sora-extract-html.js [--input <dir>] [--output <dir>] [--archive <dir>]
                                [--max-age <days>]

Defaults come from the configured archive (<archive>/_refresh/{html,extracted,archive}).
--max-age <days>  Files newer than this are skipped (default 7).`);
    process.exit(0);
  }

  let htmlDir    = arg('--input');
  let outputDir  = arg('--output');
  let archiveDir = arg('--archive');
  const maxAgeDays = Number(arg('--max-age', '7')) || 7;

  if (!htmlDir || !outputDir || !archiveDir) {
    const config = getConfig();
    if (!config) {
      console.error('Setup is not complete and no --input/--output/--archive was provided.');
      process.exit(1);
    }
    ensureRefreshDirs(config.archivePath);
    const paths = refreshPaths(config.archivePath);
    htmlDir    = htmlDir    || paths.html;
    outputDir  = outputDir  || paths.extracted;
    archiveDir = archiveDir || paths.archive;
  }

  console.log(`Input    : ${htmlDir}`);
  console.log(`Output   : ${outputDir}`);
  console.log(`Archive  : ${archiveDir}`);
  console.log(`Max age  : ${maxAgeDays} days`);
  console.log();

  const stats = extractHtmlBatch({
    htmlDir,
    outputDir,
    archiveDir,
    maxAgeMs: maxAgeDays * 24 * 60 * 60 * 1000,
    callbacks: {
      onProgress: ({ index, total, file, decision, status, posts, videos, comments, error }) => {
        const pos = `[${index + 1}/${total}]`;
        const slug = path.basename(file, '.html');
        if (status === 'ok') {
          const tag = decision === 'extract-refresh' ? 'refresh' : 'new';
          console.log(`${pos} ${tag.padEnd(7)} ${slug}  (${posts}p / ${videos}v / ${comments}c)`);
        } else if (status === 'skipped') {
          // Suppress per-skip noise; let the summary report the count.
        } else if (status === 'failed') {
          const kept = decision === 'extract-refresh' ? ' (kept original)' : '';
          console.log(`${pos} fail    ${slug}: ${error}${kept}`);
        }
      },
    },
  });

  console.log(`\n--- Summary ---`);
  console.log(`HTML files       : ${stats.total}`);
  console.log(`Extracted (new)  : ${stats.extractedNew}`);
  console.log(`Refreshed        : ${stats.refreshed}`);
  console.log(`Skipped (fresh)  : ${stats.skippedFresh}`);
  console.log(`Failed           : ${stats.failed} (originals kept: ${stats.keptOriginal})`);
  console.log(`Archived         : ${stats.archived}`);
  console.log(`Total posts      : ${stats.totalPosts}`);
  console.log(`Total videos     : ${stats.totalVideos}`);
  console.log(`Total comments   : ${stats.totalComments}`);
  if (stats.errors.length > 0 && stats.errors.length <= 10) {
    console.log(`\nErrors:`);
    for (const e of stats.errors) console.log(`  ${e.file}: ${e.error}`);
  }
}

main();
