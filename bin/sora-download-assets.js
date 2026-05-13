#!/usr/bin/env node
/**
 * sora-download-assets
 *
 * CLI wrapper for the asset-download step. Walks every *.extracted.json in
 * the configured archive and downloads the requested asset types using
 * the URLs in those files.
 *
 * Usage:
 *   node bin/sora-download-assets.js [--types <list>] [--concurrency <N>] [--timeout <ms>]
 *
 *   --types       Comma-separated subset of: avatars,thumbnails,gifs.
 *                 Default: avatars,thumbnails,gifs (all three).
 *   --concurrency Per-type worker pool size (default 6).
 *   --timeout     Per-request timeout in ms (default 30000).
 *
 * Storage:
 *   Avatars     -> <archive>/profiles/<username>/<username>.profile.<ext>
 *   Thumbnails  -> <archive>/_refresh/assets/thumbnails/<attachment_id>.<ext>
 *   GIFs        -> <archive>/_refresh/assets/gifs/<attachment_id>.<ext>
 *
 * Skip-if-exists policy applies — binaries are "final" once on disk.
 */

import { downloadAssetsBatch } from '../src/lib/server/refresh/download-assets.js';
import { getConfig } from '../src/lib/config.js';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage:
  node bin/sora-download-assets.js [--types <list>] [--concurrency <N>] [--timeout <ms>]

  --types <list>     Comma-separated subset of: avatars,thumbnails,gifs.
                     Default: all three.
  --concurrency <N>  Per-type worker pool size (default 6).
  --timeout <ms>     Per-request timeout (default 30000).`);
    process.exit(0);
  }

  const config = getConfig();
  if (!config) {
    console.error('Setup is not complete.');
    process.exit(1);
  }

  const typesRaw = arg('--types', 'avatars,thumbnails,gifs');
  const wanted = new Set(typesRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const types = {
    avatars:    wanted.has('avatars'),
    thumbnails: wanted.has('thumbnails'),
    gifs:       wanted.has('gifs'),
  };
  if (!types.avatars && !types.thumbnails && !types.gifs) {
    console.error('--types must include at least one of avatars, thumbnails, gifs.');
    process.exit(1);
  }
  const concurrency = Number(arg('--concurrency', '6')) || 6;
  const timeoutMs   = Number(arg('--timeout', '30000')) || 30000;

  console.log(`Archive     : ${config.archivePath}`);
  console.log(`Types       : ${Object.entries(types).filter(([, v]) => v).map(([k]) => k).join(', ')}`);
  console.log(`Concurrency : ${concurrency}`);
  console.log(`Timeout     : ${timeoutMs}ms`);
  console.log();

  let totalShown = 0;
  const result = await downloadAssetsBatch({
    archivePath: config.archivePath,
    types,
    concurrency,
    timeoutMs,
    callbacks: {
      onProgress: (state) => {
        if (state.phase === 'queued') {
          const parts = [];
          if (types.avatars)    parts.push(`${state.queued.avatars} avatars`);
          if (types.thumbnails) parts.push(`${state.queued.thumbnails} thumbnails`);
          if (types.gifs)       parts.push(`${state.queued.gifs} gifs`);
          console.log(`Queued: ${parts.join(', ')}`);
        } else if (state.phase === 'downloading') {
          console.log(`\nDownloading ${state.kind} (${state.total})…`);
        }
      },
      onResult: (state) => {
        if (state.status === 'downloaded') {
          totalShown++;
          if (totalShown <= 50 || totalShown % 25 === 0) {
            const id = state.username || state.item?.attachment_id || '?';
            console.log(`  ok    ${state.kind}  ${id}`);
          }
        }
      },
      onError: ({ kind, username, url, error, status }) => {
        const head = status ? `HTTP ${status}` : (error?.message || String(error));
        const who = username ? `@${username}` : (url || '(no url)');
        console.log(`  fail  ${kind}  ${who}: ${head}`);
      },
    },
  });

  console.log(`\n--- Summary ---`);
  console.log(`Source files: ${result.files} extracted.json scanned`);
  if (types.avatars) {
    console.log(`Avatars     : ${result.avatars.downloaded} downloaded, ${result.avatars.skipped} on disk, ${result.avatars.failed} failed (queued: ${result.avatars.total})`);
  }
  if (types.thumbnails) {
    console.log(`Thumbnails  : ${result.thumbnails.downloaded} downloaded, ${result.thumbnails.skipped} on disk, ${result.thumbnails.failed} failed (queued: ${result.thumbnails.total})`);
  }
  if (types.gifs) {
    console.log(`GIFs        : ${result.gifs.downloaded} downloaded, ${result.gifs.skipped} on disk, ${result.gifs.failed} failed (queued: ${result.gifs.total})`);
  }
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
