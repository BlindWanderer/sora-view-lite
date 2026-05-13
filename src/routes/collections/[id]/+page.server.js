import { error } from '@sveltejs/kit';
import { getCollection, getCollectionVideos } from '$lib/db.js';
import { collectPages, readPageParam } from '$lib/server/paging.js';

export async function load({ params, url }) {
  const collection = await getCollection(params.id);
  if (!collection) throw error(404, 'Collection not found');
  const page = readPageParam(url);
  const { videos, hasMore } = await collectPages((p) => getCollectionVideos(params.id, p), page);
  return { collection, videos, page, hasMore };
}
