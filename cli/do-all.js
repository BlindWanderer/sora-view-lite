#!/usr/bin/env node
/**
 * cli/do-all.js — standalone Sora HTML processor (creator-layout edition)
 *
 * Pipeline:
 *   1. Parse every *.html in the chosen input directory and write a matching
 *      <slug>.extracted.json (posts + profiles + SSR comments).
 *   2. Walk every JSON, download missing profile pictures into
 *      <root>/profiles/<username>/<username>.profile.<ext>.
 *   3. For every video attachment, if no matching .mp4 is on disk in the
 *      creator folder, download the best-quality .mp4 we can get
 *      (url_no_watermark → url_source_wm → url_source) into
 *      <root>/sora_v2_creators/<username>/<basename>.mp4.
 *   4. Walk every JSON, download missing thumbnails AND GIF previews into the
 *      author's creator folder, named to match either the existing .mp4 or
 *      (if no .mp4 was on disk and step 3 either couldn't or wouldn't fetch
 *      it) the SoraVault-style constructed basename
 *      (<attachment_id>_<YYYY-MM-DD>_<sanitized text>).
 *
 * No dependencies on the host project — only Node built-ins. Drop this file
 * anywhere with Node 18+ and it runs.
 *
 * Skip-if-exists is the policy for everything written. Re-running picks up
 * new HTML and new assets without redoing finished work.
 *
 * Usage:
 *   node cli/do-all.js [options]    (any missing path is prompted for)
 *
 * Options:
 *   --root        <dir>   Sora archive root (containing sora_v2_creators/ and profiles/)
 *   --input       <dir>   HTML files directory
 *   --extracted   <dir>   Where extracted.json lands  (default <root>/extracted)
 *   --concurrency <N>     Per-stage download workers  (default 4)
 *   --timeout     <ms>    Per-request timeout         (default 30000)
 *   --no-avatars          Skip profile-picture downloads
 *   --no-videos           Skip best-quality .mp4 downloads (only do thumbs/gifs/avatars)
 *   --no-thumbnails       Skip thumbnail downloads
 *   --no-gifs             Skip GIF preview downloads
 *   --yes                 Don't prompt to confirm before running
 *   --help                Show this help
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import os from 'os';
import { createInterface } from 'readline/promises';

/* ── CLI args ───────────────────────────────────────────────────────────── */

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(name); }

if (flag('--help') || flag('-h')) {
  console.log(`Usage:
  node cli/do-all.js [options]

  --root        <dir>   Sora archive root (sora_v2_creators/ + profiles/ live here)
  --input       <dir>   HTML files directory
  --extracted   <dir>   Where extracted.json lands  (default <root>/extracted)
  --concurrency <N>     Per-stage download workers  (default 4)
  --timeout     <ms>    Per-request timeout         (default 30000)
  --no-avatars          Skip profile-picture downloads
  --no-videos           Skip best-quality .mp4 downloads
  --no-thumbnails       Skip thumbnail downloads
  --no-gifs             Skip GIF preview downloads
  --yes                 Don't prompt to confirm before running

If --root or --input are omitted you'll be prompted for them.

Storage:
  Avatars     <root>/profiles/<username>/<username>.profile.<ext>
  Videos      <root>/sora_v2_creators/<username>/<basename>.mp4
  Thumbnails  <root>/sora_v2_creators/<username>/<basename>.<jpg|png|webp>
  GIFs        <root>/sora_v2_creators/<username>/<basename>.gif

<basename> is the existing .mp4's name when one is already on disk, otherwise
it is constructed as <attachment_id>_<YYYY-MM-DD>_<sanitized post text> so
the .mp4, thumb, and GIF all line up after a fresh fetch.

Best-quality video URL preference: url_no_watermark > url_source_wm > url_source.

Skip-if-exists is the policy for everything written.`);
  process.exit(0);
}

const CONCURRENCY = Number(arg('--concurrency', '4')) || 4;
const TIMEOUT_MS  = Number(arg('--timeout', '30000')) || 30000;
const DO_AVATARS    = !flag('--no-avatars');
const DO_VIDEOS     = !flag('--no-videos');
const DO_THUMBNAILS = !flag('--no-thumbnails');
const DO_GIFS       = !flag('--no-gifs');
const AUTO_YES      =  flag('--yes');

/* ── Path helpers ───────────────────────────────────────────────────────── */

function expandHome(p) {
  if (!p) return p;
  if (p === '~')      return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}
function resolvePath(p) { return path.resolve(expandHome(p)); }

/* ── Safety guards ──────────────────────────────────────────────────────
 *
 * Usernames and attachment-ids in the extracted payload are partly user-
 * controlled (a Sora user picks their username). Concatenating them into
 * a write path without checks would let a malicious entry escape the
 * archive root via `..` or path separators. Same idea for download URLs:
 * if we follow whatever URL the payload supplies, a poisoned page could
 * point us at internal services (SSRF) or arbitrary external hosts.
 *
 * The standalone CLI bakes the same checks the SvelteKit modules use so
 * the script stays dependency-free.
 */

