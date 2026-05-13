import { getCharacterVideos, getCharacterInfo, getCharacterCoStars, getCharacterCreators } from '$lib/db.js';
import { collectPages, nextPageHref, readPageParam } from '$lib/server/paging.js';

export async function load({ params, url }) {
  const name = params.name.toLowerCase();
  const page = readPageParam(url);
  const info = await getCharacterInfo(name);
  const coStars = await getCharacterCoStars(name, { limit: 25 });
  const creators = await getCharacterCreators(name, { limit: 25 });
  const result = await collectPages((p) => getCharacterVideos(name, p), page);

  return {
    name,
    info,
    coStars,
    creators,
    videos: result.videos,
    hasMore: result.hasMore,
    page,
    nextHref: nextPageHref(url, page + 1)
  };
}
