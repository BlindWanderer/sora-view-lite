import fs from 'fs';
import path from 'path';

/**
 * Extracts post permalinks from SoraVault manifest JSON files.
 *
 * Handles all three known formats:
 *
 *   Format A (creator/liked v1):
 *     items[]._raw.post.permalink
 *
 *   Format B (creator/liked v2+):
 *     items[].postId  ->  https://sora.chatgpt.com/p/<postId>
 *     items[]._raw.post.post.permalink  (unlisted/link-shared)
 *
 *   Format C (remix manifest):
 *     chains[].post._raw.post.permalink
 *     chains[].parents[]._raw.post.permalink
 *     chains[].downstream[]._raw.post.permalink
 *
 *   Drafts manifests (scan_sources: v2_drafts):
 *     Most have no permalinks. Unlisted shared drafts are at
 *     items[]._raw.post.post.permalink (covered by Format B).
 */

const BASE_URL = 'https://sora.chatgpt.com/p/';

function addPermalink(val, found) {
  if (val && typeof val === 'string' && val.includes('/p/s_')) {
    found.add(val);
  }
}

function permalinkFromId(id) {
  if (id && typeof id === 'string' && id.startsWith('s_')) {
    return BASE_URL + id;
  }
  return null;
}

function collectFromManifest(data) {
  const found = new Set();

  if (Array.isArray(data?.items)) {
    for (const item of data.items) {
      const fromId = permalinkFromId(item?.postId);
      if (fromId) { found.add(fromId); continue; }
      const raw = item?._raw;
      if (!raw) continue;
      addPermalink(raw.post?.permalink, found);
      addPermalink(raw.post?.post?.permalink, found);
    }
  }

  if (Array.isArray(data?.chains)) {
    for (const chain of data.chains) {
      addPermalink(chain?.post?._raw?.post?.permalink, found);
      for (const e of (chain?.parents || []))    addPermalink(e?._raw?.post?.permalink, found);
      for (const e of (chain?.downstream || [])) addPermalink(e?._raw?.post?.permalink, found);
    }
  }

  return found;
}

/**
 * Process a single manifest file. Returns { ok, file, links, isDraft, error? }.
 * Writes <basename>.links.txt to outputDir if at least one link was found.
 */
export function extractFromManifest(file, outputDir) {
  const result = {
    file,
    basename: path.basename(file),
    outputFile: '',
    links: 0,
    isDraft: false,
    ok: false,
    error: null,
  };

  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    result.error = `Parse error: ${e.message}`;
    return result;
  }

  const sources = Array.isArray(data?.scan_sources) ? data.scan_sources : [];
  result.isDraft = sources.includes('v2_drafts');

  const found = collectFromManifest(data);
  const links = [...found].sort();
  result.links = links.length;

  const outFile = path.join(
    outputDir,
    path.basename(file, path.extname(file)) + '.links.txt'
  );
  result.outputFile = outFile;

  if (links.length > 0) {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outFile, links.join('\n') + '\n', 'utf8');
  }

  result.ok = true;
  return result;
}

/**
 * Process every *.json under inputDir (non-recursive — manifests are flat).
 * Returns { files, totalLinks, draftFiles, errors[] }.
 */
export function extractFromDir(inputDir, outputDir, onProgress) {
  const totals = {
    files: 0,
    okFiles: 0,
    totalLinks: 0,
    draftFiles: 0,
    errors: [],
    perFile: [],
  };

  if (!fs.existsSync(inputDir)) return totals;

  const entries = fs.readdirSync(inputDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
    .map((e) => path.join(inputDir, e.name));

  totals.files = entries.length;

  for (const file of entries) {
    const r = extractFromManifest(file, outputDir);
    totals.perFile.push(r);
    if (r.ok) {
      totals.okFiles++;
      totals.totalLinks += r.links;
      if (r.isDraft) totals.draftFiles++;
    } else if (r.error) {
      totals.errors.push({ file: r.basename, error: r.error });
    }
    if (typeof onProgress === 'function') onProgress(r, totals);
  }

  return totals;
}