const SAFE_BASE_NAME_RE = /^[A-Za-z0-9._@-]+$/;
function isSafeBaseName(name) {
  if (typeof name !== 'string') return false;
  if (name.length === 0 || name.length > 200) return false;
  if (/^\.+$/.test(name)) return false;
  if (name.startsWith('.')) return false;
  if (name.includes('\0')) return false;
  return SAFE_BASE_NAME_RE.test(name);
}

const ALLOWED_ASSET_HOSTS = new Set([
  'videos.openai.com',
  'cdn.openai.com',
  'sora.chatgpt.com',
]);
function isAllowedAssetUrl(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr) return false;
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  return ALLOWED_ASSET_HOSTS.has(u.hostname);
}

/* ── Filename construction ──────────────────────────────────────────────
 *
 * When we *don't* have an existing .mp4 to take a base filename from
 * (because the user is downloading the video for the first time), build
 * the same name SoraVault uses so the .mp4, thumbnail, and GIF all sit
 * next to each other with a shared stem and the next run's findMp4 will
 * line them up correctly.
 */

function sanitizeForFilename(text) {
  return String(text || '')
    .replace(/[^\w\s-]/g, ' ')   // strip punctuation Sora uses (quotes, periods, …)
    .trim()
    .replace(/\s+/g, '_')        // spaces → underscores
    .replace(/_+/g, '_');        // collapse runs
}

function buildVideoBaseName(attachmentId, postedAt, text) {
  // Caller has already validated attachment_id via isSafeBaseName.
  // postedAt is the ISO string from the extracted payload, or null.
  const date = postedAt ? String(postedAt).slice(0, 10) : 'nodate';
  const sanitized = sanitizeForFilename(text || '');
  const stem = `${attachmentId}_${date}${sanitized ? '_' + sanitized : ''}`;
  return stem.slice(0, 200);
}

/* ── RSC payload reassembly ─────────────────────────────────────────────── */

function extractRSCPayload(html) {
  const re = /self\.__next_f\.push\(\[1,\s*"([\s\S]*?)"\]\s*\)/g;
  let out = '';
  let m;
  while ((m = re.exec(html)) !== null) {
    try { out += JSON.parse('"' + m[1] + '"'); }
    catch { out += m[1]; }
  }
  return out;
}

function extractJSON(str, start) {
  if (str[start] !== '{') return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (esc)        { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"')  { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return str.slice(start, i + 1); }
  }
  return null;
}

function tryParseJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

/* ── Builders ───────────────────────────────────────────────────────────── */

function buildProfile(p) {
  if (!p) return null;
  return {
    user_id:               p.user_id,
    username:              p.username             || null,
    display_name:          p.display_name         || null,
    description:           p.description          || null,
    location:              p.location             || null,
    website:               p.website              || null,
    work:                  p.work                 || null,
    schools:               p.schools              || null,
    profile_picture_url:   p.profile_picture_url  || null,
    profile_picture_id:    p.profile_picture_id   || null,
    cover_photo_url:       p.cover_photo_url      || null,
    verified:              p.verified             ?? null,
    is_public_figure:      p.is_public_figure     ?? null,
    public_figure_name:    p.public_figure_name   || null,
    follower_count:        p.follower_count       ?? null,
    following_count:       p.following_count      ?? null,
    post_count:            p.post_count           ?? null,
    reply_count:           p.reply_count          ?? null,
    likes_received_count:  p.likes_received_count ?? null,
    remix_count:           p.remix_count          ?? null,
    cameo_count:           p.cameo_count          ?? null,
    character_count:       p.character_count      ?? null,
    plan_type:             p.plan_type            || null,
    permalink:             p.permalink            || null,
    created_at: p.created_at && isFinite(p.created_at) ? new Date(p.created_at * 1000).toISOString() : null,
    updated_at: p.updated_at && isFinite(p.updated_at) ? new Date(p.updated_at * 1000).toISOString() : null,
    banned_at:  p.banned_at  && isFinite(p.banned_at)  ? new Date(p.banned_at  * 1000).toISOString() : null,
  };
}

function buildCameoProfiles(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => ({
    user_id:              c.user_id,
    username:             c.username             || null,
    display_name:         c.display_name         || null,
    description:          c.description          || null,
    profile_picture_url:  c.profile_picture_url  || null,
    follower_count:       c.follower_count       ?? null,
    post_count:           c.post_count           ?? null,
    likes_received_count: c.likes_received_count ?? null,
    verified:             c.verified             ?? null,
    is_public_figure:     c.is_public_figure     ?? null,
    permalink:            c.permalink            || null,
    owner_profile: c.owner_profile ? {
      user_id:             c.owner_profile.user_id,
      username:            c.owner_profile.username            || null,
      display_name:        c.owner_profile.display_name        || null,
      profile_picture_url: c.owner_profile.profile_picture_url || null,
      verified:            c.owner_profile.verified            ?? null,
      permalink:           c.owner_profile.permalink           || null,
    } : null,
  }));
}

