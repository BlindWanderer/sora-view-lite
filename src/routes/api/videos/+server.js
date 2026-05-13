import { json } from '@sveltejs/kit';
import { getVideos, searchVideos, getCreatorVideos, getCharacterVideos, getProfileVideos, getRemixParents } from '$lib/db.js';

export async function GET({ url }) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const type = url.searchParams.get('type') || 'feed';
  const author = url.searchParams.get('author') || '';
  const character = url.searchParams.get('character') || '';
  const sourceDir = url.searchParams.get('sourceDir') || '';
  const q = url.searchParams.get('q') || '';
  const dateFrom = url.searchParams.get('dateFrom') || '';
  const dateTo = url.searchParams.get('dateTo') || '';
  const minLikes = url.searchParams.get('minLikes') || '';
  const minViews = url.searchParams.get('minViews') || '';
  const seed = url.searchParams.get('seed') || '';
  const mode = url.searchParams.get('mode') || 'all';

  let videos;
  switch (type) {
    case 'search': videos = await searchVideos({ q, author, dateFrom, dateTo, character, minLikes, minViews, page }); break;
    case 'creator': videos = await getCreatorVideos(author, sourceDir || null, page); break;
    case 'character': videos = await getCharacterVideos(character, page); break;
    case 'profile': videos = await getProfileVideos(sourceDir, page); break;
    case 'remix_parents': videos = await getRemixParents({ page }); break;
    default: videos = await getVideos({ page, sourceDir: sourceDir || null, randomSeed: seed || null, feedMode: mode });
  }
  return json(videos);
}
