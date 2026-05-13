import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { readdir } from 'fs/promises';
// Use a relative import (not the $lib Vite alias) so the CLI wrappers in
// /bin can import this module via plain Node without a bundler.
import {
  ensureAvatarsBatch,
  findExistingAvatar,
} from '../profile-fetch.js';
import { assertAllowedAssetUrl, isSafeBaseName } from '../safety.js';

/**
 * Download official Sora assets — profile avatars, video thumbnails, and
 * GIF previews — using the URLs in *.extracted.json. The metadata side of
 * the refresh pipeline (steps 1-4) is what produces fresh signed URLs;
 * this step is what actually pulls bytes for them to disk.
 *
 * Storage layout:
 *   Profile avatars  -> <archive>/profiles/<username>/<username>.profile.<ext>
 *                       (existing convention — same as the standalone avatar
 *                       job; we reuse ensureAvatarsBatch for that half)
 *   Thumbnails       -> <archive>/_refresh/assets/thumbnails/<attachment_id>.<ext>
 *   GIF previews     -> <archive>/_refresh/assets/gifs/<attachment_id>.<ext>
 *
 * Per the design Q&A, asset binaries are NOT subject to the 7-day age-based
 * replace logic — they're "final" once on disk. Skip-if-exists is the policy.
 * If a user wants a fresh copy they can delete the file and re-run.
 */

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
};

function extFromContentType(contentType = '', fallback = 'jpg') {
  if (!contentType) return fallback;
  const ct = contentType.toLowerCase().split(';')[0].trim();
  switch (ct) {
    case 'image/jpeg':
    case 'image/jpg':  return 'jpg';
    case 'image/png':  return 'png';
    case 'image/gif':  return 'gif';
    case 'image/webp': return 'webp';
    case 'video/mp4':  return 'mp4';
    default: return fallback;
  }
}

function downloadOnce(url, destDir, baseName, fallbackExt = 'jpg', hops = 0, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(Object.assign(new Error('Too many redirects'), { url }));
    // Re-validated on every hop so a 302 can't tunnel out of the asset
    // host allowlist (see safety.js).
    try { assertAllowedAssetUrl(url); }
    catch (e) { return reject(Object.assign(e, { url })); }
    let parsed;
    try { parsed = new URL(url); }
    catch { return reject(Object.assign(new Error('Invalid URL'), { url })); }
    const driver = parsed.protocol === 'https:' ? https : http;

    const req = driver.get(url, { headers: DEFAULT_HEADERS }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return downloadOnce(res.headers.location, destDir, baseName, fallbackExt, hops + 1, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { url, status: res.statusCode }));
      }
      const ext = extFromContentType(res.headers['content-type'], fallbackExt);
      const filePath = path.join(destDir, `${baseName}.${ext}`);
      fs.mkdirSync(destDir, { recursive: true });
      const out = fs.createWriteStream(filePath);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve({ filePath, ext, url })));
      out.on('error', (err) => {
        try { fs.unlinkSync(filePath); } catch {}
        reject(Object.assign(err, { url }));
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(Object.assign(new Error(`Timeout after ${timeoutMs}ms`), { url })); });
    req.on('error', (err) => reject(Object.assign(err, { url })));
  });
}

/* -- Walk extracted JSON ----------------------------------------------------*/

async function* walkExtractedJson(rootDir) {
  // Same skip rules as avatar-job's walker so existing files at archive root
  // and new files in _refresh/extracted/ both participate.
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'profiles' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walkExtractedJson(full);
    } else if (entry.isFile() && /\.extracted\.json$/i.test(entry.name)) {
      yield full;
    }
  }
}

function profileEntry(profile) {
  if (!profile?.username || !profile?.profile_picture_url) return null;
  return { username: profile.username, profile_picture_url: profile.profile_picture_url };
}

function eachVideoAttachment(post, fn) {
  for (const v of (post?.videos || [])) {
    if (!v?.attachment_id) continue;
    fn(v);
  }
}

/**
 * Walk every extracted.json under archivePath and collect deduped maps for
 * each asset type. Each value carries enough info for the UI to refer back
 * to the source post.
 *
 * Avatars use a fully separate dedupe key (username) because the same user
 * appears in many posts. Thumbnails and GIFs dedupe by attachment_id since
 * each video is a unique source.
 */