function buildAttachment(att) {
  const enc = att.encodings || {};
  return {
    attachment_id:        att.id,
    generation_id:        att.generation_id        || null,
    generation_type:      att.generation_type      || null,
    task_id:              att.task_id              || null,
    width:                att.width                ?? null,
    height:               att.height               ?? null,
    duration_s:           att.duration_s           ?? null,
    n_frames:             att.n_frames             ?? null,
    output_blocked:       att.output_blocked       ?? false,
    has_captions:         att.has_captions         ?? null,
    style:                att.style                || null,
    can_create_character: att.can_create_character ?? null,
    url_source:       enc.source?.path        || att.downloadable_url || null,
    url_source_wm:    enc.source_wm?.path     || null,
    url_md:           enc.md?.path            || null,
    url_ld:           enc.ld?.path            || null,
    url_no_watermark: att.download_urls?.no_watermark      || null,
    url_watermark:    att.download_urls?.watermark         || null,
    url_endcard_wm:   att.download_urls?.endcard_watermark || null,
    url_gif:          enc.gif?.path        || null,
    url_thumbnail:    enc.thumbnail?.path  || null,
    url_unfurl:       enc.unfurl?.path     || null,
    encoding_meta: {
      source:    enc.source    ? { size: enc.source.size,    ssim: enc.source.ssim,    duration_secs: enc.source.duration_secs } : null,
      md:        enc.md        ? { size: enc.md.size,        ssim: enc.md.ssim }        : null,
      ld:        enc.ld        ? { size: enc.ld.size,        ssim: enc.ld.ssim }        : null,
      gif:       enc.gif       ? { size: enc.gif.size }       : null,
      thumbnail: enc.thumbnail ? { size: enc.thumbnail.size } : null,
    },
  };
}

function buildComment(p, profileMap) {
  if (!p) return null;
  const profile = profileMap[p.shared_by] || null;
  const soraAtts = (p.attachments || []).filter((a) => (a.tags || []).includes('sora'));
  return {
    comment_id:            p.id,
    parent_post_id:        p.parent_post_id || null,
    root_post_id:          p.root_post_id   || null,
    text:                  p.text           || '',
    posted_at:  p.posted_at  ? new Date(p.posted_at  * 1000).toISOString() : null,
    updated_at: p.updated_at && isFinite(p.updated_at) ? new Date(p.updated_at * 1000).toISOString() : null,
    like_count:            p.like_count            ?? 0,
    dislike_count:         p.dislike_count         ?? 0,
    reply_count:           p.reply_count           ?? 0,
    recursive_reply_count: p.recursive_reply_count ?? 0,
    remix_count:           p.remix_count           ?? 0,
    view_count:            p.view_count            ?? 0,
    source:                p.source                || null,
    permalink:             p.permalink             || null,
    tombstoned_at:         p.tombstoned_at         || null,
    author: profile ? {
      user_id:             profile.user_id,
      username:            profile.username,
      display_name:        profile.display_name,
      profile_picture_url: profile.profile_picture_url,
      follower_count:      profile.follower_count,
      verified:            profile.verified,
      permalink:           profile.permalink,
    } : { user_id: p.shared_by, username: null, display_name: null, profile_picture_url: null },
    video_attachments: soraAtts.map(buildAttachment),
  };
}

