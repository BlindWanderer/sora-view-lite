import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { getConfig } from '$lib/config.js';
import { getDB, closeDB } from '$lib/db.js';
import { extractFromHtml } from '$lib/server/refresh/extract-html.js';
import { ingestExtractedPayload } from '$lib/server/refresh/single-ingest.js';
import { ensureRefreshDirs } from '$lib/server/refresh/paths.js';
import { checkPlaywright, launchChromium } from '$lib/server/refresh/playwright-check.js';
import {
  assertAllowedAssetUrl,
  assertSafeBaseName,
  isSafeBaseName,
} from '$lib/server/safety.js';

/**
 * Single-bookmark download orchestrator. Mirrors the Refresh Sora Assets
 * pipeline but for one URL at a time, with a step-by-step UI feel:
 *
 *   0. Validate URL (must be a /p/ post page, not a profile)
 *   1. Check the DB for the post_id
 *      └─ if found, the action returns a "lookup" result instead of starting
 *         a job, so the panel can show the existing entry + missing assets
 *   2. (informational) "Link not found, attempting to download…"
 *   3. Fetch the SSR HTML via Playwright (JS disabled), surface the page title
 *   4. Extract the RSC payload to <archive>/_refresh/extracted/<slug>.extracted.json
 *   5. Download every video attachment to sora_v2_creators/<author>/
 *   6. Download thumbnail(s) next to the video, with the same base filename
 *   7. Download GIF preview(s); also fetch the author's avatar if missing
 *   8. Single-file ingest into videos / comments / creator_profiles
 *
 * Job state is a singleton so the UI can poll via meta-refresh, same pattern
 * as refresh-job.
 */

const runtimeImport = Function('specifier', 'return import(specifier)');

let currentBookmarkJob = null;

/* ── URL parsing + DB lookup ───────────────────────────────────────────── */

/**
 * Pull the post_id (s_xxx) out of a Sora URL or bare path. Returns null if
 * the input doesn't look like a /p/ post page.
 */
