import { searchVideos } from '$lib/db.js';
import { collectPages, nextPageHref, readPageParam } from '$lib/server/paging.js';

export async function load({ url }) {
  const q = url.searchParams.get('q') || '';
  const author = url.searchParams.get('author') || '';
  const dateFrom = url.searchParams.get('dateFrom') || '';
  const dateTo = url.searchParams.get('dateTo') || '';
  const character = url.searchParams.get('character') || '';
  const minLikes = url.searchParams.get('minLikes') || '';
  const minViews = url.searchParams.get('minViews') || '';
  const page = readPageParam(url);

  const hasQuery = !!(q || author || dateFrom || dateTo || character || minLikes || minViews);
  const result = hasQuery
    ? await collectPages((p) => searchVideos({ q, author, dateFrom, dateTo, character, minLikes, minViews, page: p }), page)
    : { videos: [], hasMore: false };

  return {
    videos: result.videos,
    hasMore: result.hasMore,
    page,
    nextHref: nextPageHref(url, page + 1),
    q, author, dateFrom, dateTo, character, minLikes, minViews
  };
}
