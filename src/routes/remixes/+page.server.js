import { getRemixParents, getStats } from '$lib/db.js';
import { collectPages, nextPageHref, readPageParam } from '$lib/server/paging.js';

export async function load({ url }) {
  const page = readPageParam(url);
  const { videos, hasMore } = await collectPages((p) => getRemixParents({ page: p }), page);

  return {
    videos,
    stats: await getStats(),
    page,
    hasMore,
    nextHref: nextPageHref(new URL(`/remixes?page=${page}`, url), page + 1)
  };
}