function summarisePost(post, profileMap, commentsFromIC = null) {
  if (!post) return null;
  const soraAtts = (post.attachments || []).filter((a) => (a.tags || []).includes('sora'));
  const profile = profileMap[post.shared_by] || null;

  const commentItems = commentsFromIC ?? (post.children?.items || []);
  const comments = commentItems
    .map((ci) => buildComment(ci?.post ?? ci, profileMap))
    .filter((c) => c && (c.text || c.video_attachments?.length));

  const ancestors = (post.ancestors?.items || [])
    .map((ai) => (ai?.post ? summarisePost(ai.post, profileMap) : null))
    .filter(Boolean);

  const parent_post = post.parent_post?.post
    ? summarisePost(post.parent_post.post, profileMap)
    : null;

  const remix_thumbnails = (post.remix_posts?.items || [])
    .map((ri) => {
      if (!ri?.post) return null;
      const att = (ri.post.attachments || []).find((a) => (a.tags || []).includes('sora'));
      return {
        post_id:       ri.post.id,
        author:        profileMap[ri.post.shared_by]?.username || null,
        thumbnail_url: att?.encodings?.thumbnail?.path || null,
        like_count:    ri.post.like_count  ?? null,
        view_count:    ri.post.view_count  ?? null,
        remix_count:   ri.post.remix_count ?? null,
      };
    })
    .filter(Boolean);

  return {
    post_id:   post.id,
    shared_by: post.shared_by,
    permalink: post.permalink || null,
    source:    post.source    || null,
    posted_at:     post.posted_at     ? new Date(post.posted_at     * 1000).toISOString() : null,
    updated_at:    post.updated_at    ? new Date(post.updated_at    * 1000).toISOString() : null,
    tombstoned_at: post.tombstoned_at || null,
    text:                 post.text                 || '',
    caption:              post.caption              || null,
    og_title:             post.og_title             || null,
    og_description:       post.og_description       || null,
    emoji:                post.emoji                || null,
    discovery_phrase:     post.discovery_phrase     || null,
    topic_labels:         post.topic_labels         || [],
    audience_description: post.audience_description || null,
    story_type:           post.story_type           || null,
    like_count:            post.like_count            ?? null,
    dislike_count:         post.dislike_count         ?? null,
    view_count:            post.view_count            ?? null,
    unique_view_count:     post.unique_view_count     ?? null,
    share_count:           post.share_count           ?? null,
    repost_count:          post.repost_count          ?? null,
    remix_count:           post.remix_count           ?? null,
    reply_count:           post.reply_count           ?? null,
    recursive_reply_count: post.recursive_reply_count ?? null,
    user_liked:    post.user_liked    ?? null,
    user_disliked: post.user_disliked ?? null,
    has_reposted:  post.has_reposted  ?? null,
    is_owner:      post.is_owner      ?? null,
    is_featured:   post.is_featured   ?? null,
    posted_to_public: post.posted_to_public ?? null,
    post_locations:   post.post_locations   || [],
    visibility:       post.visibility       || null,
    permissions:      post.permissions      || null,
    srt_url: post.srt_url || null,
    vtt_url: post.vtt_url || null,
    parent_post_id:    post.parent_post_id    || null,
    root_post_id:      post.root_post_id      || null,
    parent_path:       post.parent_path       || [],
    repost_of_post_id: post.repost_of_post_id || null,
    author: profile ? buildProfile(profile) : { user_id: post.shared_by },
    cameo_profiles: buildCameoProfiles(post.cameo_profiles),
    videos: soraAtts.map(buildAttachment),
    comments,
    comments_cursor: post.children?.cursor || null,
    total_comments:  post.recursive_reply_count ?? null,
    ancestors,
    parent_post,
    remix_thumbnails,
    remixes_cursor: post.remix_posts?.cursor || null,
  };
}

function extractAllProfiles(payload) {
  const map = {};
  const re = /"profile"\s*:\s*\{/g;
  let m;
  while ((m = re.exec(payload)) !== null) {
    const obj = extractJSON(payload, m.index + m[0].length - 1);
    if (!obj) continue;
    const p = tryParseJSON(obj);
    if (p?.user_id && !map[p.user_id]) map[p.user_id] = buildProfile(p);
  }
  return map;
}

function extractEverything(payload) {
  const profileMap = extractAllProfiles(payload);
  const posts = [];
  const seen = new Set();

  const l15re = /"\$L15"\s*,\s*null\s*,\s*\{/g;
  let m;
  while ((m = l15re.exec(payload)) !== null) {
    const propsStart = m.index + m[0].lastIndexOf('{');
    const propsJSON = extractJSON(payload, propsStart);
    if (!propsJSON) continue;
    const props = tryParseJSON(propsJSON);
    if (!props) continue;
    const actualPost = props.post?.post;
    if (!actualPost?.id || !actualPost?.attachments) continue;
    if (seen.has(actualPost.id)) continue;
    seen.add(actualPost.id);
    const icItems = props.initialComments?.children?.items ?? null;
    posts.push(summarisePost(actualPost, profileMap, icItems));
  }

  const doubleRe = /"post"\s*:\s*\{"post"\s*:\s*\{/g;
  while ((m = doubleRe.exec(payload)) !== null) {
    const outerStart = m.index + m[0].indexOf(':{') + 1;
    const outer = tryParseJSON(extractJSON(payload, outerStart));
    const actualPost = outer?.post;
    if (!actualPost?.id || !actualPost?.attachments) continue;
    if (seen.has(actualPost.id)) continue;
    seen.add(actualPost.id);
    posts.push(summarisePost(actualPost, profileMap));
  }

  const postRe = /"post"\s*:\s*\{/g;
  while ((m = postRe.exec(payload)) !== null) {
    const obj = extractJSON(payload, m.index + m[0].length - 1);
    if (!obj) continue;
    const parsed = tryParseJSON(obj);
    if (!parsed?.id || !parsed?.attachments) continue;
    if (seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    posts.push(summarisePost(parsed, profileMap));
  }

  return { posts, all_profiles: Object.values(profileMap) };
}

/* ── HTTP download ──────────────────────────────────────────────────────── */

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
};

function extFromContentType(ct = '', fallback = 'jpg') {
  if (!ct) return fallback;
  const t = ct.toLowerCase().split(';')[0].trim();
  switch (t) {
    case 'image/jpeg':
    case 'image/jpg':  return 'jpg';
    case 'image/png':  return 'png';
    case 'image/gif':  return 'gif';
    case 'image/webp': return 'webp';
    default: return fallback;
  }
}

/**
 * If `forcedExt` is provided, the file is written as <baseName>.<forcedExt>
 * regardless of content-type. Otherwise the extension is sniffed from the
 * response.
 */
function downloadOnce(url, destDir, baseName, fallbackExt = 'jpg', forcedExt = null, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(Object.assign(new Error('Too many redirects'), { url }));
    // Host allowlist on every hop — including redirect targets — so an
    // attacker-controlled 302 can't pull us off Sora's CDN.
    if (!isAllowedAssetUrl(url)) {
      let host = '(unparseable)';
      try { host = new URL(url).hostname; } catch {}
      return reject(Object.assign(new Error(`Disallowed asset host: ${host}`), { url }));
    }
    let parsed;
    try { parsed = new URL(url); }
    catch { return reject(Object.assign(new Error('Invalid URL'), { url })); }
    const driver = parsed.protocol === 'https:' ? https : http;

    const req = driver.get(url, { headers: DEFAULT_HEADERS }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return downloadOnce(res.headers.location, destDir, baseName, fallbackExt, forcedExt, hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { url, status: res.statusCode }));
      }
      const ext = forcedExt || extFromContentType(res.headers['content-type'], fallbackExt);
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
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(Object.assign(new Error(`Timeout after ${TIMEOUT_MS}ms`), { url })); });
    req.on('error', (err) => reject(Object.assign(err, { url })));
  });
}

