import { json } from '@sveltejs/kit';
import { removeVideoFromCollection } from '$lib/db.js';

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  if (!body.collectionId || !body.videoId) {
    return json({ ok: false, error: 'collectionId and videoId are required' }, { status: 400 });
  }
  await removeVideoFromCollection(body.collectionId, body.videoId);
  return json({ ok: true });
}