export async function collectAssetsFromExtracted(archivePath, callbacks = {}) {
  const onProgress = typeof callbacks.onProgress === 'function' ? callbacks.onProgress : () => {};
  const shouldCancel = typeof callbacks.shouldCancel === 'function' ? callbacks.shouldCancel : () => false;

  const avatars = new Map();      // username -> { username, profile_picture_url }
  const thumbnails = new Map();   // attachment_id -> { attachment_id, post_id, url }
  const gifs = new Map();         // attachment_id -> { attachment_id, post_id, url }

  const files = [];
  for await (const f of walkExtractedJson(archivePath)) {
    if (shouldCancel()) break;
    files.push(f);
  }

  for (let i = 0; i < files.length; i++) {
    if (shouldCancel()) break;
    const file = files[i];
    onProgress({ phase: 'scanning', index: i, total: files.length, file });

    let payload;
    try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { continue; }

    const allProfiles = Array.isArray(payload?.all_profiles) ? payload.all_profiles : [];
    for (const p of allProfiles) {
      const e = profileEntry(p);
      if (e && !avatars.has(e.username)) avatars.set(e.username, e);
    }

    const posts = Array.isArray(payload?.posts) ? payload.posts : [];
    for (const post of posts) {
      const author = profileEntry(post?.author);
      if (author && !avatars.has(author.username)) avatars.set(author.username, author);

      // Comments often expose authors not present in all_profiles.
      for (const c of (post?.comments || [])) {
        const a = profileEntry(c?.author);
        if (a && !avatars.has(a.username)) avatars.set(a.username, a);
      }

      // Cameo profiles can also have profile_picture_url.
      for (const cp of (post?.cameo_profiles || [])) {
        const a = profileEntry(cp);
        if (a && !avatars.has(a.username)) avatars.set(a.username, a);
        const owner = profileEntry(cp?.owner_profile);
        if (owner && !avatars.has(owner.username)) avatars.set(owner.username, owner);
      }

      eachVideoAttachment(post, (v) => {
        if (v.url_thumbnail && !thumbnails.has(v.attachment_id)) {
          thumbnails.set(v.attachment_id, {
            attachment_id: v.attachment_id,
            post_id: post.post_id,
            url: v.url_thumbnail,
          });
        }
        if (v.url_gif && !gifs.has(v.attachment_id)) {
          gifs.set(v.attachment_id, {
            attachment_id: v.attachment_id,
            post_id: post.post_id,
            url: v.url_gif,
          });
        }
      });

      // Walk parent_post and ancestors too — they have their own attachments.
      const nested = [];
      if (post?.parent_post) nested.push(post.parent_post);
      if (Array.isArray(post?.ancestors)) nested.push(...post.ancestors);
      for (const np of nested) {
        eachVideoAttachment(np, (v) => {
          if (v.url_thumbnail && !thumbnails.has(v.attachment_id)) {
            thumbnails.set(v.attachment_id, { attachment_id: v.attachment_id, post_id: np.post_id, url: v.url_thumbnail });
          }
          if (v.url_gif && !gifs.has(v.attachment_id)) {
            gifs.set(v.attachment_id, { attachment_id: v.attachment_id, post_id: np.post_id, url: v.url_gif });
          }
        });
      }
    }
  }

  return {
    files: files.length,
    avatars: Array.from(avatars.values()),
    thumbnails: Array.from(thumbnails.values()),
    gifs: Array.from(gifs.values()),
  };
}

/* -- Per-type downloaders ---------------------------------------------------*/

function thumbnailsDir(archivePath) { return path.join(archivePath, '_refresh', 'assets', 'thumbnails'); }
function gifsDir(archivePath)       { return path.join(archivePath, '_refresh', 'assets', 'gifs'); }

function findExistingByPrefix(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  const lower = prefix.toLowerCase() + '.';
  for (const n of names) {
    if (n.toLowerCase().startsWith(lower)) return path.join(dir, n);
  }
  return null;
}

