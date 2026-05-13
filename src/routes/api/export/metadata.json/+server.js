import { getDB } from '$lib/db.js';

export async function GET() {
  const db = await getDB();
  const videos = await db.all(`SELECT * FROM videos ORDER BY date DESC, id DESC`);
  const cameos = await db.all(`SELECT video_id, character_name FROM cameos ORDER BY video_id, character_name`);
  const collections = await db.all(`SELECT * FROM collections ORDER BY name`).catch(() => []);
  const collection_videos = await db.all(`SELECT * FROM collection_videos ORDER BY collection_id, video_id`).catch(() => []);
  return new Response(JSON.stringify({ exported_at: new Date().toISOString(), videos, cameos, collections, collection_videos }, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="sora-view-metadata.json"' }
  });
}
