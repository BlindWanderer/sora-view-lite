#!/usr/bin/env node
/**
 * sora-refresh-all
 *
 * CLI wrapper for the full refresh pipeline. Runs steps 1-5 sequentially in
 * one process, calling the same library functions the server panel button
 * calls. Empty stages auto-skip; Playwright must be ready before step 3 or
 * the run aborts with a clear hint.
 *
 * Usage:
 *   node bin/sora-refresh-all.js [--types <list>] [--max-age <days>] [--delay <ms>]
 *
 *   --types       Comma-separated subset of: avatars,thumbnails,gifs.
 *                 Default: avatars,thumbnails,gifs.
 *   --max-age     Age threshold in days for steps 3-4 (default 7).
 *   --delay       Per-URL delay for step 3 in ms (default 1500).
 */

import fs from 'fs';
import path from 'path';
import { getConfig } from '../src/lib/config.js';
import { ensureRefreshDirs, refreshPaths } from '../src/lib/server/refresh/paths.js';
import { extractFromDir }    from '../src/lib/server/refresh/extract-permalinks.js';
import { dedupeAndFilter }   from '../src/lib/server/refresh/dedupe-filter.js';
import { fetchHtmlBatch }    from '../src/lib/server/refresh/fetch-html.js';
import { extractHtmlBatch }  from '../src/lib/server/refresh/extract-html.js';
import { downloadAssetsBatch } from '../src/lib/server/refresh/download-assets.js';
import { checkPlaywright }   from '../src/lib/server/refresh/playwright-check.js';
import { writeLastRun }      from '../src/lib/server/refresh/last-run.js';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage:
  node bin/sora-refresh-all.js [--types <list>] [--max-age <days>] [--delay <ms>]

  --types <list>     avatars,thumbnails,gifs (default: all three)
  --max-age <days>   age threshold for steps 3-4 (default 7)
  --delay <ms>       per-URL delay for step 3 (default 1500)`);
    process.exit(0);
  }

  const config = getConfig();
  if (!config) { console.error('Setup is not complete.'); process.exit(1); }
  const paths = ensureRefreshDirs(config.archivePath);

  const typesRaw = arg('--types', 'avatars,thumbnails,gifs');
  const wanted = new Set(typesRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const types = {
    avatars:    wanted.has('avatars'),
    thumbnails: wanted.has('thumbnails'),
    gifs:       wanted.has('gifs'),
  };
  const maxAgeMs = (Number(arg('--max-age', '7')) || 7) * 24 * 60 * 60 * 1000;
  const delayMs  = Number(arg('--delay', '1500')) || 1500;

  const startedAt = Date.now();
  const steps = {};

  // ---- Step 1 ----
  const manifests = fs.existsSync(paths.manifests)
    ? fs.readdirSync(paths.manifests).filter((f) => f.toLowerCase().endsWith('.json')) : [];
  if (manifests.length === 0) {
    console.log('[1] No manifests in _refresh/manifests/, skipping.');
    steps['extract-permalinks'] = { ran: false, skipped: true };
  } else {
    console.log(`[1] Extracting permalinks from ${manifests.length} manifest(s)…`);
    const r = extractFromDir(paths.manifests, paths.links, () => {});
    console.log(`[1] Done — ${r.totalLinks} links across ${r.okFiles} manifest(s).`);
    steps['extract-permalinks'] = { ran: true, ok: true, ...r };
  }

  // ---- Step 2 ----
  const linkFiles = fs.existsSync(paths.links)
    ? fs.readdirSync(paths.links).filter((f) => f.toLowerCase().endsWith('.links.txt')) : [];
  if (linkFiles.length === 0) {
    console.log('[2] No link files yet, skipping.');
    steps['dedupe-filter'] = { ran: false, skipped: true };
  } else {
    const cleanFile = path.join(paths.links, 'clean-links.txt');
    const r = dedupeAndFilter(paths.links, cleanFile);
    console.log(`[2] ${r.kept} unique post URLs kept (dropped ${r.duplicates} dup, ${r.nonPost} non-/p/).`);
    steps['dedupe-filter'] = { ran: true, ok: true, ...r };
  }

  // ---- Step 3 ----
  const cleanFile = path.join(paths.links, 'clean-links.txt');
  if (!fs.existsSync(cleanFile)) {
    console.log('[3] No clean-links.txt — skipping fetch + extract.');
    steps['fetch-html']   = { ran: false, skipped: true };
    steps['extract-html'] = { ran: false, skipped: true };
  } else {
    const pw = await checkPlaywright({ probeBrowser: true });
    if (!pw.ok) {
      console.error(`[3] Playwright not ready (${pw.reason}). Run: npm run sora:install-playwright`);
      process.exit(2);
    }
    console.log('[3] Fetching HTML…');
    const r3 = await fetchHtmlBatch({
      linksFile: cleanFile,
      htmlDir: paths.html,
      archiveDir: paths.archive,
      maxAgeMs,
      delayMs,
      callbacks: {
        onProgress: ({ index, total, status }) => {
          if ((index + 1) % 25 === 0 || status === 'failed') {
            process.stdout.write(`\r[3] ${index + 1}/${total}…`);
          }
        },
      },
    });
    process.stdout.write('\n');
    console.log(`[3] Done — new=${r3.fetchedNew}, refreshed=${r3.refreshed}, skipped=${r3.skippedFresh}, failed=${r3.failed}.`);
    steps['fetch-html'] = { ran: true, ok: true, ...r3 };

    // ---- Step 4 ----
    const htmlCount = fs.existsSync(paths.html)
      ? fs.readdirSync(paths.html).filter((f) => f.toLowerCase().endsWith('.html')).length : 0;
    if (htmlCount === 0) {
      console.log('[4] No HTML files in _refresh/html/, skipping.');
      steps['extract-html'] = { ran: false, skipped: true };
    } else {
      console.log(`[4] Extracting metadata from ${htmlCount} HTML file(s)…`);
      const r4 = extractHtmlBatch({
        htmlDir: paths.html,
        outputDir: paths.extracted,
        archiveDir: paths.archive,
        maxAgeMs,
      });
      console.log(`[4] Done — new=${r4.extractedNew}, refreshed=${r4.refreshed}, posts=${r4.totalPosts}, comments=${r4.totalComments}.`);
      steps['extract-html'] = { ran: true, ok: true, ...r4 };
    }
  }

  // ---- Step 5 ----
  if (!types.avatars && !types.thumbnails && !types.gifs) {
    console.log('[5] No asset types selected, skipping.');
    steps['download-assets'] = { ran: false, skipped: true };
  } else {
    console.log(`[5] Downloading ${Object.entries(types).filter(([, v]) => v).map(([k]) => k).join(', ')}…`);
    const r5 = await downloadAssetsBatch({
      archivePath: config.archivePath,
      types,
      callbacks: {
        onError: ({ kind, username, url, error, status }) => {
          const head = status ? `HTTP ${status}` : (error?.message || String(error));
          console.log(`    [5 fail ${kind}] ${username || url}: ${head}`);
        },
      },
    });
    if (types.avatars)    console.log(`[5] avatars:    ${r5.avatars.downloaded}↓ ${r5.avatars.skipped}=  ${r5.avatars.failed}✗`);
    if (types.thumbnails) console.log(`[5] thumbnails: ${r5.thumbnails.downloaded}↓ ${r5.thumbnails.skipped}=  ${r5.thumbnails.failed}✗`);
    if (types.gifs)       console.log(`[5] gifs:       ${r5.gifs.downloaded}↓ ${r5.gifs.skipped}=  ${r5.gifs.failed}✗`);
    steps['download-assets'] = { ran: true, ok: true, ...r5 };
  }

  // ---- Persist last-run ----
  const summary = {
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    types,
    steps: {
      'extract-permalinks': stepSummary(steps['extract-permalinks']),
      'dedupe-filter':      stepSummary(steps['dedupe-filter']),
      'fetch-html':         stepSummary(steps['fetch-html']),
      'extract-html':       stepSummary(steps['extract-html']),
      'download-assets':    stepSummary(steps['download-assets']),
    },
  };
  try { writeLastRun(config.archivePath, summary); }
  catch (e) { console.warn(`Could not persist last-run: ${e.message}`); }

  console.log(`\nFull pipeline finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
}

function stepSummary(s) {
  if (!s?.ran) return { ran: false, skipped: !!s?.skipped };
  return {
    ran: true, skipped: false, ok: s.ok !== false,
    files: s.files, okFiles: s.okFiles, totalLinks: s.totalLinks,
    sourceFiles: s.sourceFiles, kept: s.kept,
    fetchedNew: s.fetchedNew, refreshed: s.refreshed, skippedFresh: s.skippedFresh, failed: s.failed, archived: s.archived,
    extractedNew: s.extractedNew, totalPosts: s.totalPosts, totalVideos: s.totalVideos, totalComments: s.totalComments,
    avatars:    s.avatars,
    thumbnails: s.thumbnails,
    gifs:       s.gifs,
  };
}

main().catch((e) => { console.error(`FATAL: ${e.message}`); process.exit(1); });