export function extractPostIdFromUrl(rawUrl) {
  if (!rawUrl) return null;
  const trimmed = String(rawUrl).trim();
  if (!trimmed) return null;
  // Anything that doesn't include /p/ is not a post page (profile URLs, etc.)
  if (!trimmed.includes('/p/')) return null;
  // Tolerate full URL, bare /p/s_xxx, or trailing slashes / query strings.
  const m = trimmed.match(/\/p\/(s_[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

export function normalizeBookmarkUrl(rawUrl) {
  const id = extractPostIdFromUrl(rawUrl);
  if (!id) return null;
  return `https://sora.chatgpt.com/p/${id}`;
}

/**
 * Check whether the given post_id is already known to the DB. If yes, also
 * walk disk for the canonical assets (video, thumbnail, gif, avatar) so the
 * panel can show what's missing. Used by the action to decide whether to
 * start a download job or just report.
 */
export async function lookupBookmarkInDb(postId) {
  if (!postId) return { found: false };
  const config = getConfig();
  if (!config) return { found: false, error: 'Setup not complete' };

  const db = await getDB();
  const rows = await db.all(
    'SELECT id, file_path, filename, author, post_id, prompt, date, thumbnail_path, preview_path, comment_count FROM videos WHERE post_id = ?',
    [postId],
  );
  if (!rows.length) return { found: false };

  const videos = rows.map((row) => {
    const videoOnDisk = row.file_path ? fs.existsSync(row.file_path) : false;
    const thumbOnDisk = row.thumbnail_path ? fs.existsSync(row.thumbnail_path) : false;
    const previewOnDisk = row.preview_path ? fs.existsSync(row.preview_path) : false;
    return { ...row, videoOnDisk, thumbOnDisk, previewOnDisk };
  });

  const author = videos[0].author || null;
  let avatarOnDisk = false;
  if (author) {
    const dir = path.join(config.archivePath, 'profiles', author);
    if (fs.existsSync(dir)) {
      try { avatarOnDisk = fs.readdirSync(dir).some((n) => n.toLowerCase().startsWith(`${author.toLowerCase()}.profile.`)); }
      catch {}
    }
  }

  const missing = {
    video:     videos.some((v) => !v.videoOnDisk),
    thumbnail: videos.some((v) => !v.thumbOnDisk),
    preview:   videos.some((v) => !v.previewOnDisk),
    avatar:    !!author && !avatarOnDisk,
  };

  return { found: true, postId, author, videos, avatarOnDisk, missing };
}

/* ── Job state ─────────────────────────────────────────────────────────── */

function createJob({ url, postId, topUpOnly, archivePath, dbPath }) {
  return {
    id: `${Date.now()}-bookmark`,
    url,
    postId,
    topUpOnly,
    archivePath,
    dbPath,
    running: true,
    done: false,
    ok: false,
    cancelled: false,
    cancelRequested: false,
    error: null,
    phase: 'starting',
    startedAt: new Date().toISOString(),
    completedAt: null,
    pageTitle: null,
    extractedFile: null,
    creator: null,
    steps: {
      validate:  { state: 'done',    message: `URL OK: ${url}` },
      dbcheck:   { state: 'pending', message: '' },
      fetch:     { state: 'pending', message: '' },
      extract:   { state: 'pending', message: '' },
      video:     { state: 'pending', message: '' },
      thumbnail: { state: 'pending', message: '' },
      gif:       { state: 'pending', message: '' },
      avatar:    { state: 'pending', message: '' },
      ingest:    { state: 'pending', message: '' },
    },
    counts: { videos: 0, thumbnails: 0, gifs: 0, comments: 0 },
    messages: [],
  };
}

function pushMessage(job, text, level = 'info') {
  if (!job) return;
  job.messages = [...job.messages.slice(-19), { at: new Date().toISOString(), level, text }];
}

function setStep(job, name, state, message) {
  if (!job?.steps?.[name]) return;
  job.steps[name].state = state;
  if (message != null) job.steps[name].message = message;
}

function finishJob(job, error) {
  job.running = false;
  job.done = true;
  job.completedAt = new Date().toISOString();
  if (error) {
    job.ok = false;
    job.error = error.message || String(error);
    job.phase = 'failed';
    pushMessage(job, job.error, 'error');
  } else if (job.cancelRequested) {
    job.cancelled = true;
    job.ok = false;
    job.phase = 'cancelled';
  } else {
    job.ok = true;
    job.phase = 'complete';
  }
}

export function getBookmarkJob() {
  return currentBookmarkJob || {
    running: false,
    done: false,
    ok: false,
    phase: 'idle',
    steps: null,
    messages: [],
  };
}

export function cancelBookmarkJob() {
  if (!currentBookmarkJob?.running) return getBookmarkJob();
  currentBookmarkJob.cancelRequested = true;
  pushMessage(currentBookmarkJob, 'Cancellation requested.', 'warn');
  return getBookmarkJob();
}

/**
 * Hard-reset the singleton so the next page render shows the empty
 * "ready for input" state. The Reset button on the panel calls this
 * once a job has finished. Refuses to clear an in-flight job.
 */
export function clearBookmarkJob() {
  if (currentBookmarkJob?.running) throw new Error('A bookmark job is currently running.');
  currentBookmarkJob = null;
}

/**
 * Stash a "lookup only" result on the singleton so the panel can render
 * the already-in-DB view after a clean redirect. Mirrors the shape of a
 * finished job so the same UI branches work.
 */
export function setBookmarkLookupOnly({ url, lookup }) {
  if (currentBookmarkJob?.running) throw new Error('A bookmark job is currently running.');
  currentBookmarkJob = {
    id: `${Date.now()}-bookmark-lookup`,
    url,
    postId: lookup.postId,
    running: false,
    done: true,
    ok: true,
    lookupOnly: true,
    cancelled: false,
    cancelRequested: false,
    error: null,
    phase: 'looked-up',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    pageTitle: null,
    extractedFile: null,
    creator: lookup.author,
    steps: null,
    counts: { videos: 0, thumbnails: 0, gifs: 0, comments: 0 },
    messages: [],
    savedRecords: lookup.videos,
    missing: lookup.missing,
  };
  return currentBookmarkJob;
}

/* ── Filename helpers ──────────────────────────────────────────────────── */

/**
 * Match the SoraVault video naming convention as closely as we can derive
 * from the extracted JSON: <attachment_id>_<YYYY-MM-DD>_<sanitized text>.
 * Length-capped to keep filesystems happy.
 */
function buildVideoBaseName(attachmentId, postedAt, text) {
  // Refuse anything that isn't a clean Sora attachment-id; the result is
  // used as a filesystem basename and a `..` here would let a malicious
  // payload write outside the creator folder.
  assertSafeBaseName(attachmentId, 'attachment_id');
  const date = postedAt ? String(postedAt).slice(0, 10) : 'nodate';
  const sanitized = sanitizeForFilename(text || '');
  const stem = `${attachmentId}_${date}${sanitized ? '_' + sanitized : ''}`;
  return stem.slice(0, 200);
}

function sanitizeForFilename(text) {
  return String(text || '')
    .replace(/[^\w\s-]/g, ' ')   // strip punctuation
    .trim()
    .replace(/\s+/g, '_')        // spaces -> underscores
    .replace(/_+/g, '_');        // collapse runs
}

function findExistingByPrefix(dir, baseName, allowedExts = null) {
  if (!fs.existsSync(dir)) return null;
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  const lower = baseName.toLowerCase() + '.';
  for (const n of names) {
    const nl = n.toLowerCase();
    if (!nl.startsWith(lower)) continue;
    if (allowedExts) {
      const ext = path.extname(n).slice(1).toLowerCase();
      if (!allowedExts.includes(ext)) continue;
    }
    return path.join(dir, n);
  }
  return null;
}

/* ── HTTP download ─────────────────────────────────────────────────────── */

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': '*/*',
};

function extFromContentType(ct, fallback = 'bin') {
  if (!ct) return fallback;
  const t = ct.toLowerCase().split(';')[0].trim();
  switch (t) {
    case 'video/mp4':  return 'mp4';
    case 'image/jpeg': case 'image/jpg': return 'jpg';
    case 'image/png':  return 'png';
    case 'image/gif':  return 'gif';
    case 'image/webp': return 'webp';
    default: return fallback;
  }
}

function downloadOnce(url, destDir, baseName, fallbackExt, forcedExt = null, hops = 0, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('Too many redirects'));
    // Allowlist check on every hop, including redirect targets.
    try { assertAllowedAssetUrl(url); }
    catch (e) { return reject(e); }
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('Invalid URL')); }
    const driver = parsed.protocol === 'https:' ? https : http;

    const req = driver.get(url, { headers: DEFAULT_HEADERS }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return downloadOnce(res.headers.location, destDir, baseName, fallbackExt, forcedExt, hops + 1, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
      }
      const ext = forcedExt || extFromContentType(res.headers['content-type'], fallbackExt);
      const filePath = path.join(destDir, `${baseName}.${ext}`);
      fs.mkdirSync(destDir, { recursive: true });
      const out = fs.createWriteStream(filePath);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve({ filePath, ext })));
      out.on('error', (err) => { try { fs.unlinkSync(filePath); } catch {} reject(err); });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`Timeout after ${timeoutMs}ms`)); });
    req.on('error', reject);
  });
}

/* ── Single-URL HTML fetch via Playwright ──────────────────────────────── */

const SUNSET_HINTS = ['sunset', 'no longer available'];

async function fetchSingleUrl(url, htmlDir) {
  const playwright = await runtimeImport('playwright');
  const browser = await launchChromium(playwright);
  try {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
    });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = response?.status() ?? 0;
    if (status >= 400) throw new Error(`HTTP ${status} from upstream`);

    const html = await page.content();
    const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();

    const hasSoraData = html.includes('__next_f');
    const lower = html.toLowerCase();
    const isSunset = !hasSoraData && SUNSET_HINTS.some((h) => lower.includes(h));
    if (!hasSoraData) {
      throw new Error(isSunset ? 'Got sunset/redirect page (no RSC payload)' : 'No RSC payload in response');
    }

    fs.mkdirSync(htmlDir, { recursive: true });
    const slug = `p_${extractPostIdFromUrl(url) || 'page'}`;
    const htmlFile = path.join(htmlDir, `${slug}.html`);
    fs.writeFileSync(htmlFile, html, 'utf8');

    return { htmlFile, slug, title: titleTag };
  } finally {
    try { await browser.close(); } catch {}
  }
}

/* ── Main orchestrator ─────────────────────────────────────────────────── */

function ensureNotBusy() {
  if (currentBookmarkJob?.running) {
    throw new Error('Another bookmark download is already running.');
  }
}

/**
 * Start a single-bookmark download. `topUpOnly = true` skips the network
 * fetch and re-extracts only missing assets — used by the "fill missing"
 * button when the post is already in the DB.
 */
export function startBookmarkJob({ url, topUpOnly = false }) {
  ensureNotBusy();
  const config = getConfig();
  if (!config) throw new Error('Setup not complete.');

  const postId = extractPostIdFromUrl(url);
  if (!postId) throw new Error('Not a Sora /p/ post URL.');

  const normalized = normalizeBookmarkUrl(url);
  const paths = ensureRefreshDirs(config.archivePath);

  currentBookmarkJob = createJob({
    url: normalized,
    postId,
    topUpOnly,
    archivePath: config.archivePath,
    dbPath: config.dbPath,
  });
  const job = currentBookmarkJob;

  setImmediate(async () => {
    try {
      job.phase = 'fetching';

      // Step 1: DB lookup (informational; the action layer already routed us here)
      setStep(job, 'dbcheck', 'running', 'Checking DB for existing record…');
      await closeDB();           // release the read connection so single-ingest can write later
      const dbHit = await lookupBookmarkInDb(postId);
      if (dbHit.found && !topUpOnly) {
        setStep(job, 'dbcheck', 'done', `Already in DB as videos.id ${dbHit.videos[0]?.id}.`);
        // The action layer should normally short-circuit here. Continuing
        // anyway is harmless — single-ingest will UPDATE rather than INSERT.
      } else if (dbHit.found && topUpOnly) {
        setStep(job, 'dbcheck', 'done', `Top-up mode for existing entry.`);
      } else {
        setStep(job, 'dbcheck', 'done', 'Not in DB — proceeding to download.');
      }

      // Verify Playwright is ready before doing anything else.
      const pw = await checkPlaywright({ probeBrowser: true });
      if (!pw.ok) {
        const hint = pw.reason === 'missing-package' ? 'npm install playwright && npx playwright install chromium'
                   : pw.reason === 'missing-browser' ? 'npx playwright install chromium'
                   : (pw.error || 'unknown');
        throw new Error(`Playwright not ready: ${hint}`);
      }

      // Step 2/3: fetch HTML
      setStep(job, 'fetch', 'running', 'Fetching SSR HTML with Playwright (JS disabled)…');
      const fetched = await fetchSingleUrl(job.url, paths.html);
      job.pageTitle = fetched.title || '(no title)';
      pushMessage(job, `Fetched: ${fetched.title || '(no title)'}`);
      setStep(job, 'fetch', 'done', `Page title: ${fetched.title || '(no title)'}`);

      // Step 4: extract JSON
      setStep(job, 'extract', 'running', 'Extracting RSC payload to JSON…');
      const ex = extractFromHtml(fetched.htmlFile);
      if (ex.error || !ex.payload) throw new Error(`Extract failed: ${ex.error || 'no payload'}`);

      const extractedFile = path.join(paths.extracted, `${fetched.slug}.extracted.json`);
      fs.writeFileSync(extractedFile, JSON.stringify(ex.payload, null, 2), 'utf8');
      job.extractedFile = extractedFile;
      job.counts.comments = ex.payload.comment_count || 0;
      const primary = ex.payload.posts.find((p) => p.post_id === postId) || ex.payload.posts[0];
      job.creator = primary?.author?.username || null;
      pushMessage(job, `${ex.payload.post_count} post(s), ${ex.payload.video_count} video(s), ${ex.payload.comment_count} comment(s).`);
      setStep(job, 'extract', 'done',
        `${ex.payload.video_count} video(s), ${ex.payload.comment_count} comment(s) by @${job.creator || '?'}`);

      if (!primary) throw new Error('Extracted JSON has no matching post.');
      const author = primary.author?.username;
      if (!author) throw new Error('Post has no author.username — cannot determine creator folder.');
      // Refuse to concatenate an unsafe username into a directory path —
      // throws with a clear message rather than letting `..` escape the
      // archive root. Sora's own backend constrains usernames to a small
      // alphanumeric set; this is defence-in-depth.
      assertSafeBaseName(author, 'author username');

      const creatorDir = path.join(config.archivePath, 'sora_v2_creators', author);
      const profilesDir = path.join(config.archivePath, 'profiles', author);
      const filePathsByAttachment = {};

      // Step 5: download video(s)
      setStep(job, 'video', 'running', `Downloading ${primary.videos?.length || 0} video(s) into ${author}/…`);
      let videoOk = 0, videoSkip = 0, videoFail = 0;
      for (const v of (primary.videos || [])) {
        if (!v?.attachment_id) continue;
        const baseName = buildVideoBaseName(v.attachment_id, primary.posted_at, primary.text);
        filePathsByAttachment[v.attachment_id] = filePathsByAttachment[v.attachment_id] || {};

        // Prefer no_watermark, fall back to source_wm, then source.
        const videoUrl = v.url_no_watermark || v.url_source_wm || v.url_source;
        if (!videoUrl) { videoFail++; pushMessage(job, `  no video URL for ${v.attachment_id}`, 'warn'); continue; }

        const existing = findExistingByPrefix(creatorDir, baseName, ['mp4']);
        if (existing) {
          videoSkip++;
          filePathsByAttachment[v.attachment_id].video = existing;
          pushMessage(job, `  skip mp4 (already on disk): ${path.basename(existing)}`);
          continue;
        }

        try {
          const r = await downloadOnce(videoUrl, creatorDir, baseName, 'mp4', 'mp4');
          videoOk++;
          filePathsByAttachment[v.attachment_id].video = r.filePath;
          pushMessage(job, `  ok mp4: ${path.basename(r.filePath)}`);
        } catch (e) {
          videoFail++;
          pushMessage(job, `  fail mp4 ${baseName}: ${e.message}`, 'warn');
        }
      }
      job.counts.videos = videoOk + videoSkip;
      setStep(job, 'video', 'done', `${videoOk}↓ ${videoSkip}=  ${videoFail}✗`);

      // Step 6: thumbnails
      setStep(job, 'thumbnail', 'running', 'Downloading thumbnails…');
      let tOk = 0, tSkip = 0, tFail = 0;
      for (const v of (primary.videos || [])) {
        if (!v?.url_thumbnail) continue;
        const baseName = buildVideoBaseName(v.attachment_id, primary.posted_at, primary.text);
        filePathsByAttachment[v.attachment_id] = filePathsByAttachment[v.attachment_id] || {};
        const existing = findExistingByPrefix(creatorDir, baseName, ['jpg', 'jpeg', 'png', 'webp']);
        if (existing) {
          tSkip++;
          filePathsByAttachment[v.attachment_id].thumbnail = existing;
          continue;
        }
        try {
          const r = await downloadOnce(v.url_thumbnail, creatorDir, baseName, 'jpg');
          tOk++;
          filePathsByAttachment[v.attachment_id].thumbnail = r.filePath;
        } catch (e) {
          tFail++;
          pushMessage(job, `  fail thumb ${baseName}: ${e.message}`, 'warn');
        }
      }
      job.counts.thumbnails = tOk + tSkip;
      setStep(job, 'thumbnail', 'done', `${tOk}↓ ${tSkip}=  ${tFail}✗`);

      // Step 7: gifs (preview_path)
      setStep(job, 'gif', 'running', 'Downloading GIF previews…');
      let gOk = 0, gSkip = 0, gFail = 0;
      for (const v of (primary.videos || [])) {
        if (!v?.url_gif) continue;
        const baseName = buildVideoBaseName(v.attachment_id, primary.posted_at, primary.text);
        filePathsByAttachment[v.attachment_id] = filePathsByAttachment[v.attachment_id] || {};
        const existing = findExistingByPrefix(creatorDir, baseName, ['gif']);
        if (existing) {
          gSkip++;
          filePathsByAttachment[v.attachment_id].preview = existing;
          continue;
        }
        try {
          const r = await downloadOnce(v.url_gif, creatorDir, baseName, 'gif', 'gif');
          gOk++;
          filePathsByAttachment[v.attachment_id].preview = r.filePath;
        } catch (e) {
          gFail++;
          pushMessage(job, `  fail gif ${baseName}: ${e.message}`, 'warn');
        }
      }
      job.counts.gifs = gOk + gSkip;
      setStep(job, 'gif', 'done', `${gOk}↓ ${gSkip}=  ${gFail}✗`);

      // Avatars (informally part of step 7 per the spec). Walks every profile
      // reachable from this payload — post author + comment authors + cameo
      // profiles + all_profiles — so the lightbox has portraits for everyone
      // who shows up around this video. Deduped by username; skip-if-exists.
      setStep(job, 'avatar', 'running', 'Collecting avatar URLs from this page…');
      const avatarMap = new Map();   // username -> profile_picture_url
      const addAvatar = (p) => {
        if (p?.username && p?.profile_picture_url && !avatarMap.has(p.username)) {
          avatarMap.set(p.username, p.profile_picture_url);
        }
      };
      for (const p of (ex.payload.all_profiles || [])) addAvatar(p);
      for (const post of (ex.payload.posts || [])) {
        addAvatar(post?.author);
        for (const c of (post?.comments || [])) addAvatar(c?.author);
        for (const cp of (post?.cameo_profiles || [])) {
          addAvatar(cp);
          addAvatar(cp?.owner_profile);
        }
      }

      let aOk = 0, aSkip = 0, aFail = 0;
      for (const [username, url] of avatarMap) {
        if (!isSafeBaseName(username)) {
          aFail++;
          if (aFail <= 3) pushMessage(job, `  skip avatar @${username}: unsafe username`, 'warn');
          continue;
        }
        const dir = path.join(config.archivePath, 'profiles', username);
        const existing = findExistingByPrefix(dir, `${username}.profile`);
        if (existing) { aSkip++; continue; }
        try {
          await downloadOnce(url, dir, `${username}.profile`, 'jpg');
          aOk++;
        } catch (e) {
          aFail++;
          // Quiet log — comment-author avatars failing is normal (expired
          // tokens, deleted accounts) and shouldn't flood the UI.
          if (aFail <= 3) pushMessage(job, `  fail avatar @${username}: ${e.message}`, 'warn');
        }
      }
      setStep(job, 'avatar', 'done', `${aOk}↓ ${aSkip}=  ${aFail}✗  (${avatarMap.size} unique profiles)`);

      // Step 8: ingest into DB
      setStep(job, 'ingest', 'running', 'Inserting into database…');
      const db = await getDB();
      const ingestStats = await ingestExtractedPayload(db, ex.payload, {
        filePaths: filePathsByAttachment,
        archiveRoot: config.archivePath,
      });
      setStep(job, 'ingest', 'done',
        `videos: ${ingestStats.videos.inserted} new / ${ingestStats.videos.updated} updated, ` +
        `comments: ${ingestStats.comments.inserted} new, ` +
        `profiles: ${ingestStats.profiles.upserted} upserted`);

      // Re-query so the panel can render clickable lightbox-trigger cards
      // pointing at the freshly-ingested rows. Same shape as the lookup
      // returned by the "already in DB" path.
      try {
        const after = await lookupBookmarkInDb(postId);
        if (after?.found) job.savedRecords = after.videos;
      } catch (e) {
        pushMessage(job, `Post-ingest lookup failed (non-fatal): ${e.message}`, 'warn');
      }

      finishJob(job);
    } catch (e) {
      finishJob(job, e);
    }
  });

  return job;
}
