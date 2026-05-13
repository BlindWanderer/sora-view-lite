import path from 'path';
import fs from 'fs';

/**
 * Tiny single-file ingest path. Used by the Bookmark download flow to push
 * one freshly-fetched extracted.json into the existing videos / comments /
 * creator_profiles tables without triggering a full archive rescan.
 *
 * Mirrors the upsert semantics from ingestSoraArchive but only for the
 * specific post(s) the bookmark touched. Idempotent — re-running on the
 * same payload is safe.
 *
 * Inputs:
 *   db           — open DB client (sqlite-better-sqlite3 or duckdb wrapper)
 *   payload      — parsed extracted.json contents ({ posts, all_profiles })
 *   filePaths    — { [attachment_id]: { video, thumbnail, preview } }  absolute or vault-relative paths to record
 *   archiveRoot  — vault root, used to compute relative paths for `videos.file_path`
 */
export async function ingestExtractedPayload(db, payload, { filePaths = {}, archiveRoot } = {}) {
  const stats = {
    videos:   { inserted: 0, updated: 0 },
    comments: { inserted: 0 },
    profiles: { upserted: 0 },
  };

  const posts = Array.isArray(payload?.posts) ? payload.posts : [];
  const now = new Date().toISOString();

  // ── Profiles (author + cameo + comment authors) ──────────────────────────
  const profileMap = new Map();
  for (const p of (payload.all_profiles || [])) {
    if (p?.username) profileMap.set(p.username, p);
  }
  for (const post of posts) {
    if (post?.author?.username) profileMap.set(post.author.username, post.author);
    for (const c of (post.comments || [])) {
      if (c?.author?.username) profileMap.set(c.author.username, c.author);
    }
  }
  for (const profile of profileMap.values()) {
    await upsertOneProfile(db, profile, now);
    stats.profiles.upserted++;
  }

  // ── Videos: one row per attachment that has a downloaded local mp4 ──────
  for (const post of posts) {
    if (!post?.post_id) continue;
    const author = post.author?.username || null;
    const date = post.posted_at ? String(post.posted_at).slice(0, 10) : null;

    for (const v of (post.videos || [])) {
      const paths = filePaths[v.attachment_id];
      if (!paths?.video) continue;   // only record videos we actually have on disk
      const filePath = path.isAbsolute(paths.video) ? paths.video : path.join(archiveRoot, paths.video);
      let fileSize = null;
      try { fileSize = fs.statSync(filePath).size; } catch {}

      const row = {
        file_path: filePath,
        file_size: fileSize,
        filename:  path.basename(filePath),
        generation_id: v.generation_id || null,
        task_id: v.task_id || null,
        post_id: post.post_id,
        parent_post_id: post.parent_post_id || null,
        root_post_id:   post.root_post_id || null,
        parent_generation_id: null,
        parent_task_id: null,
        author,
        date,
        duration_s: v.duration_s ?? null,
        width:  v.width  ?? null,
        height: v.height ?? null,
        aspect_ratio: aspectRatio(v.width, v.height),
        liked: null,
        like_count:   post.like_count   ?? null,
        view_count:   post.view_count   ?? null,
        remix_count:  post.remix_count  ?? null,
        reply_count:  post.reply_count  ?? null,
        share_count:  post.share_count  ?? null,
        prompt: post.text || null,
        source: post.source || 'bookmark',
        source_dir: 'sora_v2_creators',
        thumbnail_path: paths.thumbnail || null,
        preview_path:   paths.preview   || null,
        metadata_source: 'bookmark_extracted_json',
        has_txt: 0,
      };

      const existing = await db.get('SELECT id FROM videos WHERE file_path = ?', [row.file_path]);
      if (existing) {
        await db.run(`UPDATE videos SET file_size=?, filename=?, generation_id=?, task_id=?, post_id=?, parent_post_id=?, root_post_id=?, parent_generation_id=?, parent_task_id=?,
          author=?, date=?, duration_s=?, width=?, height=?, aspect_ratio=?, liked=?, like_count=?, view_count=?, remix_count=?, reply_count=?, share_count=?,
          prompt=?, source=?, source_dir=?, thumbnail_path=?, preview_path=?, metadata_source=?, has_txt=?
          WHERE file_path=?`, [
          row.file_size, row.filename, row.generation_id, row.task_id, row.post_id, row.parent_post_id, row.root_post_id, row.parent_generation_id, row.parent_task_id,
          row.author, row.date, row.duration_s, row.width, row.height, row.aspect_ratio, row.liked, row.like_count, row.view_count, row.remix_count, row.reply_count, row.share_count,
          row.prompt, row.source, row.source_dir, row.thumbnail_path, row.preview_path, row.metadata_source, row.has_txt,
          row.file_path,
        ]);
        stats.videos.updated++;
      } else {
        await db.run(`INSERT INTO videos
          (file_path, file_size, filename, generation_id, task_id, post_id, parent_post_id, root_post_id, parent_generation_id, parent_task_id,
           author, date, duration_s, width, height, aspect_ratio, liked, like_count, view_count, remix_count, reply_count, share_count,
           prompt, source, source_dir, thumbnail_path, preview_path, metadata_source, has_txt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          row.file_path, row.file_size, row.filename, row.generation_id, row.task_id, row.post_id, row.parent_post_id, row.root_post_id, row.parent_generation_id, row.parent_task_id,
          row.author, row.date, row.duration_s, row.width, row.height, row.aspect_ratio, row.liked, row.like_count, row.view_count, row.remix_count, row.reply_count, row.share_count,
          row.prompt, row.source, row.source_dir, row.thumbnail_path, row.preview_path, row.metadata_source, row.has_txt,
        ]);
        stats.videos.inserted++;
      }
    }
  }

  // ── Comments (only for the primary post) ────────────────────────────────
  const insertCommentSql = db.engine === 'duckdb'
    ? `INSERT INTO comments
       (comment_id, parent_post_id, root_post_id, author_username, author_user_id, text, posted_at, updated_at, tombstoned_at, like_count, dislike_count, reply_count, recursive_reply_count, view_count, remix_count, permalink, source, attachments_json, source_file, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
    : `INSERT OR IGNORE INTO comments
       (comment_id, parent_post_id, root_post_id, author_username, author_user_id, text, posted_at, updated_at, tombstoned_at, like_count, dislike_count, reply_count, recursive_reply_count, view_count, remix_count, permalink, source, attachments_json, source_file, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  for (const post of posts) {
    if (!post?.post_id) continue;
    for (const c of (post.comments || [])) {
      if (!c?.comment_id) continue;
      await db.run(insertCommentSql, [
        String(c.comment_id),
        c.parent_post_id || post.post_id,
        c.root_post_id   || post.root_post_id || null,
        c.author?.username || null,
        c.author?.user_id  || null,
        c.text ?? null,
        c.posted_at  || null,
        c.updated_at || null,
        c.tombstoned_at || null,
        c.like_count    ?? 0,
        c.dislike_count ?? 0,
        c.reply_count   ?? 0,
        c.recursive_reply_count ?? 0,
        c.view_count   ?? 0,
        c.remix_count  ?? 0,
        c.permalink || null,
        c.source    || 'bookmark',
        c.video_attachments?.length ? JSON.stringify(c.video_attachments) : null,
        'bookmark',
        now,
      ]);
      stats.comments.inserted++;
    }
  }

  // Recompute comment_count for the primary post(s) so the UI reflects new comments.
  for (const post of posts) {
    if (!post?.post_id) continue;
    await db.run(
      `UPDATE videos SET comment_count = (SELECT COUNT(*) FROM comments WHERE parent_post_id = ?) WHERE post_id = ?`,
      [post.post_id, post.post_id],
    );
  }

  return stats;
}

function aspectRatio(w, h) {
  if (!w || !h) return null;
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Number(w), Number(h));
  return `${w / g}:${h / g}`;
}

/**
 * Tiny single-row creator-profile upsert. The full ingest path has a richer
 * helper but we only need the basics here. Engine-aware: SQLite uses
 * ON CONFLICT, DuckDB uses DELETE + INSERT (matching the existing pattern).
 */
async function upsertOneProfile(db, p, now) {
  if (!p?.username) return;
  const verified         = p.verified         == null ? null : (p.verified ? 1 : 0);
  const isPublicFigure   = p.is_public_figure == null ? null : (p.is_public_figure ? 1 : 0);
  const params = [
    p.username, p.display_name || null, p.description || null,
    p.follower_count ?? null, p.following_count ?? null, p.post_count ?? null, p.reply_count ?? null,
    p.likes_received_count ?? null, p.remix_count ?? null, p.cameo_count ?? null, p.character_count ?? null,
    null, // raw_json — we don't have the original chunk here
    p.user_id || null, verified, isPublicFigure, p.permalink || null, now,
  ];

  if (db.engine === 'duckdb') {
    const existing = await db.get('SELECT avatar_ext FROM creator_profiles WHERE username = ?', [p.username]);
    const preservedExt = existing?.avatar_ext || null;
    await db.run(`DELETE FROM creator_profiles WHERE username = ?`, [p.username]);
    await db.run(`INSERT INTO creator_profiles
      (username, display_name, description, follower_count, following_count, post_count, reply_count, likes_received_count, remix_count, cameo_count, character_count, raw_json, user_id, verified, is_public_figure, permalink, first_seen_at, avatar_ext)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...params, preservedExt]);
  } else {
    await db.run(`INSERT INTO creator_profiles
      (username, display_name, description, follower_count, following_count, post_count, reply_count, likes_received_count, remix_count, cameo_count, character_count, raw_json, user_id, verified, is_public_figure, permalink, first_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        display_name=COALESCE(excluded.display_name, creator_profiles.display_name),
        description=COALESCE(excluded.description, creator_profiles.description),
        follower_count=COALESCE(excluded.follower_count, creator_profiles.follower_count),
        following_count=COALESCE(excluded.following_count, creator_profiles.following_count),
        post_count=COALESCE(excluded.post_count, creator_profiles.post_count),
        reply_count=COALESCE(excluded.reply_count, creator_profiles.reply_count),
        likes_received_count=COALESCE(excluded.likes_received_count, creator_profiles.likes_received_count),
        remix_count=COALESCE(excluded.remix_count, creator_profiles.remix_count),
        cameo_count=COALESCE(excluded.cameo_count, creator_profiles.cameo_count),
        character_count=COALESCE(excluded.character_count, creator_profiles.character_count),
        user_id=COALESCE(excluded.user_id, creator_profiles.user_id),
        verified=COALESCE(excluded.verified, creator_profiles.verified),
        is_public_figure=COALESCE(excluded.is_public_figure, creator_profiles.is_public_figure),
        permalink=COALESCE(excluded.permalink, creator_profiles.permalink)`, params);
  }
}
