import { getDB } from '$lib/db.js';

/**
 * Full-archive metadata export. This file is the round-trip format for
 * Import JSON: every field that's safe to carry across machines (and useful
 * after the original archive is gone) is included. The local-only `id` PK
 * is dropped at import time — rows are re-matched by stable identifiers
 * (generation_id, then post_id, then file_path).
 *
 * Schema is versioned so future imports can adapt without breaking old
 * exports.
 */
const SCHEMA_VERSION = 1;

async function safeAll(db, sql, fallback = []) {
  try { return await db.all(sql); }
  catch { return fallback; }
}

export async function GET() {
  const db = await getDB();
  const videos             = await safeAll(db, `SELECT * FROM videos ORDER BY date DESC, id DESC`);
  const cameos             = await safeAll(db, `SELECT video_id, character_name FROM cameos ORDER BY video_id, character_name`);
  const collections        = await safeAll(db, `SELECT * FROM collections ORDER BY name`);
  const collection_videos  = await safeAll(db, `SELECT * FROM collection_videos ORDER BY collection_id, video_id`);
  const creator_profiles   = await safeAll(db, `SELECT * FROM creator_profiles ORDER BY username`);
  const character_profiles = await safeAll(db, `SELECT * FROM character_profiles ORDER BY character_name`);
  const comments           = await safeAll(db, `SELECT * FROM comments ORDER BY parent_post_id, posted_at`);
  // Note: creator_summary / character_summary / summary_meta are intentionally
  // excluded — they're rebuilt from the tables above by Optimize Database, so
  // including them would just bloat the file and go stale immediately on merge.

  const body = {
    schema_version: SCHEMA_VERSION,
    exported_at:    new Date().toISOString(),
    counts: {
      videos:             videos.length,
      cameos:             cameos.length,
      collections:        collections.length,
      collection_videos:  collection_videos.length,
      creator_profiles:   creator_profiles.length,
      character_profiles: character_profiles.length,
      comments:           comments.length,
    },
    videos,
    cameos,
    collections,
    collection_videos,
    creator_profiles,
    character_profiles,
    comments,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="sora-view-metadata.json"',
    },
  });
}
