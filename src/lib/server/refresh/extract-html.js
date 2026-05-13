import fs from 'fs';
import path from 'path';

/**
 * Extracts ALL available metadata from saved Sora HTML post pages.
 *
 * Sora's data lives in Next.js RSC payload chunks emitted as
 * `self.__next_f.push([1, "..."])` calls. There are three locations a post
 * may appear in within those chunks; we try all of them and dedupe by post id:
 *
 *   1. $L15 component props -> { post: { post: FULL_POST, profile }, initialComments }
 *      The page-rendering component. Contains the full attachments + the
 *      first SSR page of comments.
 *
 *   2. Double-nested "post":{"post":{...}}
 *      Used by profile/feed pages with multiple posts.
 *
 *   3. Direct "post":{id, attachments}
 *      Catches ancestors, video replies, and standalone posts.
 *
 * Output (one file per HTML input) mirrors the format the rest of the app
 * already reads from: <slug>.extracted.json with { posts, all_profiles }.
 *
 * Replace policy mirrors fetch-html: <7 days old extracted.json files are
 * skipped, older files are re-extracted with success-only replace into
 * _refresh/archive/<date>/. "Success" here means at least 1 post was found
 * (a 0-post extraction is treated as failure so we don't blow away good data).
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/* -- RSC payload reassembly -------------------------------------------------*/

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

/* -- Profile builders -------------------------------------------------------*/

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

/* -- Attachment + comment + post builders -----------------------------------*/

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

/* -- Main extractor (3 strategies, deduped) ---------------------------------*/

function extractEverything(payload) {
  const profileMap = extractAllProfiles(payload);
  const posts = [];
  const seen = new Set();

  // Strategy 1: $L15 component props (page-rendering post + initialComments)
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

  // Strategy 2: profile/feed pages — "post":{"post":{...}} double-nested
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

  // Strategy 3: direct "post":{id, attachments} — ancestors, replies, etc.
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

/* -- File-level orchestration ----------------------------------------------*/

/**
 * Run extraction for a single HTML file and return a report. Does not write
 * anything to disk — caller decides based on the success/failure result and
 * the age-replace policy.
 */
export function extractFromHtml(htmlFile) {
  const result = {
    sourceFile: htmlFile,
    posts: 0,
    videos: 0,
    comments: 0,
    profiles: 0,
    payload: null, // { source_file, extracted_at, post_count, ..., posts, all_profiles }
    error: null,
  };

  let html;
  try {
    html = fs.readFileSync(htmlFile, 'utf8');
  } catch (e) {
    result.error = `Read error: ${e.message}`;
    return result;
  }

  const rsc = extractRSCPayload(html);
  if (!rsc) {
    result.error = 'No RSC payload (__next_f) found in HTML';
    return result;
  }

  const { posts, all_profiles } = extractEverything(rsc);
  if (!posts.length) {
    result.error = 'RSC payload had no posts';
    return result;
  }

  const videos   = posts.reduce((n, p) => n + (p.videos?.length   || 0), 0);
  const comments = posts.reduce((n, p) => n + (p.comments?.length || 0), 0);

  result.posts    = posts.length;
  result.videos   = videos;
  result.comments = comments;
  result.profiles = all_profiles.length;
  result.payload = {
    source_file:   path.basename(htmlFile),
    extracted_at:  new Date().toISOString(),
    post_count:    posts.length,
    video_count:   videos,
    comment_count: comments,
    profile_count: all_profiles.length,
    posts,
    all_profiles,
  };
  return result;
}

/**
 * Decide what to do for a given output extracted.json file given the age
 * policy. Pure function — no I/O beyond a single stat.
 *
 * Returns 'skip-fresh' | 'extract-new' | 'extract-refresh'.
 */
export function decideExtractAction(extractedFile, { now = Date.now(), maxAgeMs = SEVEN_DAYS_MS } = {}) {
  if (!fs.existsSync(extractedFile)) return 'extract-new';
  let mtimeMs;
  try { mtimeMs = fs.statSync(extractedFile).mtimeMs; }
  catch { return 'extract-refresh'; }
  return (now - mtimeMs) < maxAgeMs ? 'skip-fresh' : 'extract-refresh';
}

function archiveOldExtracted(jsonFile, archiveDir) {
  if (!fs.existsSync(jsonFile)) return null;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(archiveDir, dateStamp);
  fs.mkdirSync(dest, { recursive: true });
  const baseName = path.basename(jsonFile);
  let target = path.join(dest, baseName);
  let i = 1;
  while (fs.existsSync(target)) {
    target = path.join(dest, baseName.replace(/\.json$/i, `.${i}.json`));
    i++;
  }
  fs.renameSync(jsonFile, target);
  return target;
}

/**
 * Process every *.html in htmlDir. For each file, extract and write a
 * matching <basename>.extracted.json into outputDir. Apply age-replace policy
 * with archiveDir as the archive target.
 */
export function extractHtmlBatch(opts) {
  const {
    htmlDir,
    outputDir,
    archiveDir,
    callbacks = {},
    maxAgeMs = SEVEN_DAYS_MS,
  } = opts;

  const stats = {
    total: 0,
    extractedNew: 0,
    refreshed: 0,
    skippedFresh: 0,
    failed: 0,
    keptOriginal: 0,
    archived: 0,
    totalPosts: 0,
    totalVideos: 0,
    totalComments: 0,
    errors: [],
  };

  const onProgress = typeof callbacks.onProgress === 'function' ? callbacks.onProgress : () => {};
  const shouldCancel = typeof callbacks.shouldCancel === 'function' ? callbacks.shouldCancel : () => false;

  if (!fs.existsSync(htmlDir)) {
    stats.errors.push(`Input dir does not exist: ${htmlDir}`);
    return stats;
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  const files = fs.readdirSync(htmlDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.html'))
    .map((e) => path.join(htmlDir, e.name))
    .sort();

  stats.total = files.length;

  for (let i = 0; i < files.length; i++) {
    if (shouldCancel()) break;
    const htmlFile = files[i];
    const basename = path.basename(htmlFile, '.html');
    const outFile = path.join(outputDir, `${basename}.extracted.json`);
    const decision = decideExtractAction(outFile, { maxAgeMs });

    if (decision === 'skip-fresh') {
      stats.skippedFresh++;
      onProgress({ index: i, total: files.length, file: htmlFile, decision, status: 'skipped' });
      continue;
    }

    const isRefresh = decision === 'extract-refresh';
    const r = extractFromHtml(htmlFile);

    if (r.error || !r.payload) {
      stats.failed++;
      if (isRefresh) stats.keptOriginal++;
      stats.errors.push({ file: path.basename(htmlFile), error: r.error || 'unknown' });
      onProgress({ index: i, total: files.length, file: htmlFile, decision, status: 'failed', error: r.error });
      continue;
    }

    if (isRefresh) {
      const archived = archiveOldExtracted(outFile, archiveDir);
      if (archived) stats.archived++;
    }

    fs.writeFileSync(outFile, JSON.stringify(r.payload, null, 2), 'utf8');

    if (isRefresh) stats.refreshed++;
    else stats.extractedNew++;
    stats.totalPosts    += r.posts;
    stats.totalVideos   += r.videos;
    stats.totalComments += r.comments;

    onProgress({
      index: i, total: files.length, file: htmlFile, decision, status: 'ok',
      outFile, posts: r.posts, videos: r.videos, comments: r.comments, profiles: r.profiles,
    });
  }

  return stats;
}
