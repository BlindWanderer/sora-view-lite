import fs from 'fs';
import path from 'path';
import { refreshPaths } from './paths.js';

/**
 * Persists a single "last refresh run" record to <archive>/_refresh/last-run.json
 * so the panel can show "Last full refresh: 2 hours ago — 312 avatars / 6,861
 * thumbs" without needing a database. Only run-all writes this — individual
 * step buttons do not, since they're not a complete refresh.
 *
 * The record format intentionally mirrors what the panel renders so we can
 * change it without touching this module's API.
 */

function lastRunFile(archivePath) {
  return path.join(refreshPaths(archivePath).root, 'last-run.json');
}

export function writeLastRun(archivePath, payload) {
  const file = lastRunFile(archivePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
}

export function readLastRun(archivePath) {
  const file = lastRunFile(archivePath);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}
