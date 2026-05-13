import { getCreatorVideos, getCreatorInfo, getCreatorCharacters } from '$lib/db.js';
import { collectPages, nextPageHref, readPageParam } from '$lib/server/paging.js';

const TABS = new Set(['videos', 'characters', 'stats']);

export async function load({ params, url }) {
  const username = params.username;
  const page = readPageParam(url);
  const tab = TABS.has(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'videos';
  const info = await getCreatorInfo(username);
  const characters = await getCreatorCharacters(username);
  const result = tab === 'videos'
    ? await collectPages((p) => getCreatorVideos(username, null, p), page)
    : { videos: [], hasMore: false };

  return {
    username,
    tab,
    info,
    characters,
    videos: result.videos,
    hasMore: result.hasMore,
    page,
    nextHref: nextPageHref(url, page + 1)
  };
}
