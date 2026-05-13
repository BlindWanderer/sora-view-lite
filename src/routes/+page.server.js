import { getVideos, getStats } from '$lib/db.js';
import { getConfig } from '$lib/config.js';
import { collectPages, nextPageHref, readPageParam } from '$lib/server/paging.js';

export async function load({ url }) {
  const page = readPageParam(url);
  const seed = url.searchParams.get('seed') || String(Math.floor(Math.random() * 2147483646) + 1);
  const mode = url.searchParams.get('mode') || 'all';
  const { videos, hasMore } = await collectPages(
    (p) => getVideos({ page: p, randomSeed: seed, feedMode: mode }),
    page
  );
  const stats = await getStats();
  const config = getConfig() || {};

  return {
    videos,
    stats,
    mode,
    page,
    seed,
    hasMore,
    nextHref: nextPageHref(new URL(`/?seed=${encodeURIComponent(seed)}&mode=${encodeURIComponent(mode)}&page=${page}`, url), page + 1),
    mobileFeedLayout: config.mobileFeedLayout || 'auto'
  };
}
