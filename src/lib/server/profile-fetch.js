import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { assertAllowedAssetUrl, isSafeBaseName } from './safety.js';

const PROFILE_FILE_RE = /^(.+)\.profile\.[a-z0-9]+$/i;

function extFromContentType(contentType = '') {
  if (!contentType) return 'jpg';
  const ct = contentType.toLowerCase().split(';')[0].trim();
  switch (ct) {
    case 'image/jpeg':
    case 'image/jpg':  return 'jpg';
    case 'image/png':  return 'png';
    case 'image/gif':  return 'gif';
    case 'image/webp': return 'webp';
    default: return 'jpg';
  }
}

export function profilesRoot(vaultRoot) {
  return path.join(vaultRoot, 'profiles');
}

export function profileDir(vaultRoot, username) {
  return path.join(profilesRoot(vaultRoot), username);
}

export function findExistingAvatar(vaultRoot, username) {
  if (!username) return null;
  const dir = profileDir(vaultRoot, username);
  if (!fs.existsSync(dir)) return null;
  let entries;
  try { entries = fs.readdirSync(dir); }
  catch { return null; }
  const expected = `${username}.profile.`;
  for (const name of entries) {
    if (name.toLowerCase().startsWith(expected.toLowerCase()) && PROFILE_FILE_RE.test(name)) {
      return path.join(dir, name);
    }
  }
  return null;
}

/**
 * Walk every creator_profiles row, look for the corresponding avatar file
 * on disk, and persist the finding to creator_profiles.avatar_ext. This is
 * the one and only filesystem scan needed — once written, the Server panel
 * stats query against the DB instead of re-scanning.
 *
 * Updates rows where the on-disk truth has changed:
 *  - file present, db column null → set to file extension
 *  - file present, db column wrong → correct
 *  - file missing, db column set → clear
 *
 * Profile folders that exist on disk but have no creator_profiles row are
 * ignored (orphan dirs from earlier download-profiles.js runs). The stats
 * deliberately answer "do my known profiles have avatars?" — not "what's
 * loose on disk?".
 */
export async function reconcileAvatarRegistry(db, vaultRoot) {
  const result = { checked: 0, set: 0, cleared: 0, unchanged: 0 };
  if (!db || !vaultRoot) return result;
  const root = profilesRoot(vaultRoot);
  if (!fs.existsSync(root)) return result;

  // Build a map of username → file ext from one readdir per profile row.
  // Iterating creator_profiles (~6k rows) and stat'ing the per-username dir
  // is cheaper than listing the entire profiles/ tree, because most users
  // have a known username and we can skip orphans entirely.
  const rows = await db.all('SELECT username, avatar_ext FROM creator_profiles');
  for (const row of rows) {
    if (!row?.username) continue;
    result.checked++;
    const onDisk = findExistingAvatar(vaultRoot, row.username);
    const newExt = onDisk ? (path.extname(onDisk).slice(1).toLowerCase() || null) : null;
    const oldExt = row.avatar_ext || null;
    if (newExt === oldExt) { result.unchanged++; continue; }
    await db.run('UPDATE creator_profiles SET avatar_ext = ? WHERE username = ?', [newExt, row.username]);
    if (newExt) result.set++;
    else result.cleared++;
  }
  return result;
}

/**
 * Update a single profile's avatar_ext immediately after a download or
 * skip-because-already-on-disk event. Idempotent — sets the column to the
 * provided extension if it differs.
 */
export async function recordAvatarExt(db, username, ext) {
  if (!db || !username) return;
  const cleanExt = ext ? String(ext).replace(/^\./, '').toLowerCase() : null;
  await db.run('UPDATE creator_profiles SET avatar_ext = ? WHERE username = ?', [cleanExt, username]);
}

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
};

function downloadOnce(url, destDir, baseName, hops = 0, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(Object.assign(new Error('Too many redirects'), { url }));
    // Gate the host on every hop so a redirect can't tunnel out of the
    // Sora-controlled CDN allowlist. The recursive call re-enters this
    // same check, so attackers can't 302 us into an internal service.
    try { assertAllowedAssetUrl(url); }
    catch (e) { return reject(Object.assign(e, { url })); }
    let parsed;
    try { parsed = new URL(url); }
    catch { return reject(Object.assign(new Error('Invalid URL'), { url })); }
    const driver = parsed.protocol === 'https:' ? https : http;

    const req = driver.get(url, { headers: DEFAULT_HEADERS }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return downloadOnce(res.headers.location, destDir, baseName, hops + 1, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { url, status: res.statusCode }));
      }

      const ext = extFromContentType(res.headers['content-type']);
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

export async function downloadAvatar(url, destDir, baseName, { timeoutMs = 30000 } = {}) {
  if (!url) throw new Error('No URL');
  return downloadOnce(url, destDir, baseName, 0, timeoutMs);
}

/**
 * Ensure an avatar exists for `username` under `<vaultRoot>/profiles/<username>/`.
 * If a `<username>.profile.*` file already exists, returns its path without
 * touching the network. Otherwise downloads from `url` (if provided) and
 * resolves with the new path. Returns null if no download is possible and
 * nothing is on disk.
 */
export async function ensureAvatar(vaultRoot, username, url) {
  if (!username) return null;
  // Refuse to use the username as a directory name if it would escape
  // the profiles/ root (path traversal, NUL, weird unicode).
  if (!isSafeBaseName(username)) return null;
  const existing = findExistingAvatar(vaultRoot, username);
  if (existing) return existing;
  if (!url) return null;
  const dir = profileDir(vaultRoot, username);
  const { filePath } = await downloadAvatar(url, dir, `${username}.profile`);
  return filePath;
}

/**
 * Run a bounded-concurrency pool of avatar downloads. Failures are swallowed
 * (logged via `onError` if provided) — one bad URL doesn't poison the batch.
 */
export async function ensureAvatarsBatch(vaultRoot, profiles, { concurrency = 6, timeoutMs = 30000, onError = null, onResult = null, onAttempt = null } = {}) {
  const queue = profiles.filter((p) => p?.username && p?.profile_picture_url);
  let i = 0;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  async function worker() {
    while (i < queue.length) {
      const idx = i++;
      const { username, profile_picture_url } = queue[idx];
      try {
        if (!isSafeBaseName(username)) {
          failed++;
          if (onError) onError({ username, error: new Error('Unsafe username — skipped'), url: profile_picture_url, status: null });
          continue;
        }
        const existing = findExistingAvatar(vaultRoot, username);
        if (existing) {
          skipped++;
          if (onResult) onResult({ username, status: 'skipped', filePath: existing });
          continue;
        }
        if (onAttempt) onAttempt({ username, url: profile_picture_url });
        const dir = profileDir(vaultRoot, username);
        const { filePath } = await downloadAvatar(profile_picture_url, dir, `${username}.profile`, { timeoutMs });
        downloaded++;
        if (onResult) onResult({ username, status: 'downloaded', filePath, url: profile_picture_url });
      } catch (err) {
        failed++;
        if (onError) onError({ username, error: err, url: err?.url || profile_picture_url, status: err?.status || null });
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return { downloaded, skipped, failed, total: queue.length };
}
