import { json } from '@sveltejs/kit';
import { createCollection, getCollections, getCollectionsForVideo } from '$lib/db.js';

export async function GET({ url }) {
  const collections = await getCollections();
  const videoId = url.searchParams.get('video');
  if (videoId) {
    const memberships = await getCollectionsForVideo(videoId);
    return json({ collections, memberships });
  }
  return json({ collections });
}

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const collection = await createCollection(body.name || 'New collection');
  return json({ ok: true, collection, collections: await getCollections() });
}
