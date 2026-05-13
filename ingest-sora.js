#!/usr/bin/env node
/**
 * ingest-sora.js
 * Ingest a Sora Vault archive into a local SQLite or DuckDB database.
 *
 * Usage:
 *   node ingest-sora.js <archive-dir> [--db ./sora.db] [--engine sqlite|duckdb]
 *                                     [--comments-dir <dir>] [--avatars]
 *
 * The comments phase scans for *.extracted.json files anywhere under
 * --comments-dir (defaults to <archive-dir>) and indexes them into the local
 * database. Avatar download is opt-in via --avatars: source SAS URLs in
 * extracted.json files decay quickly and will return HTTP 403 once expired.
 * Use the Server panel → Assets tab to trigger avatar downloads on demand.
 */

import path from 'path';
import { ingestSoraArchive } from './src/lib/server/ingest.js';

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.error('Usage: node ingest-sora.js <archive-dir> [--db ./sora.db] [--engine sqlite|duckdb] [--comments-dir <dir>] [--avatars] [--debug-avatars]');
  process.exit(args.length === 0 ? 1 : 0);
}

function flagValue(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const archivePath = path.resolve(args[0]);
const dbEngine = flagValue('--engine') || 'sqlite';
const dbPath = flagValue('--db')
  ? path.resolve(flagValue('--db'))
  : path.join(archivePath, dbEngine === 'duckdb' ? 'sora.duckdb' : 'sora.db');
const commentsDir = flagValue('--comments-dir')
  ? path.resolve(flagValue('--comments-dir'))
  : archivePath;
const downloadAvatars = args.includes('--avatars');
const debugAvatars = args.includes('--debug-avatars');

let lastPrinted = 0;
try {
  console.log(`Archive    : ${archivePath}`);
  console.log(`Engine     : ${dbEngine}`);
  console.log(`Database   : ${dbPath}`);
  console.log(`Comments   : ${commentsDir}`);
  console.log(`Avatars    : ${downloadAvatars ? (debugAvatars ? 'on (debug)' : 'on') : 'off'}\n`);

  const result = await ingestSoraArchive({
    archivePath,
    dbPath,
    dbEngine,
    commentsDir,
    downloadAvatars,
    debugAvatars,
    onProgress(progress) {
      const now = Date.now();
      if (progress.phase === 'complete' || now - lastPrinted > 300) {
        lastPrinted = now;
        const phase = progress.phase || 'ingesting';
        if (phase === 'parsing_comments' || phase === 'downloading_avatars' || phase === 'comments_complete') {
          process.stdout.write(`\r  ${phase.padEnd(22)}  files: ${progress.commentFilesFound || 0}  comments: ${progress.commentsInserted || 0}  avatars dl: ${progress.avatarsDownloaded || 0}/skip ${progress.avatarsSkipped || 0}`);
        } else if (phase === 'avatar_attempt' || phase === 'avatar_ok') {
          process.stdout.write('\n');
          console.log(`  ${progress.message}`);
        } else {
          process.stdout.write(`\r  processed: ${progress.processed}  inserted: ${progress.inserted}  updated: ${progress.skipped}  manifests: ${progress.manifestsFound}  thumbs: ${progress.thumbnailsFound}`);
        }
      }
      if (progress.phase === 'error' || progress.phase === 'warning') {
        process.stdout.write('\n');
        console.warn(`  WARN: ${progress.message}`);
      }
    },
  });

  process.stdout.write('\n');
  console.log('\n── Summary ───────────────────────────────────');
  console.log(`  video files found   : ${result.found}`);
  console.log(`  videos inserted     : ${result.inserted}`);
  console.log(`  videos updated      : ${result.skipped}`);
  console.log(`  manifests parsed    : ${result.manifestsFound}`);
  console.log(`  thumbnails found    : ${result.thumbnailsFound}`);
  console.log(`  previews found      : ${result.previewsFound}`);
  console.log(`  cameos inserted     : ${result.cameosInserted}`);
  console.log(`  no companion .txt   : ${result.noTxt}`);
  console.log(`  comment files       : ${result.commentFilesFound || 0}`);
  console.log(`  comments inserted   : ${result.commentsInserted || 0}`);
  console.log(`  avatars downloaded  : ${result.avatarsDownloaded || 0}`);
  console.log(`  avatars on disk     : ${result.avatarsSkipped || 0}`);
  console.log(`  avatars failed      : ${result.avatarsFailed || 0}`);
  console.log(`  avatars registered  : ${result.avatarsRegistered || 0}`);
  console.log(`  avatars cleared     : ${result.avatarsCleared || 0}`);
  console.log(`  errors              : ${result.errors}`);
  console.log(`\nDatabase: ${dbPath}`);
} catch (err) {
  console.error('Fatal:', err.message);
  process.exit(1);
}
