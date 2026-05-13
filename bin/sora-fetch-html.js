#!/usr/bin/env node
/**
 * sora-fetch-html
 *
 * CLI wrapper for the fetch step. Loads URLs from clean-links.txt and saves
 * the SSR HTML for each into _refresh/html/<slug>.html using Playwright with
 * JavaScript disabled (the only known way to bypass the sunset redirect).
 *
 * Replace policy: files newer than --max-age days are skipped; older files
 * are re-fetched and the original is moved to _refresh/archive/<date>/ on
 * success. On 403 / sunset / no-RSC the original is kept untouched.
 *
 * Usage:
 *   node bin/sora-fetch-html.js [--input <file>] [--output <dir>] [--archive <dir>]
 *                               [--max-age <days>] [--delay <ms>]
 *
 * Defaults (when run from a configured archive):
 *   --input   = <archive>/_refresh/links/clean-links.txt
 *   --output  = <archive>/_refresh/html
 *   --archive = <archive>/_refresh/archive
 *   --max-age = 7
 *   --delay   = 1500
 */

import path from 'path';
import { fetchHtmlBatch } from '../src/lib/server/refresh/fetch-html.js';
import { checkPlaywright } from '../src/lib/server/refresh/playwright-check.js';
import { ensureRefreshDirs, refreshPaths } from '../src/lib/server/refresh/paths.js';
import { getConfig } from '../src/lib/config.js';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage:
  node bin/sora-fetch-html.js [--input <file>] [--output <dir>] [--archive <dir>]
                              [--max-age <days>] [--delay <ms>]

Defaults come from the configured archive (<archive>/_refresh/{links,html,archive}).
--max-age <days>  Files newer than this are skipped (default 7).
--delay   <ms>    Delay between URLs (default 1500).`);
    process.exit(0);
  }

  // Verify Playwright before doing anything else so the user gets a clear error.
  const pw = await checkPlaywright({ probeBrowser: true });
  if (!pw.ok) {
    if (pw.reason === 'missing-package') {
      console.error('Playwright is not installed. Run:\n  npm install playwright\n  npx playwright install chromium');
    } else if (pw.reason === 'missing-browser') {
      console.error('Chromium binary missing. Run:\n  npx playwright install chromium');
    } else {
      console.error(`Playwright failed: ${pw.error || 'unknown error'}`);
    }
    process.exit(2);
  }

  let linksFile  = arg('--input');
  let htmlDir    = arg('--output');
  let archiveDir = arg('--archive');
  const maxAgeDays = Number(arg('--max-age', '7')) || 7;
  const delayMs    = Number(arg('--delay', '1500')) || 1500;

  if (!linksFile || !htmlDir || !archiveDir) {
    const config = getConfig();
    if (!config) {
      console.error('Setup is not complete and no --input/--output/--archive was provided.');
      process.exit(1);
    }
    ensureRefreshDirs(config.archivePath);
    const paths = refreshPaths(config.archivePath);
    linksFile  = linksFile  || path.join(paths.links, 'clean-links.txt');
    htmlDir    = htmlDir    || paths.html;
    archiveDir = archiveDir || paths.archive;
  }

  console.log(`Input    : ${linksFile}`);
  console.log(`Output   : ${htmlDir}`);
  console.log(`Archive  : ${archiveDir}`);
  console.log(`Max age  : ${maxAgeDays} days`);
  console.log(`Delay    : ${delayMs} ms`);
  console.log();

  const stats = await fetchHtmlBatch({
    linksFile,
    htmlDir,
    archiveDir,
    maxAgeMs: maxAgeDays * 24 * 60 * 60 * 1000,
    delayMs,
    callbacks: {
      onProgress: ({ index, total, url, decision, status, httpStatus, sunset, error, size, filename }) => {
        const pos = `[${index + 1}/${total}]`;
        if (status === 'ok') {
          const tag = decision === 'fetch-refresh' ? 'refresh' : 'new';
          console.log(`${pos} ${tag.padEnd(7)} ${filename}  (${(size/1024).toFixed(0)} KB)`);
        } else if (status === 'skipped') {
          console.log(`${pos} skip    ${url} (still fresh)`);
        } else if (status === 'failed') {
          const t = sunset ? 'sunset' : (httpStatus ? `HTTP ${httpStatus}` : 'no RSC');
          const kept = decision === 'fetch-refresh' ? ' (kept original)' : '';
          console.log(`${pos} fail    ${url} -- ${t}${kept}`);
        } else if (status === 'error') {
          console.log(`${pos} error   ${url} -- ${error}`);
        }
      },
    },
  });

  console.log(`\n--- Summary ---`);
  console.log(`Total URLs       : ${stats.total}`);
  console.log(`Fetched (new)    : ${stats.fetchedNew}`);
  console.log(`Refreshed        : ${stats.refreshed}`);
  console.log(`Skipped (fresh)  : ${stats.skippedFresh}`);
  console.log(`Failed           : ${stats.failed} (sunset: ${stats.sunset}, originals kept: ${stats.keptOriginal})`);
  console.log(`Archived         : ${stats.archived}`);
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
