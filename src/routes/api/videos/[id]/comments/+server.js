import { json } from '@sveltejs/kit';
import { getCommentsForVideo } from '$lib/db.js';

export async function GET({ params, url }) {
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 100));
  const comments = await getCommentsForVideo(params.id, { limit });
  return json({ comments });
}
