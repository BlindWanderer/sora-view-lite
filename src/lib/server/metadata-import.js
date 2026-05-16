import fs from 'fs';
import path from 'path';

/**
 * Merge an exported sora-view-metadata.json into the live catalog.
 *
 * Match policy: COALESCE / "fill in NULL fields" (the user explicitly chose
 * this over add-only and over destructive overwrite). For each video in the
 * JSON we look up the local row by stable cross-machine identifiers — in
 * preference order: generation_id, then post_id, then file_path — and fill
 * any column that's currently NULL/empty with the value from the JSON.
 * Non-null DB values are preserved.
 *
 * Local-only flags (local_favorite, hidden, reviewed, local_notes) and the
 * local PK (id) are never carried over: those are decisions about THIS
 * machine's library, not portable metadata.
 *
 * Returns a counts object the UI can render directly.
 */

const PORTABLE_VIDEO_COLUMNS = [
  'filename', 'file_path', 'author', 'date', 'duration_s',
  'width', 'height', 'prompt', 'source_dir', 'liked',
  'generation_id', 'task_id',
  'post_id', 'parent_post_id', 'root_post_id', 'parent_generation_id', 'parent_task_id',
  'like_count', 'view_count', 'remix_count', 'reply_count', 'share_count', 'comment_count',
  'thumbnail_path', 'preview_path',
];

const PORTABLE_CREATOR_COLUMNS = [
  'display_name', 'description', 'follower_count', 'following_count',
  'post_count', 'reply_count', 'likes_received_count', 'remix_count',
  'cameo_count', 'character_count', 'raw_json', 'user_id', 'verified',
  'is_public_figure', 'permalink', 'first_seen_at', 'avatar_ext',
];

const PORTABLE_CHARACTER_COLUMNS = [
  'display_name', 'owner_username', 'description',
  'likes_received_count', 'remix_count', 'cameo_count', 'raw_json',
];

// Comments are keyed on Sora's comment_id (cross-machine stable). They link
// to videos by parent_post_id (Sora's post_id), so no local-id remapping is
// needed — just INSERT OR IGNORE and the videos.comment_count denorm
// catches up after the fact.
const PORTABLE_COMMENT_COLUMNS = [
  'comment_id', 'parent_post_id', 'root_post_id',
  'author_username', 'author_user_id', 'text',
  'posted_at', 'updated_at', 'tombstoned_at',
  'like_count', 'dislike_count', 'reply_count', 'recursive_reply_count',
  'view_count', 'remix_count', 'permalink', 'source',
  'attachments_json', 'source_file', 'first_seen_at',
];

function isEmpty(v) {
  return v === null || v === undefined || v === '';
}

/**
 * Build a Map<key, local_id> we can use to match JSON videos to the
 * catalog. We index three ways and consult them in order so the strongest
 * key wins (generation_id is per-video, post_id can repeat).
 */
async function buildVideoMatchIndex(db) {
  const rows = await db.all(
    `SELECT id, generation_id, post_id, file_path FROM videos`
  );
  const byGen = new Map();
  const byPost = new Map();
  const byPath = new Map();
  for (const r of rows) {
    if (r.generation_id) byGen.set(String(r.generation_id), r.id);
    if (r.post_id && !byPost.has(String(r.post_id))) byPost.set(String(r.post_id), r.id);
    if (r.file_path && !byPath.has(String(r.file_path))) byPath.set(String(r.file_path), r.id);
  }
  return { byGen, byPost, byPath };
}

function findLocalId(idx, jsonVideo) {
  if (jsonVideo.generation_id && idx.byGen.has(String(jsonVideo.generation_id))) {
    return idx.byGen.get(String(jsonVideo.generation_id));
  }
  if (jsonVideo.post_id && idx.byPost.has(String(jsonVideo.post_id))) {
    return idx.byPost.get(String(jsonVideo.post_id));
  }
  if (jsonVideo.file_path && idx.byPath.has(String(jsonVideo.file_path))) {
    return idx.byPath.get(String(jsonVideo.file_path));
  }
  return null;
}