function findExistingByPrefix(dir, prefix, allowedExts = null) {
  if (!fs.existsSync(dir)) return null;
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  const lower = prefix.toLowerCase() + '.';
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

/**
 * Bounded-concurrency worker pool. Each item is a download task with its own
 * destDir, baseName, etc. — the worker consults item.skipReason to bail on
 * tasks the planner already decided couldn't run (e.g. no matching .mp4).
 */
async function downloadBatch(items, label) {
  let i = 0;
  let downloaded = 0, skipped = 0, failed = 0, plannerSkipped = 0;
  const reasons = new Map();   // skipReason -> count

  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];

      if (item.skipReason) {
        plannerSkipped++;
        reasons.set(item.skipReason, (reasons.get(item.skipReason) || 0) + 1);
      } else {
        try {
          const existing = findExistingByPrefix(item.destDir, item.baseName, item.skipIfExtIn);
          if (existing) { skipped++; }
          else {
            await downloadOnce(item.url, item.destDir, item.baseName, item.fallbackExt, item.forcedExt);
            downloaded++;
          }
        } catch (err) {
          failed++;
          if (failed <= 5) {
            process.stdout.write('\n');
            console.log(`    [fail ${label}] ${item.label || item.url}: ${err.message}`);
          }
        }
      }

      const done = downloaded + skipped + failed + plannerSkipped;
      if (done % 50 === 0 || done === items.length) {
        process.stdout.write(`\r    ${label}: ${downloaded}↓ ${skipped}=  ${failed}✗  (${done}/${items.length})  `);
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker());
  await Promise.all(workers);
  process.stdout.write('\n');
  if (failed > 5) console.log(`    (${failed - 5} more ${label} failures suppressed)`);
  for (const [r, n] of reasons) console.log(`    ${label}: ${n} skipped — ${r}`);
  return { downloaded, skipped: skipped + plannerSkipped, failed, total: items.length };
}

/* ── Walk extracted JSON to plan downloads ──────────────────────────────── */

function profileEntry(p) {
  if (!p?.username || !p?.profile_picture_url) return null;
  return { username: p.username, url: p.profile_picture_url };
}

/**
 * Single-pass planner. Walks every *.extracted.json once and builds the full
 * set of download tasks (avatars + thumbnails + gifs) in one go. Each
 * attachment_id is resolved against its creator's directory using a per-dir
 * readdir cache so we don't list the same folder hundreds of times.
 *
 * Emits progress every `progressEvery` files via onProgress({ index, total,
 * counts }) so the user sees motion on a 100k+ archive instead of a blank
 * cursor.
 */
