/**
 * Filesystem and network input guards shared across the refresh pipeline,
 * the bookmark flow, and the local profile-fetch helpers.
 *
 * Why: usernames and attachment-ids in the RSC payload originate upstream
 * and are partly user-controlled (a Sora user can pick their username).
 * The asset download paths concatenate those values into directories and
 * filenames, so untrusted input here could escape the archive root with
 * `..` or shell metacharacters. Asset download URLs come from the same
 * payload and could in principle point at any host — including local
 * services — if the page was crafted maliciously.
 *
 * The cost of letting either through is low in practice because Sora's
 * own backend validates usernames and serves assets from a small set of
 * CDN hostnames. The cost of defending against them is also low. So we
 * defend.
 */

/* ── Filename / path-component guard ─────────────────────────────────── */

// Conservative whitelist: ASCII letters/digits plus the punctuation actually
// observed in Sora usernames and attachment_ids (dot, dash, underscore, @).
// Anything else — including path separators, NUL, control chars, unicode,
// dollar signs, etc. — is rejected.
const SAFE_BASE_NAME_RE = /^[A-Za-z0-9._@-]+$/;
const PURE_DOTS_RE = /^\.+$/;

/**
 * Returns true if `name` is safe to use as a single path component
 * (directory or filename without extension). Returns false for the
 * empty string, pure-dot strings (`.`, `..`, `...`), anything with
 * a `/` or `\`, NUL bytes, leading dots (hidden files), or any char
 * outside [A-Za-z0-9._@-].
 */
export function isSafeBaseName(name) {
  if (typeof name !== 'string') return false;
  if (name.length === 0 || name.length > 200) return false;
  if (PURE_DOTS_RE.test(name)) return false;        // ".", "..", "..."
  if (name.startsWith('.')) return false;            // ".hidden", ".env"
  if (name.includes('\0')) return false;
  return SAFE_BASE_NAME_RE.test(name);
}

/**
 * Returns the input untouched if it passes `isSafeBaseName`, otherwise
 * returns null. Designed for batch contexts where we'd rather skip one
 * bad entry than abort the whole run.
 */
export function safeBaseNameOrNull(name) {
  return isSafeBaseName(name) ? name : null;
}

/**
 * Throws on unsafe input. Use in single-action contexts where there's no
 * sensible recovery — e.g. a bookmark download whose author is malformed.
 */
export function assertSafeBaseName(name, kind = 'path component') {
  if (!isSafeBaseName(name)) {
    throw new Error(`Unsafe ${kind}: ${JSON.stringify(name)}`);
  }
  return name;
}

/* ── Asset download host whitelist ───────────────────────────────────── */

// Hosts we've actually observed in Sora's RSC payloads. New hosts can be
// added here as the upstream surface changes. We deliberately do NOT do
// suffix matching (e.g. `endsWith('.openai.com')`) because that's a
// historical source of SSRF bypasses.
const ALLOWED_ASSET_HOSTS = new Set([
  'videos.openai.com',
  'cdn.openai.com',
  'sora.chatgpt.com',
]);

/**
 * Returns true if `urlStr` is a fetch-safe asset URL: http(s), and the
 * host is one we recognize as a Sora-controlled CDN.
 */
export function isAllowedAssetUrl(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr) return false;
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  return ALLOWED_ASSET_HOSTS.has(u.hostname);
}

/**
 * Throws if `urlStr` is outside the asset whitelist. Used at the bottom
 * of the download stack so every fetch — initial request AND redirect
 * target — passes through the same check.
 */
export function assertAllowedAssetUrl(urlStr) {
  if (!isAllowedAssetUrl(urlStr)) {
    let host = '(unparseable)';
    try { host = new URL(urlStr).hostname; } catch {}
    throw new Error(`Disallowed asset host: ${host}`);
  }
  return urlStr;
}