async function mergeOneVideo(db, localId, jsonVideo, existingRow) {
  // Only update columns that are currently empty in the DB.
  const sets = [];
  const params = [];
  let filled = 0;
  for (const col of PORTABLE_VIDEO_COLUMNS) {
    if (!(col in jsonVideo)) continue;
    if (isEmpty(jsonVideo[col])) continue;
    if (!isEmpty(existingRow[col])) continue;
    sets.push(`${col} = ?`);
    params.push(jsonVideo[col]);
    filled++;
  }
  if (!sets.length) return 0;
  params.push(localId);
  await db.run(`UPDATE videos SET ${sets.join(', ')} WHERE id = ?`, params);
  return filled;
}

async function mergeOneProfile(db, table, key, keyCol, jsonRow, columns) {
  const existing = await db.get(`SELECT * FROM ${table} WHERE ${keyCol} = ?`, [key]);
  if (!existing) {
    // Insert with whatever portable columns we have.
    const cols = [keyCol];
    const placeholders = ['?'];
    const params = [key];
    for (const col of columns) {
      if (!(col in jsonRow) || isEmpty(jsonRow[col])) continue;
      cols.push(col); placeholders.push('?'); params.push(jsonRow[col]);
    }
    await db.run(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
      params
    );
    return { inserted: 1, enriched: 0 };
  }
  // Existing row — fill empty fields only.
  const sets = [];
  const params = [];
  for (const col of columns) {
    if (!(col in jsonRow) || isEmpty(jsonRow[col])) continue;
    if (!isEmpty(existing[col])) continue;
    sets.push(`${col} = ?`); params.push(jsonRow[col]);
  }
  if (!sets.length) return { inserted: 0, enriched: 0 };
  params.push(key);
  await db.run(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${keyCol} = ?`, params);
  return { inserted: 0, enriched: 1 };
}

/**
 * Validate a parsed JSON payload before doing any DB work. Returns
 * { ok: true } or { ok: false, reason }. Keeps the import endpoint thin.
 */
export function validateImportPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'not a JSON object' };
  if (!Array.isArray(parsed.videos)) return { ok: false, reason: 'missing "videos" array' };
  return { ok: true };
}

/**
 * Apply a parsed metadata JSON to the live DB. Idempotent — running twice
 * does no harm beyond the cost of touching every row. Errors on individual
 * rows are swallowed and counted; one bad row doesn't abort the whole merge.
 */
export async function applyMetadataImport(db, parsed) {
  const idx = await buildVideoMatchIndex(db);
  const stats = {
    schema_version: parsed.schema_version ?? null,
    exported_at:    parsed.exported_at ?? null,
    videos: {
      total_in_json:   (parsed.videos || []).length,
      matched_on_disk: 0,
      orphans:         0,
      fields_filled:   0,
      errors:          0,
    },
    cameos:             { inserted: 0, skipped: 0, errors: 0 },
    creator_profiles:   { inserted: 0, enriched: 0, errors: 0 },
    character_profiles: { inserted: 0, enriched: 0, errors: 0 },
    comments:           { total_in_json: 0, inserted: 0, attached_to_video: 0, orphans: 0, errors: 0 },
  };

  // ── Videos ──
  // Pre-fetch each matched row so we can do per-column COALESCE in JS.
  for (const v of (parsed.videos || [])) {
    const localId = findLocalId(idx, v);
    if (!localId) { stats.videos.orphans++; continue; }
    stats.videos.matched_on_disk++;
    try {
      const existing = await db.get(`SELECT * FROM videos WHERE id = ?`, [localId]);
      if (!existing) { stats.videos.orphans++; stats.videos.matched_on_disk--; continue; }
      const filled = await mergeOneVideo(db, localId, v, existing);
      stats.videos.fields_filled += filled;
    } catch {
      stats.videos.errors++;
    }
  }

  // Build remap: json video id (if present) → local id, so cameos can be
  // attached to the right local row.
  const jsonIdToLocal = new Map();
  for (const v of (parsed.videos || [])) {
    if (v.id == null) continue;
    const localId = findLocalId(idx, v);
    if (localId) jsonIdToLocal.set(v.id, localId);
  }

  // ── Cameos ── (only for videos we matched)
  for (const c of (parsed.cameos || [])) {
    const localId = jsonIdToLocal.get(c.video_id);
    if (!localId || !c.character_name) { stats.cameos.skipped++; continue; }
    try {
      // INSERT OR IGNORE keeps the operation idempotent. Cameo PK is
      // (video_id, character_name) so re-imports won't duplicate.
      await db.run(
        `INSERT OR IGNORE INTO cameos (video_id, character_name) VALUES (?, ?)`,
        [localId, c.character_name]
      );
      stats.cameos.inserted++;
    } catch {
      stats.cameos.errors++;
    }
  }

  // ── Creator profiles ── (host-portable; merge by username)
  for (const p of (parsed.creator_profiles || [])) {
    if (!p?.username) { stats.creator_profiles.errors++; continue; }
    try {
      const res = await mergeOneProfile(db, 'creator_profiles', p.username, 'username', p, PORTABLE_CREATOR_COLUMNS);
      stats.creator_profiles.inserted += res.inserted;
      stats.creator_profiles.enriched += res.enriched;
    } catch {
      stats.creator_profiles.errors++;
    }
  }

  // ── Character profiles ── (host-portable; merge by character_name)
  for (const c of (parsed.character_profiles || [])) {
    if (!c?.character_name) { stats.character_profiles.errors++; continue; }
    try {
      const res = await mergeOneProfile(db, 'character_profiles', c.character_name, 'character_name', c, PORTABLE_CHARACTER_COLUMNS);
      stats.character_profiles.inserted += res.inserted;
      stats.character_profiles.enriched += res.enriched;
    } catch {
      stats.character_profiles.errors++;
    }
  }

  // ── Comments ── (host-portable; INSERT OR IGNORE by comment_id)
  const incoming = parsed.comments || [];
  stats.comments.total_in_json = incoming.length;
  if (incoming.length) {
    // Build the set of post_ids we have on disk so we can report which
    // imported comments are attached to a local video vs orphans.
    const localPostIds = new Set();
    try {
      const rows = await db.all(`SELECT DISTINCT post_id FROM videos WHERE post_id IS NOT NULL AND post_id != ''`);
      for (const r of rows) localPostIds.add(String(r.post_id));
    } catch {}

    const colList = PORTABLE_COMMENT_COLUMNS.join(', ');
    const placeholders = PORTABLE_COMMENT_COLUMNS.map(() => '?').join(', ');
    // INSERT OR IGNORE is the right semantic: comments are append-only and
    // re-imports don't trample existing rows. (DuckDB equivalent is
    // ON CONFLICT DO NOTHING.)
    const insertSql = db.engine === 'duckdb'
      ? `INSERT INTO comments (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
      : `INSERT OR IGNORE INTO comments (${colList}) VALUES (${placeholders})`;

    for (const c of incoming) {
      if (!c?.comment_id || !c?.parent_post_id) { stats.comments.errors++; continue; }
      try {
        const params = PORTABLE_COMMENT_COLUMNS.map((col) => (c[col] === undefined ? null : c[col]));
        await db.run(insertSql, params);
        stats.comments.inserted++;
        if (localPostIds.has(String(c.parent_post_id))) stats.comments.attached_to_video++;
        else stats.comments.orphans++;
      } catch {
        stats.comments.errors++;
      }
    }

    // Refresh the denormalized videos.comment_count so feeds and "most
    // commented" lists see the imported comments. Cheap — one indexed UPDATE.
    try {
      if (db.engine === 'duckdb') {
        await db.run(`
          UPDATE videos SET comment_count = (
            SELECT COUNT(*) FROM comments c WHERE c.parent_post_id = videos.post_id
          )
          WHERE post_id IS NOT NULL AND post_id != ''
        `);
      } else {
        await db.run(`
          UPDATE videos SET comment_count = (
            SELECT COUNT(*) FROM comments c WHERE c.parent_post_id = videos.post_id
          )
          WHERE post_id IS NOT NULL AND post_id != ''
        `);
      }
    } catch {}
  }

  return stats;
}

/**
 * Look for sora-view-metadata.json in the archive root and apply it if
 * present. Called at the tail of initial ingest. Returns null when no file
 * is found, or the same stats shape as applyMetadataImport otherwise.
 */
export async function autoImportMetadataFromArchive(db, archivePath) {
  if (!archivePath) return null;
  const candidate = path.join(archivePath, 'sora-view-metadata.json');
  if (!fs.existsSync(candidate)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch (e) {
    return { error: `Found ${candidate} but could not parse it: ${e.message}` };
  }
  const v = validateImportPayload(parsed);
  if (!v.ok) return { error: `Found ${candidate} but it isn't a valid export: ${v.reason}` };
  const stats = await applyMetadataImport(db, parsed);
  return { source: candidate, ...stats };
}