function planAllAssets(jsonDir, paths, opts, onProgress) {
  const seenAvatars = new Map();   // username -> task
  const seenVideo   = new Set();   // attachment_id
  const seenThumb   = new Set();   // attachment_id
  const seenGif     = new Set();   // attachment_id
  const tasks = { avatars: [], videos: [], thumbs: [], gifs: [] };

  // Cache: creator-dir absolute path -> array of filenames (or null if dir
  // missing). One readdir per unique creator instead of per attachment_id.
  const creatorListCache = new Map();
  function listCreatorDir(dir) {
    if (creatorListCache.has(dir)) return creatorListCache.get(dir);
    let names = null;
    try { if (fs.existsSync(dir)) names = fs.readdirSync(dir); } catch {}
    creatorListCache.set(dir, names);
    return names;
  }

  /**
   * For an attachment_id, find its existing .mp4 file inside the creator's
   * directory. The video naming convention puts attachment_id somewhere in
   * the filename, so substring match works for both:
   *   s_<id>-attachment-N_YYYY-MM-DD_<text>.mp4
   *   YYYY-MM-DD-s_<id>-attachment-N_YYYY-MM-DD_<text>.mp4
   * Returns { baseName, mp4Name } or null when there's no match.
   */
  function findMp4(creatorDir, attachmentId) {
    const names = listCreatorDir(creatorDir);
    if (!names) return null;
    const needle = attachmentId.toLowerCase();
    for (const n of names) {
      const nl = n.toLowerCase();
      if (!nl.endsWith('.mp4')) continue;
      if (!nl.includes(needle)) continue;
      return { baseName: n.replace(/\.mp4$/i, ''), mp4Name: n };
    }
    return null;
  }

  const files = listExtractedJson(jsonDir);
  for (let i = 0; i < files.length; i++) {
    if (typeof onProgress === 'function') {
      onProgress(i, files.length, {
        avatars: seenAvatars.size,
        videos:  seenVideo.size,
        thumbs:  seenThumb.size,
        gifs:    seenGif.size,
        creators: creatorListCache.size,
      });
    }

    const file = files[i];
    let payload;
    try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }

    /* --- avatars --- */
    if (opts.avatars) {
      const candidates = [];
      for (const p of (payload.all_profiles || [])) candidates.push(profileEntry(p));
      for (const post of (payload.posts || [])) {
        candidates.push(profileEntry(post?.author));
        for (const c of (post?.comments || [])) candidates.push(profileEntry(c?.author));
        for (const cp of (post?.cameo_profiles || [])) {
          candidates.push(profileEntry(cp));
          candidates.push(profileEntry(cp?.owner_profile));
        }
        if (post?.parent_post) candidates.push(profileEntry(post.parent_post.author));
        for (const a of (post?.ancestors || [])) candidates.push(profileEntry(a?.author));
      }
      for (const e of candidates) {
        if (!e || seenAvatars.has(e.username)) continue;
        // Skip avatars whose username can't safely be used as a folder
        // name (path traversal, weird unicode, etc.). Better to lose an
        // avatar than write outside the archive.
        if (!isSafeBaseName(e.username)) continue;
        seenAvatars.set(e.username, {
          url: e.url,
          destDir: path.join(paths.profilesRoot, e.username),
          baseName: `${e.username}.profile`,
          fallbackExt: 'jpg',
          forcedExt: null,
          skipIfExtIn: null,
          label: '@' + e.username,
        });
      }
    }

    /* --- per-video planning: videos + thumbnails + gifs share the same
           findMp4 lookup. The whole block is gated on whether the user
           wants any of the three. The .mp4-lookup cache is per creator dir. */
    if (opts.videos || opts.thumbnails || opts.gifs) {
      const allPosts = [];
      for (const post of (payload.posts || [])) {
        allPosts.push(post);
        if (post.parent_post) allPosts.push(post.parent_post);
        for (const a of (post.ancestors || [])) allPosts.push(a);
      }
      for (const post of allPosts) {
        const username = post?.author?.username;
        if (!username) continue;
        // Refuse to concatenate an unsafe username into the creator-dir
        // path. The findMp4 lookup also reads from this directory, so a
        // poisoned username could otherwise read other parts of disk.
        if (!isSafeBaseName(username)) continue;
        const creatorDir = path.join(paths.creatorsRoot, username);

        for (const v of (post.videos || [])) {
          if (!v?.attachment_id) continue;
          // Reject attachment_ids that aren't a clean Sora id — they're
          // used both as a substring match against on-disk .mp4 names
          // and as part of the saved thumbnail / gif filename.
          if (!isSafeBaseName(v.attachment_id)) continue;

          // Resolve the .mp4 once per video. Both thumb + gif use the same
          // basename, and we decide whether to queue a fresh video download
          // based on this lookup.
          const match = findMp4(creatorDir, v.attachment_id);
          const videoUrl = v.url_no_watermark || v.url_source_wm || v.url_source;

          const wantsVideo = opts.videos && !match && videoUrl && !seenVideo.has(v.attachment_id);
          const wantsThumb = opts.thumbnails && v.url_thumbnail && !seenThumb.has(v.attachment_id);
          const wantsGif   = opts.gifs       && v.url_gif       && !seenGif.has(v.attachment_id);
          if (!wantsVideo && !wantsThumb && !wantsGif) continue;

          // If a matching .mp4 already exists on disk, inherit its basename
          // so the thumb/gif sit alongside it. Otherwise build the
          // SoraVault-style name (<attachment_id>_<YYYY-MM-DD>_<text>) so
          // the .mp4 we're about to download lines up with its thumb/gif.
          const baseName = match
            ? match.baseName
            : buildVideoBaseName(v.attachment_id, post.posted_at, post.text);

          if (wantsVideo) {
            seenVideo.add(v.attachment_id);
            tasks.videos.push({
              url: videoUrl,
              destDir: creatorDir,
              baseName,
              fallbackExt: 'mp4',
              forcedExt: 'mp4',                    // always .mp4 regardless of upstream type
              skipIfExtIn: ['mp4'],
              label: baseName + '.mp4',
              kind: 'video',
            });
          }

          if (wantsThumb) {
            seenThumb.add(v.attachment_id);
            tasks.thumbs.push({
              url: v.url_thumbnail,
              destDir: creatorDir,
              baseName,
              fallbackExt: 'jpg',
              forcedExt: null,                     // sniff from content-type
              skipIfExtIn: ['jpg', 'jpeg', 'png', 'webp'],
              label: baseName,
              kind: 'thumb',
            });
          }

          if (wantsGif) {
            seenGif.add(v.attachment_id);
            tasks.gifs.push({
              url: v.url_gif,
              destDir: creatorDir,
              baseName,
              fallbackExt: 'gif',
              forcedExt: 'gif',                    // always .gif regardless of content-type
              skipIfExtIn: ['gif'],
              label: baseName + '.gif',
              kind: 'gif',
            });
          }
        }
      }
    }
  }

  if (typeof onProgress === 'function') {
    onProgress(files.length, files.length, {
      avatars: seenAvatars.size,
      videos:  seenVideo.size,
      thumbs:  seenThumb.size,
      gifs:    seenGif.size,
      creators: creatorListCache.size,
    });
  }

  tasks.avatars = [...seenAvatars.values()];
  return tasks;
}

function listExtractedJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.extracted.json'))
    .map((f) => path.join(dir, f));
}

/* ── Interactive setup ──────────────────────────────────────────────────── */

async function promptForPaths() {
  let root  = arg('--root',  null);
  let input = arg('--input', null);
  let extracted = arg('--extracted', null);

  if (!root || !input || !process.stdin.isTTY === false) {
    // Only prompt if either path is missing and we have a real terminal.
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!root)  root  = (await rl.question('Sora archive root: ')).trim();
      if (!input) input = (await rl.question('HTML input directory: ')).trim();
    } finally {
      rl.close();
    }
  }
  if (!root || !input) {
    console.error('Both --root and --input are required.');
    process.exit(1);
  }

  root  = resolvePath(root);
  input = resolvePath(input);
  if (!extracted) extracted = path.join(root, 'extracted');
  else extracted = resolvePath(extracted);

  return {
    root,
    input,
    extracted,
    creatorsRoot: path.join(root, 'sora_v2_creators'),
    profilesRoot: path.join(root, 'profiles'),
  };
}

async function confirmAndShowEnvironment(p) {
  const checks = [
    { label: 'Sora archive root', path: p.root,         exists: fs.existsSync(p.root) },
    { label: 'HTML input',        path: p.input,        exists: fs.existsSync(p.input) },
    { label: 'sora_v2_creators',  path: p.creatorsRoot, exists: fs.existsSync(p.creatorsRoot) },
    { label: 'profiles',          path: p.profilesRoot, exists: fs.existsSync(p.profilesRoot) },
  ];

  console.log();
  for (const c of checks) {
    console.log(`  ${c.exists ? '✓' : '✗'} ${c.label.padEnd(20)} ${c.path}`);
  }
  console.log(`    extracted JSON       ${p.extracted}  (will be created)`);

  const fatal = !checks[0].exists || !checks[1].exists;
  if (fatal) {
    console.error('\nMissing required path(s). Aborting.');
    process.exit(1);
  }
  if (!checks[2].exists) {
    console.error(`\n⚠  sora_v2_creators/ not found under ${p.root}.`);
    console.error('   Thumbnails and GIFs need an existing video file to take their name from,');
    console.error('   so they will all skip until your videos are filed under that directory.');
  }
  if (!checks[3].exists && DO_AVATARS) {
    console.log(`\nNote: profiles/ does not yet exist at ${p.profilesRoot}; it will be created on the first download.`);
  }

  if (AUTO_YES) return;
  if (!process.stdin.isTTY) return;       // non-interactive caller — proceed

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question('\nProceed? [Y/n] ')).trim().toLowerCase();
    if (ans && ans !== 'y' && ans !== 'yes') {
      console.log('Aborted.');
      process.exit(0);
    }
  } finally {
    rl.close();
  }
}

/* ── Main ───────────────────────────────────────────────────────────────── */