async function downloadBinaryBatch(items, destDir, { fallbackExt, concurrency = 4, timeoutMs = 30000, callbacks = {} } = {}) {
  const onResult = typeof callbacks.onResult === 'function' ? callbacks.onResult : () => {};
  const onError  = typeof callbacks.onError === 'function'  ? callbacks.onError  : () => {};
  const shouldCancel = typeof callbacks.shouldCancel === 'function' ? callbacks.shouldCancel : () => false;

  let i = 0;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  fs.mkdirSync(destDir, { recursive: true });

  async function worker() {
    while (i < items.length) {
      if (shouldCancel()) return;
      const idx = i++;
      const item = items[idx];
      try {
        // Reject attachment_ids that contain path separators / dot-dot /
        // weird unicode before they get concatenated into a write path.
        if (!isSafeBaseName(item.attachment_id)) {
          failed++;
          onError({ index: idx, total: items.length, item, error: new Error('Unsafe attachment_id — skipped'), status: null });
          continue;
        }
        const existing = findExistingByPrefix(destDir, item.attachment_id);
        if (existing) {
          skipped++;
          onResult({ index: idx, total: items.length, item, status: 'skipped', filePath: existing });
          continue;
        }
        const { filePath } = await downloadOnce(item.url, destDir, item.attachment_id, fallbackExt, 0, timeoutMs);
        downloaded++;
        onResult({ index: idx, total: items.length, item, status: 'downloaded', filePath });
      } catch (err) {
        failed++;
        onError({ index: idx, total: items.length, item, error: err, status: err?.status || null });
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return { downloaded, skipped, failed, total: items.length };
}

/**
 * Run the asset-download phase. `types` is a flag bag — only the requested
 * categories are walked and downloaded. Returns a per-type stats object.
 */
export async function downloadAssetsBatch(opts) {
  const {
    archivePath,
    types = { avatars: true, thumbnails: true, gifs: true },
    concurrency = 6,
    timeoutMs = 30000,
    callbacks = {},
  } = opts;

  const onProgress = typeof callbacks.onProgress === 'function' ? callbacks.onProgress : () => {};
  const shouldCancel = typeof callbacks.shouldCancel === 'function' ? callbacks.shouldCancel : () => false;
  const onError = typeof callbacks.onError === 'function' ? callbacks.onError : () => {};
  const onResult = typeof callbacks.onResult === 'function' ? callbacks.onResult : () => {};

  // Collection pass — single read of every extracted.json
  onProgress({ phase: 'collecting' });
  const collected = await collectAssetsFromExtracted(archivePath, {
    onProgress, shouldCancel,
  });

  const queued = {
    avatars:    types.avatars    ? collected.avatars.length    : 0,
    thumbnails: types.thumbnails ? collected.thumbnails.length : 0,
    gifs:       types.gifs       ? collected.gifs.length       : 0,
  };
  onProgress({ phase: 'queued', queued });

  const result = {
    files: collected.files,
    avatars:    { downloaded: 0, skipped: 0, failed: 0, total: 0 },
    thumbnails: { downloaded: 0, skipped: 0, failed: 0, total: 0 },
    gifs:       { downloaded: 0, skipped: 0, failed: 0, total: 0 },
  };

  if (types.avatars && !shouldCancel()) {
    onProgress({ phase: 'downloading', kind: 'avatars', total: collected.avatars.length });
    const r = await ensureAvatarsBatch(archivePath, collected.avatars, {
      concurrency,
      timeoutMs,
      onError: ({ username, error, url, status }) => onError({ kind: 'avatars', username, url, error, status }),
      onResult: ({ username, status, filePath, url }) => onResult({ kind: 'avatars', username, status, filePath, url }),
    });
    result.avatars = r;
  }

  if (types.thumbnails && !shouldCancel()) {
    onProgress({ phase: 'downloading', kind: 'thumbnails', total: collected.thumbnails.length });
    const r = await downloadBinaryBatch(collected.thumbnails, thumbnailsDir(archivePath), {
      fallbackExt: 'jpg',
      concurrency,
      timeoutMs,
      callbacks: {
        shouldCancel,
        onResult: (s) => onResult({ kind: 'thumbnails', ...s }),
        onError:  (s) => onError({ kind: 'thumbnails', url: s.item?.url, error: s.error, status: s.status }),
      },
    });
    result.thumbnails = r;
  }

  if (types.gifs && !shouldCancel()) {
    onProgress({ phase: 'downloading', kind: 'gifs', total: collected.gifs.length });
    const r = await downloadBinaryBatch(collected.gifs, gifsDir(archivePath), {
      fallbackExt: 'gif',
      concurrency,
      timeoutMs,
      callbacks: {
        shouldCancel,
        onResult: (s) => onResult({ kind: 'gifs', ...s }),
        onError:  (s) => onError({ kind: 'gifs', url: s.item?.url, error: s.error, status: s.status }),
      },
    });
    result.gifs = r;
  }

  return result;
}

/**
 * Quick read-only inventory for the panel — counts of files already on disk
 * per asset type, so the user knows what's there before starting.
 */
export function getAssetInventory(archivePath) {
  const out = {
    avatars: { count: 0 },
    thumbnails: { count: 0 },
    gifs: { count: 0 },
  };
  // Avatars are easier to count from creator_profiles via getAvatarStats() —
  // we leave that to the existing caller. For thumbnails/gifs do a directory
  // listing.
  try {
    const tDir = thumbnailsDir(archivePath);
    if (fs.existsSync(tDir)) out.thumbnails.count = fs.readdirSync(tDir).length;
  } catch {}
  try {
    const gDir = gifsDir(archivePath);
    if (fs.existsSync(gDir)) out.gifs.count = fs.readdirSync(gDir).length;
  } catch {}
  return out;
}

// Re-export so other modules don't need to dig into profile-fetch separately.
export { findExistingAvatar };
