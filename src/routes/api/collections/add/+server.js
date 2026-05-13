import { json } from '@sveltejs/kit';
import { addVideoToCollection, createCollection } from '$lib/db.js';

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  let collectionId = body.collectionId;
  if (!collectionId && body.name) {
    const collection = await createCollection(body.name);
    collectionId = collection.id;
  }
  if (!collectionId || !body.videoId) return json({ ok: false, error: 'collectionId/name and videoId are required' }, { status: 400 });
  await addVideoToCollection(collectionId, body.videoId);
  return json({ ok: true });
}
