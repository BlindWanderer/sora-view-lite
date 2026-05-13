import path from 'path';
import fs from 'fs';

/**
 * Convention for the refresh pipeline:
 *
 *   <archive>/_refresh/
 *     manifests/   <- user drops manifest .json here (or symlinks)
 *     links/       <- step 1 output: <basename>.links.txt
 *     html/        <- step 3 output: <slug>.html
 *     extracted/   <- step 4 output: <slug>.extracted.json
 *     archive/     <- replaced/expired files (date-stamped subfolders)
 *
 * Pre-existing extracted.json files at the archive root are NOT touched.
 * The avatar walker at avatar-job.js already skips folders starting with `.`,
 * but `_refresh/` doesn't start with a dot — it intentionally gets walked so
 * freshly extracted files participate in avatar/asset downloads.
 */

export function refreshPaths(archivePath) {
  const root = path.join(archivePath, '_refresh');
  return {
    root,
    manifests: path.join(root, 'manifests'),
    links: path.join(root, 'links'),
    html: path.join(root, 'html'),
    extracted: path.join(root, 'extracted'),
    archive: path.join(root, 'archive'),
  };
}

export function ensureRefreshDirs(archivePath) {
  const p = refreshPaths(archivePath);
  for (const dir of [p.root, p.manifests, p.links, p.html, p.extracted, p.archive]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return p;
}

export function listManifestFiles(archivePath) {
  const p = refreshPaths(archivePath);
  if (!fs.existsSync(p.manifests)) return [];
  return fs.readdirSync(p.manifests)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .map((f) => path.join(p.manifests, f));
}

export function listLinkFiles(archivePath) {
  const p = refreshPaths(archivePath);
  if (!fs.existsSync(p.links)) return [];
  return fs.readdirSync(p.links)
    .filter((f) => f.toLowerCase().endsWith('.links.txt'))
    .map((f) => path.join(p.links, f));
}