async function main() {
  const p = await promptForPaths();
  await confirmAndShowEnvironment(p);

  fs.mkdirSync(p.extracted, { recursive: true });

  console.log();

  /* --- Step 1: HTML -> extracted.json --- */
  const htmlFiles = fs.readdirSync(p.input)
    .filter((f) => f.toLowerCase().endsWith('.html'))
    .sort();
  console.log(`[1] Extracting ${htmlFiles.length} HTML file(s)…`);

  let newCount = 0, skipCount = 0, failCount = 0;
  let totalPosts = 0, totalComments = 0, totalVideos = 0;
  for (let i = 0; i < htmlFiles.length; i++) {
    const name = htmlFiles[i];
    const slug = name.replace(/\.html$/i, '');
    const out  = path.join(p.extracted, `${slug}.extracted.json`);
    if (fs.existsSync(out)) { skipCount++; continue; }

    let html;
    try { html = fs.readFileSync(path.join(p.input, name), 'utf8'); }
    catch (e) { failCount++; console.log(`    [fail] ${name}: ${e.message}`); continue; }

    const payload = extractRSCPayload(html);
    if (!payload) { failCount++; console.log(`    [fail] ${name}: no RSC payload`); continue; }

    const { posts, all_profiles } = extractEverything(payload);
    if (!posts.length) { failCount++; console.log(`    [fail] ${name}: 0 posts`); continue; }

    const videos   = posts.reduce((n, p) => n + (p.videos?.length   || 0), 0);
    const comments = posts.reduce((n, p) => n + (p.comments?.length || 0), 0);

    fs.writeFileSync(out, JSON.stringify({
      source_file:   name,
      extracted_at:  new Date().toISOString(),
      post_count:    posts.length,
      video_count:   videos,
      comment_count: comments,
      profile_count: all_profiles.length,
      posts,
      all_profiles,
    }, null, 2), 'utf8');

    newCount++;
    totalPosts    += posts.length;
    totalVideos   += videos;
    totalComments += comments;

    if ((i + 1) % 100 === 0 || (i + 1) === htmlFiles.length) {
      process.stdout.write(`\r    ${i + 1}/${htmlFiles.length} (new=${newCount}, skipped=${skipCount}, failed=${failCount})  `);
    }
  }
  process.stdout.write('\n');
  console.log(`[1] Done — new=${newCount}, skipped=${skipCount}, failed=${failCount}.`);
  console.log(`    Totals: ${totalPosts} posts / ${totalVideos} videos / ${totalComments} comments\n`);

  /* --- Plan: single pass over all extracted.json files --- */
  if (!DO_AVATARS && !DO_VIDEOS && !DO_THUMBNAILS && !DO_GIFS) {
    console.log('All download types disabled. Done.');
    return;
  }

  const planStart = Date.now();
  const totalJsonFiles = listExtractedJson(p.extracted).length;
  console.log(`[plan] Scanning ${totalJsonFiles} extracted.json file(s) to collect download targets…`);
  const tasks = planAllAssets(p.extracted, p, {
    avatars:    DO_AVATARS,
    videos:     DO_VIDEOS,
    thumbnails: DO_THUMBNAILS,
    gifs:       DO_GIFS,
  }, (idx, total, counts) => {
    if (idx === total || idx % 500 === 0) {
      process.stdout.write(
        `\r    ${idx}/${total}  ` +
        `(${counts.avatars} avatars, ${counts.videos} videos, ${counts.thumbs} thumbs, ${counts.gifs} gifs ` +
        `from ${counts.creators} creator dirs)  `
      );
    }
  });
  process.stdout.write('\n');
  const planMs = Date.now() - planStart;
  console.log(`[plan] Done in ${(planMs / 1000).toFixed(1)}s — ` +
              `${tasks.avatars.length} avatars, ${tasks.videos.length} videos, ` +
              `${tasks.thumbs.length} thumbs, ${tasks.gifs.length} gifs.\n`);

  /* --- Step 2: avatars --- */
  if (DO_AVATARS) {
    console.log(`[2] Avatars: ${tasks.avatars.length} unique profile(s)…`);
    const r = await downloadBatch(tasks.avatars, 'avatars');
    console.log(`[2] avatars: ${r.downloaded}↓ ${r.skipped}=  ${r.failed}✗\n`);
  } else {
    console.log('[2] Avatars: skipped.\n');
  }

  /* --- Step 3: videos (best-quality .mp4 for any attachment without one) --- */
  if (DO_VIDEOS) {
    console.log(`[3] Videos: ${tasks.videos.length} missing .mp4(s)…`);
    const r = await downloadBatch(tasks.videos, 'videos');
    console.log(`[3] videos: ${r.downloaded}↓ ${r.skipped}=  ${r.failed}✗\n`);
  } else {
    console.log('[3] Videos: skipped.\n');
  }

  /* --- Step 4: thumbnails --- */
  if (DO_THUMBNAILS) {
    console.log(`[4] Thumbnails: ${tasks.thumbs.length} task(s)…`);
    const r = await downloadBatch(tasks.thumbs, 'thumbnails');
    console.log(`[4] thumbnails: ${r.downloaded}↓ ${r.skipped}=  ${r.failed}✗\n`);
  } else {
    console.log('[4] Thumbnails: skipped.\n');
  }

  /* --- Step 5: gifs --- */
  if (DO_GIFS) {
    console.log(`[5] GIFs: ${tasks.gifs.length} task(s)…`);
    const r = await downloadBatch(tasks.gifs, 'gifs');
    console.log(`[5] gifs: ${r.downloaded}↓ ${r.skipped}=  ${r.failed}✗\n`);
  } else {
    console.log('[5] GIFs: skipped.\n');
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
