import fs from 'fs';
import path from 'path';

/**
 * Reads every *.links.txt in inputDir, dedupes URLs across all of them,
 * and filters down to /p/ post URLs only (which is the only kind
 * fetch-html will actually be able to retrieve).
 *
 * Replaces both:
 *   node 2_dedupe-urls.js  (single-file dedupe)
 *   grep /p/ *.txt > clean-links.txt  (cross-file filter)
 *
 * Output:
 *   <outputDir>/clean-links.txt  — deduped, /p/-only, one URL per line
 *
 * Returns { totalLines, kept, duplicates, nonPost, errors[] }.
 */

const POST_RE = /\/p\/s_/;

function readLinksFile(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch (e) {
    return null;
  }
}

export function dedupeAndFilter(inputDir, outputFile) {
  const stats = {
    sourceFiles: 0,
    totalLines: 0,
    kept: 0,
    duplicates: 0,
    nonPost: 0,
    blankOrComment: 0,
    errors: [],
  };

  if (!fs.existsSync(inputDir)) {
    stats.errors.push(`Input dir does not exist: ${inputDir}`);
    return stats;
  }

  const files = fs.readdirSync(inputDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.links.txt'))
    .map((e) => path.join(inputDir, e.name));

  stats.sourceFiles = files.length;

  const seen = new Set();
  const kept = [];

  for (const file of files) {
    const lines = readLinksFile(file);
    if (lines === null) {
      stats.errors.push(`Could not read ${path.basename(file)}`);
      continue;
    }
    for (const raw of lines) {
      stats.totalLines++;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        stats.blankOrComment++;
        continue;
      }
      if (!POST_RE.test(trimmed)) {
        stats.nonPost++;
        continue;
      }
      if (seen.has(trimmed)) {
        stats.duplicates++;
        continue;
      }
      seen.add(trimmed);
      kept.push(trimmed);
    }
  }

  stats.kept = kept.length;

  if (kept.length > 0) {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, kept.join('\n') + '\n', 'utf8');
  }

  return stats;
}
